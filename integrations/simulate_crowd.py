"""Surge realism: N distinct victims (unique x-device-id per device) submit
SOS requests to one pod over ~a minute. Run during a failover demo to show
the queue absorbing a crowd while the SOS priority ordering holds.

Usage:  py -3 integrations/simulate_crowd.py [count] [pod_url]
        py -3 integrations/simulate_crowd.py 30 http://localhost:8001
"""
import json
import random
import sys
import time
import urllib.request
import uuid

COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 20
POD = (sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8001").rstrip("/")

NAMES = ["Ramesh", "Anita", "Kiran", "Meena", "Dev", "Sunita", "Arjun", "Lakshmi",
         "Vikram", "Priya", "Ravi", "Geeta", "Sanjay", "Kavita", "Mohan"]
CASES = [
    ("Medical", "my grandfather needs insulin and cannot walk"),
    ("Medical", "pregnant woman having labour pains"),
    ("Rescue", "two people trapped near the old bridge"),
    ("Rescue", "roof collapsed, child stuck inside"),
    ("Water", "we need clean drinking water for 20 people"),
    ("Food", "need food packets for the community hall"),
    ("Shelter", "family of six needs shelter for the night"),
    ("Other", "phone battery dying, please note our location"),
]

ok = throttled = failed = 0
for i in range(COUNT):
    name = random.choice(NAMES)
    category, message = random.choice(CASES)
    body = json.dumps({
        "name": f"{name} {i+1}", "age": random.randint(18, 80),
        "phone": f"+91 9{random.randint(100000000, 999999999)}",
        "category": category, "message": message,
        "location": f"Zone {random.randint(1, 6)}",
    }).encode()
    req = urllib.request.Request(
        f"{POD}/api/requests", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "x-device-id": f"victim-{uuid.uuid4().hex[:8]}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            ok += 1
            print(f"[{i+1}/{COUNT}] {name}: {category} -> HTTP {r.status}")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            throttled += 1
            print(f"[{i+1}/{COUNT}] {name}: rate-limited (429)")
        else:
            failed += 1
            print(f"[{i+1}/{COUNT}] {name}: HTTP {e.code}")
    except Exception as e:
        failed += 1
        print(f"[{i+1}/{COUNT}] {name}: {e}")
    time.sleep(random.uniform(0.5, 2.0))

print(f"\nDone: {ok} accepted, {throttled} rate-limited, {failed} failed.")
print(f"Check the pod queue: {POD}/api/queue  and the cloud: http://localhost:9000/api/requests")
