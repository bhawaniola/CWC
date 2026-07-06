"""Integration test for the upgraded Node codebase (no Docker):
runs cloud-api + satellite link-node + pod-01 as local processes and verifies
signed alerts, forged rejection, hazard->broadcast loop, rain-fade degradation,
rate limiting, and batch queue sync."""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="sanjeevani_node_")
PROCS = {}
RESULTS = []


def http(method, url, body=None, timeout=10, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or "{}")


def start(name, cwd, env_extra):
    env = {**os.environ, **env_extra}
    log = open(os.path.join(TMP, f"{name}.log"), "w")
    PROCS[name] = (subprocess.Popen(["node", "server.js"], cwd=os.path.join(ROOT, cwd),
                                    env=env, stdout=log, stderr=log, shell=False), log)


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


try:
    start("cloud", "cloud-api", {"PORT": "9000", "POD_URLS": "POD-01=http://127.0.0.1:8001"})
    start("satellite", "link-node", {"PORT": "9100", "LINK_ID": "satellite",
                                     "LINK_TYPE": "satellite",
                                     "CLOUD_URL": "http://127.0.0.1:9000"})
    start("pod01", "pod-agent", {"PORT": "8001", "POD_ID": "POD-01",
                                 "POD_NAME": "Test Command Pod",
                                 "SATELLITE_URL": "http://127.0.0.1:9100",
                                 "CELL_TOWERS": "", "CONNECTED_TOWERS": "",
                                 "NEIGHBORS": "",
                                 "SIMULATION_CONTROLLER_URL": "http://127.0.0.1:9999",
                                 "DATA_DIR": os.path.join(TMP, "pod01-data")})

    assert wait_up("http://127.0.0.1:9000/api/health"), "cloud did not start"
    assert wait_up("http://127.0.0.1:9100/health"), "satellite did not start"
    assert wait_up("http://127.0.0.1:8001/api/pod/status"), "pod did not start"
    print("Services up; waiting for pod enrollment...")
    time.sleep(6)

    print("\n[1] Signed alert broadcast -> pod verifies with Ed25519")
    r = http("POST", "http://127.0.0.1:9000/api/alerts",
             {"hazard": "drill", "message": "Signed EOC test alert."})
    check("cloud broadcast delivered to pod (201)", r["data"]["delivery"].get("POD-01") == 201,
          str(r["data"]["delivery"]))
    alerts = http("GET", "http://127.0.0.1:8001/api/alerts")["data"]
    check("pod stored the alert as verified", bool(alerts) and alerts[0].get("verified") is True)

    print("\n[2] Forged decoy alert -> rejected 401 + SECURITY event queued and synced")
    rejected = False
    try:
        http("POST", "http://127.0.0.1:8001/api/alerts",
             {"id": "alert-evil", "seq": 999, "hazard": "evacuation",
              "message": "Move to the riverbank NOW.", "scope": "all",
              "issuedAt": "2026-07-06T12:00:00.000Z", "signature": "deadbeef" * 16})
    except urllib.error.HTTPError as e:
        rejected = e.code == 401
    check("forged alert rejected with 401", rejected)
    synced = False
    for _ in range(15):
        reqs = http("GET", "http://127.0.0.1:9000/api/requests")["data"]
        if any(item.get("category") == "SECURITY" for item in reqs):
            synced = True
            break
        time.sleep(1)
    check("SECURITY event reached the cloud via the ladder", synced)

    print("\n[3] Old boolean bypass is dead (verified:true no longer tricks the pod)")
    bypassed = True
    try:
        http("POST", "http://127.0.0.1:8001/api/alerts",
             {"hazard": "fake", "message": "trust me", "verified": True, "seq": 998})
    except urllib.error.HTTPError as e:
        bypassed = e.code not in (401, 503)
    check("alert without valid signature rejected despite verified:true", not bypassed)

    print("\n[4] Hazard pack fires -> EARLY-WARNING to cloud -> auto signed broadcast back")
    for v in [60, 80, 100, 128, 158]:
        http("POST", "http://127.0.0.1:8001/api/sensors", {"sensor": "water_level", "value": v})
    flood_alert = False
    for _ in range(15):
        alerts = http("GET", "http://127.0.0.1:8001/api/alerts")["data"]
        if any(a.get("hazard") == "flood" and a.get("source") == "cloud-api" and a.get("verified")
               for a in alerts):
            flood_alert = True
            break
        time.sleep(1)
    check("flood warning came BACK as a cloud-signed verified alert", flood_alert)
    reqs = http("GET", "http://127.0.0.1:9000/api/requests")["data"]
    check("EARLY-WARNING stored at cloud",
          any(item.get("category") == "EARLY-WARNING" for item in reqs))

    print("\n[5] Rain fade -> satellite DEGRADED but still used (predictive failover signal)")
    http("GET", "http://127.0.0.1:9100/set?loss=0.4")
    time.sleep(1)
    status = http("GET", "http://127.0.0.1:8001/api/pod/status")["data"]
    check("pod sees satellite as degraded", status["satelliteStatus"] == "degraded",
          f"sat={status['satelliteStatus']}")
    check("degraded link still beats island (mode=cloud)", status["mode"] == "cloud",
          f"mode={status['mode']} path={status['activePath']}")

    print("\n[6] Rate limiting: same device hammering -> 429")
    throttled = 0
    for i in range(10):
        try:
            http("POST", "http://127.0.0.1:8001/api/requests",
                 {"message": f"spam {i}", "category": "Other"},
                 headers={"x-device-id": "same-device"})
        except urllib.error.HTTPError as e:
            if e.code == 429:
                throttled += 1
    check("rapid repeats throttled with 429", throttled > 0, f"{throttled}/10 throttled")

    print("\n[7] Batch sync: blackout -> 5 queued -> restore -> batch to cloud")
    http("GET", "http://127.0.0.1:9100/set?loss=1.0")
    time.sleep(1)
    for i in range(5):
        http("POST", "http://127.0.0.1:8001/api/requests",
             {"message": f"trapped near bridge {i}", "category": "Rescue",
              "name": f"Victim {i}"},
             headers={"x-device-id": f"dev-{uuid.uuid4().hex[:6]}"})
    queue_len = http("GET", "http://127.0.0.1:8001/api/queue")["count"]
    check("requests held in pod queue during blackout", queue_len >= 5, f"queue={queue_len}")
    http("GET", "http://127.0.0.1:9100/set?loss=0")
    drained = False
    for _ in range(20):
        if http("GET", "http://127.0.0.1:8001/api/queue")["count"] == 0:
            drained = True
            break
        time.sleep(1)
    check("queue drained after restore (batch path)", drained)
    reqs = http("GET", "http://127.0.0.1:9000/api/requests")["data"]
    check("cloud received the queued rescue requests",
          sum(1 for item in reqs if "trapped near bridge" in (item.get("message") or "")) >= 5)

    print("\n" + "=" * 60)
    failed = [label for label, ok in RESULTS if not ok]
    print(f"RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("Failed:", *failed, sep="\n  - ")
        print(f"Logs: {TMP}")
        sys.exit(1)
    print("ALL UPGRADES VERIFIED on the Node codebase.")
finally:
    for name, (proc, log) in PROCS.items():
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()

