"""LIVE Cisco Catalyst (IOS-XE) integration — RESTCONF config-by-code.

Talks to a real (virtual) Catalyst 8000v in the Cisco DevNet sandbox:
reads interfaces, and with --configure pushes a loopback interface tagged
for SANJEEVANI — proving the pod's 'zero-touch segmentation' story with
actual IOS-XE configuration from Python.

Setup (free):
  1. https://developer.cisco.com -> Sandbox catalog -> "IOS XE Always-On"
     (Catalyst 8000v). The sandbox page shows current host + credentials.
  2. set IOSXE_HOST / IOSXE_USER / IOSXE_PASS accordingly.

Usage:
  py -3.13 integrations/catalyst_restconf.py             # read-only
  py -3.13 integrations/catalyst_restconf.py --configure # push + verify
"""
import argparse
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

HOST = os.getenv("IOSXE_HOST", "sandbox-iosxe-latest-1.cisco.com")
USER = os.getenv("IOSXE_USER", "developer")
PASS = os.getenv("IOSXE_PASS", "")
DEFAULT_CONTROL_CENTER = os.getenv("CONTROL_CENTER_URL", "http://localhost:9000")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE          # sandbox uses a self-signed cert
AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()
HDRS = {"Accept": "application/yang-data+json",
        "Content-Type": "application/yang-data+json", "Authorization": AUTH}


def restconf(method, path, body=None):
    req = urllib.request.Request(
        f"https://{HOST}/restconf/data/{path}", method=method,
        data=json.dumps(body).encode() if body else None, headers=HDRS)
    with urllib.request.urlopen(req, timeout=25, context=CTX) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def post_json(url, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def report_device(control_center, pod_id, host, names, configured=False, raw=None):
    payload = {
        "podId": pod_id,
        "host": host,
        "deviceName": "Catalyst IOS-XE",
        "interfaceCount": len(names),
        "interfaces": names[:12],
        "configured": configured,
        "raw": raw,
    }
    return post_json(f"{control_center.rstrip('/')}/api/integrations/catalyst/device", payload)


def parser():
    p = argparse.ArgumentParser(description="Connect Catalyst RESTCONF to SANJEEVANI control center.")
    p.add_argument("--control-center", default=DEFAULT_CONTROL_CENTER,
                   help="SANJEEVANI control center URL. Default: http://localhost:9000")
    p.add_argument("--pod-id", default="POD-01",
                   help="SANJEEVANI pod id to map the device event to.")
    p.add_argument("--demo", action="store_true",
                   help="Do not call IOS-XE. Send a local sample device event to control center.")
    p.add_argument("--configure", action="store_true",
                   help="Push and verify the SANJEEVANI loopback marker.")
    return p


LOOPBACK = {"ietf-interfaces:interface": {
    "name": "Loopback101", "type": "iana-if-type:softwareLoopback",
    "enabled": True,
    "description": "SANJEEVANI pod1 citizens-segment marker (configured by code)",
    "ietf-ip:ipv4": {"address": [{"ip": "10.99.1.1", "netmask": "255.255.255.255"}]}}}


def main():
    args = parser().parse_args()

    if args.demo:
        out = report_device(
            args.control_center,
            args.pod_id,
            "demo-ios-xe",
            ["GigabitEthernet1", "GigabitEthernet2", "Loopback101"],
            configured=True,
            raw={"mode": "demo", "source": "integrations/catalyst_restconf.py"})
        print(f"Sent demo Catalyst event to {args.control_center}:")
        print(json.dumps(out, indent=2))
        return

    if not PASS:
        sys.exit("IOSXE_PASS not set — get current sandbox credentials from "
                 "the DevNet 'IOS XE Always-On' sandbox page (free account).")
    try:
        data = restconf("GET", "ietf-interfaces:interfaces")
    except urllib.error.HTTPError as e:
        sys.exit(f"RESTCONF returned {e.code} — credentials expired/changed; "
                 "check the sandbox page for the current ones.")
    names = [i["name"] for i in data["ietf-interfaces:interfaces"]["interface"]]
    print(f"Connected to REAL IOS-XE device {HOST}")
    print(f"Interfaces: {', '.join(names[:8])}")

    configured = False
    if args.configure:
        restconf("PUT", "ietf-interfaces:interfaces/interface=Loopback101",
                 LOOPBACK)
        back = restconf("GET", "ietf-interfaces:interfaces/interface=Loopback101")
        configured = True
        print("\nPushed and verified config on the Catalyst:")
        print(json.dumps(back, indent=2))
        print("\nThis is the same mechanism (NETCONF/RESTCONF) the pod's "
              "Catalyst 9200/IE3300 would use for zero-touch VLAN + QoS setup.")

    out = report_device(args.control_center, args.pod_id, HOST, names, configured)
    print(f"\nReported Catalyst RESTCONF event to {args.control_center}:")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
