"""Flood hazard pack demo: replay a rising river curve into pod1's sensor feed.
Watch the dashboard — around 130+ cm the trend rule fires, pod1 flips to
disaster mode, and a signed alert broadcasts to every pod."""
import json
import time
import urllib.request

POD = "http://localhost:9201"
CURVE = [60, 68, 75, 84, 95, 108, 122, 138, 155, 170]

for v in CURVE:
    req = urllib.request.Request(
        f"{POD}/sensor", data=json.dumps({"sensor": "water_level", "value": v}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            out = json.loads(r.read())
        fired = f"  << TRIGGERED {out['fired']}" if out.get("fired") else ""
        print(f"water_level={v} cm  mode={out['mode']}{fired}")
    except Exception as e:
        print(f"water_level={v} cm  (pod unreachable: {e})")
    time.sleep(1)
