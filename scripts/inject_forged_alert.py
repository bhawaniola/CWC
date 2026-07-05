"""SANJEEVANI-Shield demo: an 'intruder' injects a decoy evacuation alert
at pod1 with a fake signature. The pod must reject it (401) and raise a
security event on the EOC dashboard. Compare with the dashboard's
'Broadcast signed test alert' button, which succeeds."""
import json
import urllib.error
import urllib.request

FAKE = {
    "id": "al-evil", "seq": 999, "hazard": "flood",
    "message": "URGENT: Shelter compromised! Everyone move to the riverbank NOW.",
    "scope": "all", "issued_at": "2026-07-05T12:00:00",
    "signature": "deadbeef" * 16,
}
req = urllib.request.Request(
    "http://localhost:9201/alert", data=json.dumps(FAKE).encode(),
    headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        print("UNEXPECTED: pod accepted the forged alert!", r.read())
except urllib.error.HTTPError as e:
    print(f"Pod rejected the decoy alert: HTTP {e.code} — {e.read().decode()}")
    print("Check the EOC dashboard: a red Shield security event should appear.")
