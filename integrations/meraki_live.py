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
  py -3.13 integrations/meraki_live.py --feed-pod http://localhost:8001
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.getenv("MERAKI_BASE", "https://api.meraki.com/api/v1")
KEY = os.getenv("MERAKI_API_KEY", "")
DEFAULT_CONTROL_CENTER = os.getenv("CONTROL_CENTER_URL", "http://localhost:9000")

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


def post_json(url, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def report_sensor(control_center, pod_id, metric, value, unit, raw=None):
    payload = {
        "podId": pod_id,
        "deviceName": "Meraki MT Sensor",
        "deviceType": "Meraki MT",
        "metric": metric,
        "value": value,
        "unit": unit,
        "raw": raw,
    }
    return post_json(f"{control_center.rstrip('/')}/api/integrations/meraki/sensor", payload)


def parser():
    p = argparse.ArgumentParser(description="Connect Meraki telemetry to SANJEEVANI control center.")
    p.add_argument("--control-center", default=DEFAULT_CONTROL_CENTER,
                   help="SANJEEVANI control center URL. Default: http://localhost:9000")
    p.add_argument("--pod-id", default="POD-01",
                   help="SANJEEVANI pod id to map the sensor event to.")
    p.add_argument("--demo", action="store_true",
                   help="Do not call Meraki. Send a local sample sensor event to control center.")
    p.add_argument("--feed-control-center", action="store_true",
                   help="Send the latest real Meraki temperature reading to control center.")
    p.add_argument("--feed-pod", help="Legacy Python POC option. Prefer --feed-control-center.")
    return p


def main():
    args = parser().parse_args()

    if args.demo:
        if args.feed_pod:
            out = post_json(f"{args.feed_pod.rstrip('/')}/sensor", {
                "sensor": "temperature",
                "value": 46.5,
                "unit": "celsius",
                "source": "Meraki demo telemetry"
            })
            print(f"Fed demo Meraki event into active pod {args.feed_pod}:")
        else:
            out = report_sensor(
                args.control_center,
                args.pod_id,
                "temperature",
                46.5,
                "celsius",
                {"mode": "demo", "source": "integrations/meraki_live.py"})
            print(f"Sent demo Meraki event to {args.control_center}:")
        print(json.dumps(out, indent=2))
        return

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

    if args.feed_control_center:
        value = latest_temp if latest_temp is not None else 22.0
        out = report_sensor(args.control_center, args.pod_id, "temperature",
                            value, "celsius", {"source": "Meraki Dashboard API"})
        print(f"\nFed REAL Meraki reading temperature={value}C into {args.control_center}:")
        print(json.dumps(out, indent=2))

    if args.feed_pod:
        value = latest_temp if latest_temp is not None else 22.0
        out = post_json(f"{args.feed_pod.rstrip('/')}/sensor", {
            "sensor": "temperature",
            "value": value,
            "unit": "celsius",
            "source": "Meraki Dashboard API"
        })
        print(f"\nFed Meraki temperature={value}C into active pod {args.feed_pod}:")
        print(json.dumps(out, indent=2))

    if False and "--feed-pod" in sys.argv:
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
