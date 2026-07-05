"""SANJEEVANI pod-agent — the 'shelter-in-a-box' brain.

In production this runs as IOx containers on a Cisco Catalyst IR1800.
It only knows its transport relays and mesh neighbors — it can never
reach the control center directly. Failover ladder:

    Tier 2: own uplink (satellite, else assigned cell tower)
    Tier 1: mesh relay through a neighbor pod (max 2 hops, URWB stand-in)
    Tier 0: island mode — store-and-forward queue, local triage keeps working
"""
import asyncio
import json
import os
import pathlib
import time
import uuid
from contextlib import asynccontextmanager

import httpx
import yaml
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from triage_local import triage_local

POD_ID = os.getenv("POD_ID", "pod1")
SITE = os.getenv("SITE", "Shelter")
SATELLITE_URL = os.getenv("SATELLITE_URL", "")
TOWER_URL = os.getenv("TOWER_URL", "")
NEIGHBORS = [u.strip() for u in os.getenv("NEIGHBORS", "").split(",") if u.strip()]
CC_PUBKEY_URL = os.getenv("CC_PUBKEY_URL", "http://control-center:9000/pubkey")
QUEUE_FILE = pathlib.Path(os.getenv("QUEUE_FILE", "/data/queue.jsonl"))
DEGRADED_LOSS = 0.25          # ThousandEyes-style predictive threshold
MAX_HOPS = 2

state = {
    "mode": "peacetime",           # peacetime | disaster
    "tier": "T0",
    "path": None,
    "pubkey": None,                # Ed25519 public key (trust anchor)
    "last_alert_seq": 0,
    "alerts": [],                  # verified alerts only
    "requests": [],                # citizen requests submitted at this pod
    "security_events": [],
    "sensors": {},                 # sensor -> recent readings
    "packs_triggered": {},
}

HAZARD_PACKS = []
for f in sorted(pathlib.Path(__file__).parent.glob("hazard-packs/*.yaml")):
    HAZARD_PACKS.append(yaml.safe_load(f.read_text()))

client = httpx.AsyncClient(timeout=4.0)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def make_event(etype, **fields):
    return {"id": str(uuid.uuid4())[:8], "type": etype, "pod": POD_ID,
            "site": SITE, "created_at": now_iso(), "ts": time.time(), **fields}


# ---------- transport: the failover ladder ----------

_quality_cache: dict = {}


async def relay_quality(url):
    """good = healthy, degraded = alive but lossy (predictive failover), None = dead.
    Cached for 3s so dead paths don't slow every request down."""
    now = time.time()
    hit = _quality_cache.get(url)
    if hit and hit[0] > now:
        return hit[1]
    try:
        r = await client.get(f"{url}/health", timeout=1.0)
        loss = r.json().get("loss", 0)
        q = "degraded" if loss >= DEGRADED_LOSS else "good"
    except Exception:
        q = None
    _quality_cache[url] = (now + 3, q)
    return q


async def deliver(event, hops=MAX_HOPS, visited=None):
    """Try own relays first, then mesh neighbors. Returns via-string or None."""
    visited = (visited or []) + [POD_ID]
    own = [("satellite", SATELLITE_URL), ("cell_tower", TOWER_URL)]
    ranked = []
    for idx, (name, url) in enumerate(own):
        if not url:
            continue
        q = await relay_quality(url)
        if q:
            ranked.append((0 if q == "good" else 1, idx, name, url))
    for _, _, name, url in sorted(ranked):
        try:
            r = await client.post(f"{url}/ingest", json=event)
            if r.status_code == 200:
                return f"uplink:{name}"
        except Exception:
            continue
    if hops > 0:
        for n in NEIGHBORS:
            try:
                r = await client.post(f"{n}/relay", json={
                    "event": event, "hops": hops - 1, "visited": visited},
                    timeout=3.0)
                if r.status_code == 200:
                    return f"mesh->{r.json().get('via', '?')}"
            except Exception:
                continue
    return None


def enqueue(event):
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with QUEUE_FILE.open("a") as f:
        f.write(json.dumps(event) + "\n")


def queue_length():
    try:
        return sum(1 for _ in QUEUE_FILE.open())
    except FileNotFoundError:
        return 0


def set_tier(via):
    if via is None:
        state["tier"], state["path"] = "T0", None
    elif via.startswith("uplink:"):
        state["tier"], state["path"] = "T2", via
    else:
        state["tier"], state["path"] = "T1", via


async def send_or_queue(event):
    via = await deliver(event)
    set_tier(via)
    if via is None:
        enqueue(event)
        return {"delivered": False, "via": "island-queue"}
    return {"delivered": True, "via": via}


# ---------- background loops ----------

async def heartbeat_loop():
    while True:
        evt = make_event("heartbeat", mode=state["mode"], tier=state["tier"],
                         queue_len=queue_length())
        via = await deliver(evt, hops=MAX_HOPS)
        set_tier(via)
        await asyncio.sleep(5)


async def flusher_loop():
    """Island recovery: push queued events out as soon as any path returns."""
    while True:
        await asyncio.sleep(3)
        if not QUEUE_FILE.exists():
            continue
        lines = [ln for ln in QUEUE_FILE.read_text().splitlines() if ln.strip()]
        if not lines:
            continue
        remaining = []
        for ln in lines:
            evt = json.loads(ln)
            evt["queued_sync"] = True
            via = await deliver(evt)
            if via is None:
                remaining.append(ln)
        QUEUE_FILE.write_text("\n".join(remaining) + ("\n" if remaining else ""))
        if len(remaining) < len(lines):
            set_tier("uplink:recovered" if not remaining else None)


async def enrollment_loop():
    """Fetch the alert-signing public key (trust anchor). In production this is
    installed at pod enrollment time via the Meraki dashboard config channel."""
    while state["pubkey"] is None:
        try:
            r = await client.get(CC_PUBKEY_URL, timeout=2)
            state["pubkey"] = bytes.fromhex(r.json()["pubkey"])
        except Exception:
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app):
    tasks = [asyncio.create_task(c()) for c in
             (heartbeat_loop, flusher_loop, enrollment_loop)]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title=f"pod-agent {POD_ID}", lifespan=lifespan)


# ---------- citizen portal ----------

PORTAL = (pathlib.Path(__file__).parent / "portal.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
async def portal():
    return PORTAL.replace("{{POD_ID}}", POD_ID).replace("{{SITE}}", SITE)


@app.get("/status")
async def status():
    return {"pod": POD_ID, "site": SITE, "mode": state["mode"],
            "tier": state["tier"], "path": state["path"],
            "queue_len": queue_length(), "alerts": state["alerts"][-3:]}


@app.post("/request")
async def citizen_request(body: dict):
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "empty request"}, status_code=400)
    sev, cat, reason = triage_local(text)
    evt = make_event("help_request", text=text, local_severity=sev,
                     local_category=cat, local_reason=reason)
    result = await send_or_queue(evt)
    entry = {"id": evt["id"], "text": text, "severity": sev, "category": cat,
             "reason": reason, "at": evt["created_at"],
             "status": "delivered via " + result["via"] if result["delivered"]
                       else "queued offline — will sync automatically"}
    state["requests"].append(entry)
    return entry


@app.get("/my-requests")
async def my_requests():
    return state["requests"][-20:]


# ---------- sensors + multi-hazard playbook engine ----------

@app.post("/sensor")
async def sensor(body: dict):
    name, value = body.get("sensor"), float(body.get("value", 0))
    readings = state["sensors"].setdefault(name, [])
    readings.append(value)
    del readings[:-30]
    fired = []
    for pack in HAZARD_PACKS:
        if pack["sensor"] != name or state["packs_triggered"].get(pack["name"]):
            continue
        trig, how = False, ""
        if value >= pack["threshold"]:
            trig, how = True, f"value {value} >= threshold {pack['threshold']}"
        elif "trend_window" in pack and len(readings) >= pack["trend_window"]:
            window = readings[-pack["trend_window"]:]
            rise = window[-1] - window[0]
            if rise >= pack.get("trend_min_rise", 1e9):
                trig, how = True, f"rising {rise:.0f} over last {pack['trend_window']} readings"
        if trig:
            state["packs_triggered"][pack["name"]] = True
            state["mode"] = "disaster"
            msg = pack["alert"].format(value=value, site=SITE)
            evt = make_event("early_warning", hazard=pack["name"],
                             severity=pack["severity"], message=msg, trigger=how)
            await send_or_queue(evt)
            fired.append({"hazard": pack["name"], "trigger": how})
    return {"ok": True, "mode": state["mode"], "fired": fired}


@app.post("/reset")
async def reset():
    state["mode"] = "peacetime"
    state["packs_triggered"] = {}
    state["alerts"] = []
    return {"ok": True}


# ---------- mesh relay (URWB stand-in) ----------

@app.post("/relay")
async def mesh_relay(body: dict):
    event, hops = body.get("event"), int(body.get("hops", 0))
    visited = body.get("visited", [])
    if POD_ID in visited:
        return JSONResponse({"error": "loop"}, status_code=508)
    via = await deliver(event, hops=hops, visited=visited)
    if via is None:
        return JSONResponse({"error": f"{POD_ID}: no path"}, status_code=503)
    return {"via": f"{POD_ID}:{via}"}


# ---------- signed alerts (SANJEEVANI-Shield) ----------

def canonical(alert: dict) -> bytes:
    unsigned = {k: v for k, v in alert.items() if k != "signature"}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()


async def report_security(detail):
    evt = make_event("security_event", detail=detail, severity=9)
    state["security_events"].append({"at": evt["created_at"], "detail": detail})
    await send_or_queue(evt)


@app.post("/alert")
async def receive_alert(alert: dict):
    if state["pubkey"] is None:
        return JSONResponse({"error": "no trust anchor yet — alert refused"},
                            status_code=503)
    sig = alert.get("signature", "")
    try:
        Ed25519PublicKey.from_public_bytes(state["pubkey"]).verify(
            bytes.fromhex(sig), canonical(alert))
    except (InvalidSignature, ValueError):
        await report_security(
            f"FORGED ALERT rejected (bad signature): '{alert.get('message', '')[:60]}'")
        return JSONResponse({"error": "invalid signature — alert rejected"},
                            status_code=401)
    if int(alert.get("seq", 0)) <= state["last_alert_seq"]:
        await report_security("REPLAYED alert rejected (stale sequence number)")
        return JSONResponse({"error": "stale sequence — replay rejected"},
                            status_code=401)
    scope = alert.get("scope", "all")
    if scope != "all" and POD_ID not in scope:
        await report_security("OUT-OF-SCOPE alert rejected")
        return JSONResponse({"error": "scope mismatch — alert rejected"},
                            status_code=401)
    state["last_alert_seq"] = int(alert["seq"])
    state["alerts"].append({"seq": alert["seq"], "hazard": alert.get("hazard"),
                            "message": alert["message"], "issued_at": alert["issued_at"],
                            "verified": True})
    if alert.get("hazard"):
        state["mode"] = "disaster"
    return {"ok": True, "verified": True}
