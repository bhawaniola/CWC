# SANJEEVANI Integrations

These scripts connect optional Cisco telemetry/configuration demos to the active 10-pod network through the root control center.

Start the stack first:

```powershell
docker compose up -d --build
```

The scripts default to:

```text
http://localhost:9000
```

## Local Demo Events

Run these without Cisco credentials:

```powershell
py integrations\meraki_live.py --demo --pod-id POD-01
py integrations\catalyst_restconf.py --demo --pod-id POD-01
```

Then check:

```powershell
curl.exe http://localhost:9000/api/integrations/events
curl.exe http://localhost:9000/api/state
```

## Real Meraki

Set `MERAKI_API_KEY`, then run:

```powershell
py integrations\meraki_live.py --feed-control-center --pod-id POD-01
py integrations\meraki_live.py --feed-pod http://localhost:8001
```

This reads real Meraki Dashboard telemetry and can either post the latest sensor event into the control center or feed it into an active pod's `/sensor` endpoint:

```text
POST /api/integrations/meraki/sensor
POST http://localhost:8001/sensor
```

## Real Catalyst IOS-XE

Set `IOSXE_HOST`, `IOSXE_USER`, and `IOSXE_PASS`, then run:

```powershell
py integrations\catalyst_restconf.py --pod-id POD-01
py integrations\catalyst_restconf.py --configure --pod-id POD-01
```

This reads RESTCONF interface data and posts a device event into:

```text
POST /api/integrations/catalyst/device
```
