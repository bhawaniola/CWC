"""Earthquake hazard pack demo: quiet ground, then a 0.8 g shock at pod3.
No lead time — the pack fires instantly (post-event playbook)."""
import json
import time
import urllib.request

POD = "http://localhost:9203"
READINGS = [0.02, 0.03, 0.02, 0.05, 0.8]

for v in READINGS:
    req = urllib.request.Request(
        f"{POD}/sensor", data=json.dumps({"sensor": "shake_g", "value": v}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            out = json.loads(r.read())
        fired = f"  << TRIGGERED {out['fired']}" if out.get("fired") else ""
        print(f"shake_g={v}  mode={out['mode']}{fired}")
    except Exception as e:
        print(f"shake_g={v}  (pod unreachable: {e})")
    time.sleep(1)
