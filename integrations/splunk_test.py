"""Splunk HEC forwarding test (no Docker, no real Splunk):
runs cloud-api + mock_splunk.js as local processes and verifies that cloud
events stream to the HTTP Event Collector in Splunk's format, that a wrong
token is rejected, and that a DEAD Splunk never blocks an SOS (enhancer,
never gatekeeper)."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCS = {}
RESULTS = []

CLOUD = "http://127.0.0.1:19020"
MOCK = "http://127.0.0.1:19310"
TOKEN = "test-hec-token"


def http(method, url, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or "{}")


def start(name, cwd, script, env_extra):
    env = {**os.environ, **env_extra}
    PROCS[name] = subprocess.Popen(["node", script], cwd=os.path.join(ROOT, cwd),
                                   env=env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, shell=False)


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


def mock_events():
    return http("GET", f"{MOCK}/events")["data"]


try:
    start("mock-splunk", "integrations", "mock_splunk.js", {"PORT": "19310", "HEC_TOKEN": TOKEN})
    start("cloud", "Command-Center/Backend", "server.js", {
        "PORT": "19020", "POD_URLS": "", "AI_TRIAGE_ENABLED": "false",
        "SPLUNK_HEC_URL": MOCK, "SPLUNK_HEC_TOKEN": TOKEN,
        "SPLUNK_FLUSH_INTERVAL_MS": "500",
    })
    assert wait_up(f"{MOCK}/events"), "mock splunk did not start"
    assert wait_up(f"{CLOUD}/api/health"), "cloud did not start"

    print("\n[1] SOS events stream to Splunk HEC in Splunk's format")
    http("POST", f"{CLOUD}/api/requests", {
        "id": "splunk-test-sos", "podId": "POD-09", "category": "Medical",
        "name": "Splunk Test", "message": "Need a doctor and oxygen support",
        "triage": {"severity": 9}, "forwardedBy": "satellite",
    })
    got = None
    for _ in range(20):
        types = {e.get("event", {}).get("type") for e in mock_events()
                 if e.get("event", {}).get("id") == "splunk-test-sos"}
        if "request:created" in types and "request:routed" in types:
            got = types
            break
        time.sleep(0.5)
    check("request:created AND request:routed received", got is not None,
          f"types={sorted(t for t in (got or set()) if t)}")

    created = next((e for e in mock_events()
                    if e.get("event", {}).get("type") == "request:created"
                    and e["event"].get("id") == "splunk-test-sos"), None)
    check("HEC envelope correct (source/sourcetype/time)",
          bool(created) and created.get("source") == "sanjeevani"
          and created.get("sourcetype") == "_json" and isinstance(created.get("time"), (int, float)))
    check("searchable fields carried (pod, severity, transport)",
          bool(created) and created["event"].get("podId") == "POD-09"
          and created["event"].get("severity") == 9
          and created["event"].get("transport") == "satellite",
          f"event={created and created['event']}")

    routed = next((e for e in mock_events()
                   if e.get("event", {}).get("type") == "request:routed"
                   and e["event"].get("id") == "splunk-test-sos"), None)
    check("routing targets logged", bool(routed) and isinstance(routed["event"].get("targets"), list),
          f"targets={routed and routed['event'].get('targets')}")

    print("\n[2] Wrong token is rejected by HEC (auth is real, not decorative)")
    rejected = False
    try:
        req = urllib.request.Request(f"{MOCK}/services/collector/event",
                                     data=b'{"event":{"type":"forged"}}', method="POST",
                                     headers={"Authorization": "Splunk wrong-token"})
        urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as e:
        rejected = e.code == 401
    check("HEC rejects wrong token with 401", rejected)

    print("\n[3] Dead Splunk never blocks an SOS (enhancer, never gatekeeper)")
    PROCS.pop("mock-splunk").kill()
    time.sleep(1)
    t0 = time.time()
    response = http("POST", f"{CLOUD}/api/requests", {
        "id": "splunk-dead-sos", "podId": "POD-01", "category": "Rescue",
        "name": "Dead Splunk Test", "message": "Trapped near the river, need boat rescue",
    })
    elapsed = time.time() - t0
    check("SOS accepted with Splunk down", bool(response.get("success", True)), f"{elapsed:.2f}s")
    reqs = http("GET", f"{CLOUD}/api/requests")["data"]
    check("SOS stored and routed normally",
          any(r["id"] == "splunk-dead-sos" and r.get("routing", {}).get("targets") for r in reqs))
    check("storing stayed fast (no Splunk wait)", elapsed < 2.0, f"{elapsed:.2f}s")

    print("\n" + "=" * 60)
    passed = sum(1 for _, ok in RESULTS if ok)
    print(f"RESULT: {passed}/{len(RESULTS)} checks passed")
    if passed != len(RESULTS):
        sys.exit(1)
finally:
    for proc in PROCS.values():
        proc.kill()
