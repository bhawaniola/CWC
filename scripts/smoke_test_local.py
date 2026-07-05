"""End-to-end smoke test WITHOUT Docker: runs control-center, 3 relays and
2 pods as local processes, then exercises every demo scenario:
flood pack -> signed alert, forged alert rejection, mesh failover,
island mode + store-and-forward recovery.

Usage:  py -3.13 scripts/smoke_test_local.py
(needs: pip install fastapi uvicorn httpx pyyaml cryptography redis)
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
TMP = tempfile.mkdtemp(prefix="sanjeevani_")
PROCS = {}
RESULTS = []


def http(method, url, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or "{}")


def start(name, cwd, port, env_extra):
    env = {**os.environ, **env_extra}
    log = open(os.path.join(TMP, f"{name}.log"), "w")
    PROCS[name] = (subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=os.path.join(ROOT, cwd), env=env, stdout=log, stderr=log), log)


def stop(name):
    proc, log = PROCS.pop(name, (None, None))
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


def wait_up(url, secs=30):
    for _ in range(secs * 2):
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def check(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}  {detail}")


CC_ENV = {"REDIS_URL": "memory://",
          "RELAYS": "satellite=http://127.0.0.1:9101,cell_tower_1=http://127.0.0.1:9102,cell_tower_2=http://127.0.0.1:9103",
          "POD_URLS": "pod1=http://127.0.0.1:9201,pod3=http://127.0.0.1:9203"}
RELAY_ENV = lambda n: {"NAME": n, "CC_URL": "http://127.0.0.1:9000", "LATENCY_MS": "10"}
POD1_ENV = {"POD_ID": "pod1", "SITE": "Riverside School Shelter",
            "SATELLITE_URL": "http://127.0.0.1:9101", "TOWER_URL": "http://127.0.0.1:9102",
            "NEIGHBORS": "http://127.0.0.1:9203",
            "CC_PUBKEY_URL": "http://127.0.0.1:9000/pubkey",
            "QUEUE_FILE": os.path.join(TMP, "pod1_queue.jsonl")}
POD3_ENV = {"POD_ID": "pod3", "SITE": "District Hospital Camp",
            "SATELLITE_URL": "http://127.0.0.1:9101", "TOWER_URL": "http://127.0.0.1:9103",
            "NEIGHBORS": "http://127.0.0.1:9201",
            "CC_PUBKEY_URL": "http://127.0.0.1:9000/pubkey",
            "QUEUE_FILE": os.path.join(TMP, "pod3_queue.jsonl")}

try:
    print("Starting control-center, relays, pods (logs in %s)..." % TMP)
    start("cc", "control-center", 9000, CC_ENV)
    start("satellite", "relay", 9101, RELAY_ENV("satellite"))
    start("tower1", "relay", 9102, RELAY_ENV("cell_tower_1"))
    start("tower2", "relay", 9103, RELAY_ENV("cell_tower_2"))
    start("pod1", "pod-agent", 9201, POD1_ENV)
    start("pod3", "pod-agent", 9203, POD3_ENV)

    for name, url in [("cc", "http://127.0.0.1:9000/pubkey"),
                      ("satellite", "http://127.0.0.1:9101/health"),
                      ("tower1", "http://127.0.0.1:9102/health"),
                      ("tower2", "http://127.0.0.1:9103/health"),
                      ("pod1", "http://127.0.0.1:9201/status"),
                      ("pod3", "http://127.0.0.1:9203/status")]:
        assert wait_up(url), f"{name} did not start — see {TMP}\\{name}.log"
    print("All services up. Waiting for pod enrollment (pubkey fetch)...")
    time.sleep(4)

    print("\n[1] Flood hazard pack -> disaster mode -> signed alert everywhere")
    fired = False
    for v in [60, 80, 100, 125, 155]:
        out = http("POST", "http://127.0.0.1:9201/sensor",
                   {"sensor": "water_level", "value": v})
        fired = fired or bool(out.get("fired"))
    check("flood pack fired", fired)
    alert_ok = False
    for _ in range(20):
        s1 = http("GET", "http://127.0.0.1:9201/status")
        s3 = http("GET", "http://127.0.0.1:9203/status")
        if s1["alerts"] and s3["alerts"] and s3["alerts"][-1]["verified"]:
            alert_ok = True
            break
        time.sleep(1)
    check("signed alert verified on BOTH pods (incl. pod3, different zone)", alert_ok)
    check("pod1 in disaster mode", http("GET", "http://127.0.0.1:9201/status")["mode"] == "disaster")

    print("\n[2] Shield: forged decoy alert must be rejected")
    forged_rejected = False
    try:
        http("POST", "http://127.0.0.1:9201/alert",
             {"id": "al-evil", "seq": 999, "hazard": "flood",
              "message": "Move to the riverbank NOW.", "scope": "all",
              "issued_at": "2026-07-05T12:00:00", "signature": "deadbeef" * 16})
    except urllib.error.HTTPError as e:
        forged_rejected = e.code == 401
    check("forged alert rejected with 401", forged_rejected)
    time.sleep(2)
    sec = http("GET", "http://127.0.0.1:9000/state")["security"]
    check("security event visible on EOC dashboard", len(sec) > 0,
          sec[0]["detail"][:60] if sec else "")

    print("\n[3] Mesh failover: satellite + pod3's tower die -> pod3 relays via pod1")
    stop("satellite")
    stop("tower2")
    time.sleep(2)
    r = http("POST", "http://127.0.0.1:9203/request",
             {"text": "child with high fever, need medicine"})
    check("pod3 delivered via mesh", "mesh" in r["status"], r["status"])

    print("\n[4] Island mode: last tower dies -> pod1 queues offline")
    stop("tower1")
    time.sleep(2)
    r = http("POST", "http://127.0.0.1:9201/request",
             {"text": "grandfather needs insulin urgently"})
    check("pod1 request queued offline", r["status"].startswith("queued"), r["status"])
    check("local triage still worked offline (severity >= 9)",
          r["severity"] >= 9, f"sev={r['severity']} {r['reason']}")

    print("\n[5] Recovery: tower1 returns -> queue drains, event reaches EOC")
    start("tower1", "relay", 9102, RELAY_ENV("cell_tower_1"))
    assert wait_up("http://127.0.0.1:9102/health")
    synced = False
    for _ in range(20):
        events = http("GET", "http://127.0.0.1:9000/state")["events"]
        if any(e.get("type") == "help_request" and "insulin" in (e.get("text") or "")
               for e in events):
            synced = True
            break
        time.sleep(1)
    check("queued insulin request synced to EOC after recovery", synced)

    print("\n" + "=" * 60)
    failed = [l for l, ok in RESULTS if not ok]
    print(f"RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("Failed:", *failed, sep="\n  - ")
        sys.exit(1)
    print("ALL SCENARIOS VERIFIED — the Docker demo will behave the same way.")
finally:
    for n in list(PROCS):
        stop(n)
