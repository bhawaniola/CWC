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


LOOPBACK = {"ietf-interfaces:interface": {
    "name": "Loopback101", "type": "iana-if-type:softwareLoopback",
    "enabled": True,
    "description": "SANJEEVANI pod1 citizens-segment marker (configured by code)",
    "ietf-ip:ipv4": {"address": [{"ip": "10.99.1.1", "netmask": "255.255.255.255"}]}}}


def main():
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

    if "--configure" in sys.argv:
        restconf("PUT", "ietf-interfaces:interfaces/interface=Loopback101",
                 LOOPBACK)
        back = restconf("GET", "ietf-interfaces:interfaces/interface=Loopback101")
        print("\nPushed and verified config on the Catalyst:")
        print(json.dumps(back, indent=2))
        print("\nThis is the same mechanism (NETCONF/RESTCONF) the pod's "
              "Catalyst 9200/IE3300 would use for zero-touch VLAN + QoS setup.")


if __name__ == "__main__":
    main()
