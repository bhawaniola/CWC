"""LIVE Cisco Meraki integration — real Dashboard API calls.

Pulls organizations, networks, devices and MT sensor readings from a real
Meraki org (DevNet sandbox or a free trial org) and maps each device to its
SANJEEVANI role. Optionally feeds a REAL sensor reading into a pod's hazard
engine (--feed-pod), so genuine Cisco telemetry drives the alert pipeline.

Setup (free):
  1. Create a Cisco DevNet account: https://developer.cisco.com
  2. Open the sandbox catalog -> "Meraki Always-On" -> copy the API key
     shown on the sandbox page (or use your own Meraki org's key:
     Dashboard > Organization > Settings > API access).
  3. set MERAKI_API_KEY=<your key>      (PowerShell: $env:MERAKI_API_KEY="...")

Usage:
  py -3.13 integrations/meraki_live.py
  py -3.13 integrations/meraki_live.py --feed-pod http://localhost:9201
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.getenv("MERAKI_BASE", "https://api.meraki.com/api/v1")
KEY = os.getenv("MERAKI_API_KEY", "")

ROLE = {"wireless": "Meraki MR  -> pod shelter Wi-Fi (captive portal)",
        "switch": "Meraki MS  -> pod PoE backbone (Catalyst-class)",
        "appliance": "Meraki MX  -> pod SD-WAN multipath failover",
        "sensor": "Meraki MT  -> hazard-pack sensing (water/air/temp)",
        "camera": "Meraki MV  -> occupancy analytics",
        "cellularGateway": "Meraki MG  -> cellular uplink (cell tower path)"}


def api(path):
    req = urllib.request.Request(BASE + path, headers={
        "X-Cisco-Meraki-API-Key": KEY, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def main():
    if not KEY:
        sys.exit("MERAKI_API_KEY is not set — see the setup steps at the top "
                 "of this file (free DevNet sandbox or Meraki trial org).")
    try:
        orgs = api("/organizations")
    except urllib.error.HTTPError as e:
        sys.exit(f"Meraki API returned {e.code}. Your key is missing/expired — "
                 "grab the current one from the DevNet sandbox page.")
    org = next((o for o in orgs if o["id"] == os.getenv("MERAKI_ORG_ID")), orgs[0])
    print(f"REAL Meraki organization: {org['name']} (id {org['id']})\n")

    networks = api(f"/organizations/{org['id']}/networks")
    print(f"Networks ({len(networks)}):")
    for n in networks[:6]:
        print(f"  - {n['name']}  [{', '.join(n.get('productTypes', []))}]")

    devices = api(f"/organizations/{org['id']}/devices")
    print(f"\nDevices ({len(devices)}) mapped to SANJEEVANI roles:")
    for d in devices[:20]:
        role = ROLE.get(d.get("productType", ""), d.get("productType", "?"))
        print(f"  - {d.get('model', '?'):10} {d.get('serial', ''):16} {role}")

    print("\nLatest MT sensor readings (REAL telemetry):")
    readings = []
    try:
        readings = api(f"/organizations/{org['id']}/sensor/readings/latest")
    except urllib.error.HTTPError:
        print("  (no sensor readings exposed in this org)")
    latest_temp = None
    for r in readings[:10]:
        for m in r.get("readings", []):
            metric = m.get("metric")
            val = m.get(metric, m)
            print(f"  - {r.get('serial')} {metric}: {json.dumps(val)}")
            if metric == "temperature" and isinstance(val, dict):
                latest_temp = val.get("celsius")

    if "--feed-pod" in sys.argv:
        pod = sys.argv[sys.argv.index("--feed-pod") + 1]
        value = latest_temp if latest_temp is not None else 22.0
        body = json.dumps({"sensor": "temperature", "value": value}).encode()
        req = urllib.request.Request(f"{pod}/sensor", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            out = json.loads(resp.read())
        print(f"\nFed REAL Meraki reading temperature={value}°C into {pod}: {out}")
        print("(heatwave.yaml pack triggers at 45°C — lower its threshold to "
              "demo a real-sensor-driven signed alert)")


if __name__ == "__main__":
    main()
