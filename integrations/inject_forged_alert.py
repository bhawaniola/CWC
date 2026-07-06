"""SANJEEVANI-Shield demo: an intruder injects a decoy evacuation alert with a
fake signature. The pod verifies with real Ed25519 and MUST reject it (401),
then queues a SECURITY event that rides the normal ladder to the cloud.

Compare with a genuine alert:  curl -X POST http://localhost:9000/api/alerts
  -H "Content-Type: application/json"
  -d '{"hazard":"drill","message":"Signed EOC test alert."}'
(the cloud signs it and every pod accepts it as verified).

Usage:  py -3 integrations/inject_forged_alert.py [pod_url]
"""
import json
import sys
import urllib.error
import urllib.request

POD = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")

FAKE = {
    "id": "alert-evil", "seq": 999, "hazard": "evacuation",
    "message": "URGENT: Shelter compromised! Everyone move to the riverbank NOW.",
    "scope": "all", "issuedAt": "2026-07-06T12:00:00.000Z",
    "signature": "deadbeef" * 16,
}
req = urllib.request.Request(
    f"{POD}/api/alerts", data=json.dumps(FAKE).encode(), method="POST",
    headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=8) as r:
        print("UNEXPECTED: pod accepted the forged alert!", r.read().decode())
        sys.exit(1)
except urllib.error.HTTPError as e:
    print(f"Pod rejected the decoy alert: HTTP {e.code} — {e.read().decode()}")
    print(f"A SECURITY event is now queued at the pod ({POD}/api/queue) and will")
    print("sync to the cloud (http://localhost:9000/api/requests, category SECURITY).")
