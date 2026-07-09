"""End-to-end check of the AI triage chain against a mock Ollama:
1. keyword-missed SOS gets LOW severity, then the AI upgrades it to 9,
   flips criticality, and hospital roles appear in routing;
2. SITREP endpoint returns the generated report;
3. with the model unreachable, requests stay rule-based and nothing breaks."""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRATCH = os.path.dirname(os.path.abspath(__file__))
PROCS = []
RESULTS = []


def http(method, url, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or "{}")


def start(args, cwd, env_extra, logname):
    env = {**os.environ, **env_extra}
    log = open(os.path.join(SCRATCH, logname), "w")
    PROCS.append((subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=log), log))


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
    start(["node", "mock_ollama.js"], SCRATCH, {"PORT": "11434"}, "mock-ollama.log")
    start(["node", "server.js"], os.path.join(ROOT, "Command-Center", "Backend"),
          {"PORT": "9100", "OLLAMA_URL": "http://127.0.0.1:11434",
           "AI_TRIAGE_MODEL": "qwen2.5:3b", "AI_TRIAGE_ENABLED": "true",
           "MONGODB_TIMEOUT_MS": "500"}, "cloud-ai.log")
    assert wait_up("http://127.0.0.1:11434/api/tags"), "mock ollama did not start"
    assert wait_up("http://127.0.0.1:9100/api/health"), "cloud did not start"

    print("\n[1] AI health endpoint")
    health = http("GET", "http://127.0.0.1:9100/api/ai/health")["data"]
    check("ai health reports ready", health.get("status") == "ready", str(health.get("status")))

    print("\n[2] Keyword-missed SOS -> AI upgrade")
    req = http("POST", "http://127.0.0.1:9100/api/requests",
               {"id": "ai-test-1", "name": "Ramu", "category": "Other",
                "message": "my chest feels heavy and I'm dizzy",
                "location": "Kothapalli Zone 3", "podId": "POD-03",
                "triage": {"severity": 3}})
    check("request accepted with rule severity 3",
          req["data"]["triage"]["severity"] == 3, f"sev={req['data']['triage']['severity']}")

    verdict = None
    for _ in range(30):
        stored = next(item for item in http("GET", "http://127.0.0.1:9100/api/requests")["data"]
                      if item["id"] == "ai-test-1")
        if stored.get("aiTriage", {}).get("status") == "complete":
            verdict = stored
            break
        time.sleep(0.5)

    check("AI verdict arrived", verdict is not None)
    if verdict:
        check("severity upgraded 3 -> 9", verdict["triage"]["severity"] == 9,
              f"sev={verdict['triage']['severity']}")
        check("marked critical", verdict.get("isCritical") is True)
        check("upgrade flagged with reason", verdict["aiTriage"].get("upgraded") is True
              and "cardiac" in verdict["aiTriage"].get("reason", ""))
        roles = verdict.get("routing", {}).get("classification", {}).get("roles", [])
        check("hospital role added to routing", "hospital" in roles, f"roles={roles}")
        evidence = json.dumps(verdict.get("routing", {}).get("classification", {}).get("departments", []))
        check("routing evidence names AI triage", "AI triage" in evidence)

    print("\n[3] SITREP")
    sitrep = http("POST", "http://127.0.0.1:9100/api/sitrep", {})
    check("sitrep generated", sitrep.get("success") is True
          and "SITUATION" in sitrep.get("data", {}).get("report", ""))
    cached = http("GET", "http://127.0.0.1:9100/api/sitrep")
    check("sitrep cached for reload", cached.get("data", {}).get("report") == sitrep["data"]["report"])

    print("\n[4] Model down -> rule-based verdict stands, nothing blocked")
    PROCS[0][0].terminate()
    time.sleep(1)
    req = http("POST", "http://127.0.0.1:9100/api/requests",
               {"id": "ai-test-2", "name": "Sita", "category": "Other",
                "message": "need some information about relief camp",
                "location": "Zone 2", "podId": "POD-05", "triage": {"severity": 3}})
    check("request still accepted instantly", req.get("success") is True)
    fallback = None
    for _ in range(30):
        stored = next(item for item in http("GET", "http://127.0.0.1:9100/api/requests")["data"]
                      if item["id"] == "ai-test-2")
        if stored.get("aiTriage"):
            fallback = stored
            break
        time.sleep(0.5)
    check("marked unavailable, severity untouched",
          fallback is not None and fallback["aiTriage"]["status"] == "unavailable"
          and fallback["triage"]["severity"] == 3)

    print("\n" + "=" * 60)
    failed = [label for label, ok in RESULTS if not ok]
    print(f"RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("Failed:", *failed, sep="\n  - ")
        sys.exit(1)
    print("AI TRIAGE CHAIN VERIFIED (mock model).")
finally:
    for proc, log in PROCS:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
