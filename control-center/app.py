"""SANJEEVANI control center (cloud core).

POC stand-ins for the production stack:
  Redis Streams (priority + standard)  ->  Kafka priority topics
  In-memory state + Redis              ->  Redis cluster + PostGIS
  Rule/LLM triage service              ->  Triage microservice on Kubernetes
  Signed alert broadcast (Ed25519)     ->  SANJEEVANI-Shield trusted alert pipeline
Pods never call this service directly for events — everything arrives
via the satellite / cell tower relay containers.
"""
import asyncio
import json
import os
import pathlib
import time
from contextlib import asynccontextmanager

import httpx
import redis.asyncio as aioredis
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from triage import triage
from webex import post_webex

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
RELAYS = dict(p.split("=", 1) for p in os.getenv("RELAYS", "").split(",") if "=" in p)
POD_URLS = dict(p.split("=", 1) for p in os.getenv("POD_URLS", "").split(",") if "=" in p)

STREAM_SOS = "events:sos"
STREAM_STD = "events:std"

signing_key = Ed25519PrivateKey.generate()
pubkey_hex = signing_key.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()

state = {
    "pods": {},              # pod -> {site,tier,mode,queue_len,last_seen}
    "paths": {},             # relay -> {up, loss, latency_ms}
    "events": [],            # processed feed (latest first)
    "security": [],
    "alerts_sent": [],
    "alert_seq": 0,
    "queue_depth": {"sos": 0, "std": 0},
}

client = httpx.AsyncClient(timeout=4.0)
rds = None


class MemoryStreams:
    """Drop-in stand-in for the Redis Streams calls we use, so the control
    center also runs without Redis (local dev / REDIS_URL=memory://)."""

    def __init__(self):
        self.streams, self.counter = {}, 0

    async def xadd(self, stream, fields):
        self.counter += 1
        eid = f"{self.counter}-0"
        self.streams.setdefault(stream, []).append((eid, fields))
        return eid

    async def xread(self, spec, count=10, block=None):
        out = []
        for stream, last in spec.items():
            floor = int(str(last).split("-")[0] or 0)
            newer = [(i, f) for i, f in self.streams.get(stream, [])
                     if int(i.split("-")[0]) > floor][:count]
            if newer:
                out.append((stream, newer))
        return out

    async def xlen(self, stream):
        return len(self.streams.get(stream, []))


def canonical(alert: dict) -> bytes:
    unsigned = {k: v for k, v in alert.items() if k != "signature"}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()


async def broadcast_alert(hazard, message, scope="all"):
    state["alert_seq"] += 1
    alert = {"id": f"al-{state['alert_seq']}", "seq": state["alert_seq"],
             "hazard": hazard, "message": message, "scope": scope,
             "issued_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    alert["signature"] = signing_key.sign(canonical(alert)).hex()
    results = {}
    for pod, url in POD_URLS.items():
        try:
            r = await client.post(f"{url}/alert", json=alert)
            results[pod] = r.status_code
        except Exception:
            results[pod] = "unreachable"
    state["alerts_sent"].insert(0, {**alert, "delivery": results})
    del state["alerts_sent"][10:]
    await post_webex(f"🚨 **ALERT ({hazard})** — {message}")
    return {"alert": alert["id"], "delivery": results}


# ---------- worker: consume queue, triage, act ----------

async def process(entry: dict):
    via, evt = entry.get("via", "?"), entry.get("event", {})
    etype = evt.get("type")
    if etype == "heartbeat":
        state["pods"][evt["pod"]] = {
            "site": evt.get("site"), "tier": evt.get("tier"),
            "mode": evt.get("mode"), "queue_len": evt.get("queue_len", 0),
            "via": via, "last_seen": time.time()}
        return
    delay = time.time() - evt.get("ts", time.time())
    record = {"at": time.strftime("%H:%M:%S"), "pod": evt.get("pod"),
              "site": evt.get("site"), "type": etype, "via": via,
              "queued_sync": bool(evt.get("queued_sync")) or delay > 12}
    if etype == "help_request":
        sev, cat, reason = await triage(
            evt.get("text", ""), evt.get("local_severity"),
            evt.get("local_category"), evt.get("local_reason"))
        record.update(text=evt.get("text"), severity=sev, category=cat, reason=reason)
        if sev >= 8:
            await post_webex(
                f"🆘 **Severity {sev}/10 ({cat})** at {evt.get('site')} "
                f"[{evt.get('pod')}]\n> {evt.get('text')}\n_{reason}_")
    elif etype == "early_warning":
        record.update(severity=evt.get("severity"), category="early-warning",
                      text=evt.get("message"), reason=evt.get("trigger"))
        await broadcast_alert(evt.get("hazard"), evt.get("message"))
    elif etype == "security_event":
        record.update(severity=9, category="security", text=evt.get("detail"),
                      reason="Shield: rejected at pod")
        state["security"].insert(0, {"at": record["at"], "pod": record["pod"],
                                     "detail": evt.get("detail")})
        del state["security"][20:]
        await post_webex(f"🛡️ **SECURITY** — {evt.get('detail')} ({evt.get('pod')})")
    state["events"].insert(0, record)
    del state["events"][100:]


async def worker_loop():
    last = {STREAM_SOS: "0-0", STREAM_STD: "0-0"}
    while True:
        busy = False
        for stream in (STREAM_SOS, STREAM_STD):     # SOS lane always drains first
            resp = await rds.xread({stream: last[stream]}, count=10)
            for _, entries in resp:
                for eid, fields in entries:
                    last[stream] = eid
                    try:                    # one bad event must never kill the worker
                        await process(json.loads(fields["data"]))
                    except Exception:
                        import traceback
                        traceback.print_exc()
                    busy = True
            if stream == STREAM_SOS and busy:
                break
        state["queue_depth"] = {"sos": await rds.xlen(STREAM_SOS),
                                "std": await rds.xlen(STREAM_STD)}
        if not busy:
            await asyncio.sleep(0.3)


async def path_probe_loop():
    """Mini-ThousandEyes: watch every transport path's health."""
    while True:
        for name, url in RELAYS.items():
            try:
                r = await client.get(f"{url}/health", timeout=1.5)
                h = r.json()
                state["paths"][name] = {"up": True, "loss": h.get("loss", 0),
                                        "latency_ms": h.get("latency_ms", 0)}
            except Exception:
                state["paths"][name] = {"up": False, "loss": 1.0, "latency_ms": None}
        await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(app):
    global rds
    try:
        rds = aioredis.from_url(REDIS_URL, decode_responses=True)
        await rds.ping()
    except Exception:
        print("[control-center] Redis unavailable — using in-memory streams")
        rds = MemoryStreams()
    tasks = [asyncio.create_task(worker_loop()),
             asyncio.create_task(path_probe_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="SANJEEVANI control center", lifespan=lifespan)

DASHBOARD = (pathlib.Path(__file__).parent / "dashboard.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return DASHBOARD


@app.get("/pubkey")
async def pubkey():
    return {"pubkey": pubkey_hex}


@app.post("/ingest")
async def ingest(body: dict):
    evt = body.get("event", {})
    priority = evt.get("type") in ("early_warning", "security_event") or \
        evt.get("local_severity", 0) >= 8 or evt.get("severity", 0) >= 8
    stream = STREAM_SOS if priority else STREAM_STD
    await rds.xadd(stream, {"data": json.dumps(body)})
    return {"queued": stream}


@app.post("/broadcast-alert")
async def manual_alert(body: dict):
    return await broadcast_alert(body.get("hazard", "manual"),
                                 body.get("message", "Test alert from EOC."),
                                 body.get("scope", "all"))


@app.get("/state")
async def get_state():
    now = time.time()
    pods = {}
    for pod, p in state["pods"].items():
        offline = now - p["last_seen"] > 12
        pods[pod] = {**p, "offline": offline,
                     "last_seen_s": int(now - p["last_seen"])}
    return {"paths": state["paths"], "pods": pods, "events": state["events"][:40],
            "security": state["security"], "alerts_sent": state["alerts_sent"][:5],
            "queue_depth": state["queue_depth"]}
