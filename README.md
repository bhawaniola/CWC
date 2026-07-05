# SANJEEVANI — POC Simulation

Docker simulation of the SANJEEVANI resilient disaster management network
(see `../SANJEEVANI-Idea-and-Architecture.md`). Pods can only reach the
control center **through** transport containers, so stopping a container
genuinely kills that path and triggers the failover ladder.

```
                       ┌─────────────────┐
                       │  control_center │  EOC dashboard :9000
                       │  (Redis queue,  │  (Kafka stand-in: Redis Streams,
                       │  triage, alerts)│   SOS priority lane)
                       └────────▲────────┘
              ┌────────────┬────┴───────┬─────────────┐
        ┌─────┴─────┐ ┌────┴──────┐ ┌───┴───────┐
        │ satellite │ │cell_tower1│ │cell_tower2│      <- relay containers
        │   :9101   │ │   :9102   │ │   :9103   │
        └─────▲─────┘ └────▲──────┘ └───▲───────┘
          all pods      pod1, pod2    pod3, pod4        <- coverage (see topology.yaml)
              │             │             │
        ┌─────┴──────┬──────┴──────┬──────┴──────┬──────────┐
        │   pod1     │    pod2     │    pod3     │   pod4   │
        │   :9201    │    :9202    │    :9203    │   :9204  │
        └────────────┴─────────────┴─────────────┴──────────┘
             pod1 ↔ pod2 ↔ pod3 ↔ pod4  (URWB mesh, max 2 hops)
```

## Run it

```bash
cd sanjeevani
docker compose up --build          # first build takes a few minutes
```

| URL | What |
|---|---|
| http://localhost:9000 | EOC dashboard (paths, pods, triaged events, Shield security) |
| http://localhost:9201..9204 | Citizen portals for pod1..pod4 (type or 🎤 speak) |
| http://localhost:9101/health | Satellite relay health (9102/9103 = towers) |

Optional: `copy .env.example .env` and add a Webex bot token + room id for
real incident-room posts, and/or an Anthropic key for LLM triage. Without
them the demo still works (rules-based triage, Webex posts logged).

## Demo storyline (matches the pitch)

**1. Multi-hazard early warning (hazard packs, zero code changes):**
```bash
python scripts/replay_flood.py    # rising river at pod1 -> flood pack fires
python scripts/replay_quake.py    # 0.8 g shock at pod3 -> quake pack fires instantly
```
Each trigger flips the pod to disaster mode and broadcasts a **signed** alert
to every pod (see the green "✓ Verified" banner on the portals).

**2. Citizen triage:** open http://localhost:9201, speak or type
*"my grandfather needs insulin"* → watch it appear triaged (severity, category,
reason) on the dashboard; severity ≥ 8 also posts to Webex if configured.

**3. The failover ladder (the showstopper):**
```powershell
scripts\demo_failover.ps1          # guided, step by step
```
or manually:
```bash
curl "http://localhost:9101/set?loss=0.4"   # rain fade -> predictive failover (DEGRADED)
docker stop satellite                        # satellite dead -> pods on their towers
docker stop cell_tower_2                     # south tower dead -> pod3/4 go MESH (Tier 1)
docker stop cell_tower_1                     # everything dead -> ISLAND MODE (Tier 0)
# submit portal requests now -> "queued offline"
docker start satellite                       # recovery -> queue drains, events tagged "synced from queue"
docker start cell_tower_1 cell_tower_2
curl "http://localhost:9101/set?loss=0"
```

**4. Shield — the decoy-alert attack is rejected:**
```bash
python scripts/inject_forged_alert.py   # forged evacuation order -> HTTP 401 + red security event
```
Compare with the dashboard's "Broadcast signed test alert" button (Ed25519-signed → accepted).

## POC → production mapping (for judges)

| In this simulation | In production |
|---|---|
| pod-agent container | IOx containers on Cisco Catalyst IR1800 |
| satellite / cell_tower relay containers | LEO/5G-NTN terminal, Meraki MG cellular via Meraki MX SD-WAN |
| `/relay` mesh hop between pods | Cisco URWB (Catalyst IW9165/9167) inter-shelter mesh |
| relay `/health` polling + loss threshold | ThousandEyes path telemetry, predictive failover |
| Redis Streams (SOS + standard lanes) | Kafka priority topics, partitioned by district |
| Rules/LLM triage in control-center | Triage microservices on Kubernetes (HPA) |
| Ed25519-signed alerts, verified at pods | SANJEEVANI-Shield trusted alert pipeline |
| Webex posts (real API when token set) | Webex incident rooms + Webex Connect SMS blasts |
| EOC dashboard | Splunk dashboards |
| `hazard-packs/*.yaml` | Same concept — new disaster = new YAML pack |

Known simplifications: control-center delivers alerts to pods directly
(production uses the same WAN paths); coverage is declared in
`topology.yaml` (production: RF planning); mesh is capped at 2 hops.

## Real Cisco device integration (free — turns "simulated" into "live")

`integrations/` contains scripts that talk to **real Cisco products**, not
stand-ins. Both need a free Cisco DevNet account (https://developer.cisco.com
→ Sandbox catalog) for credentials:

| Script | Cisco product | What it proves |
|---|---|---|
| `meraki_live.py` | Meraki Dashboard API (Always-On sandbox or trial org) | Lists a real org's MR/MS/MX/MT/MV devices mapped to SANJEEVANI roles; pulls **real MT sensor readings**; `--feed-pod http://localhost:9201` pipes a genuine Meraki temperature reading into the hazard engine (`heatwave.yaml` pack) |
| `catalyst_restconf.py` | Catalyst 8000v, IOS-XE Always-On sandbox | Reads interfaces over RESTCONF; `--configure` pushes a SANJEEVANI-tagged config and reads it back — config-by-code on real IOS-XE, the same mechanism the pod's Catalyst switch would use for VLAN/QoS zero-touch setup |

```powershell
$env:MERAKI_API_KEY = "<key from DevNet Meraki sandbox page>"
py -3.13 integrations/meraki_live.py --feed-pod http://localhost:9201

$env:IOSXE_PASS = "<password from DevNet IOS-XE sandbox page>"
py -3.13 integrations/catalyst_restconf.py --configure
```

Also already live when configured in `.env`: **Webex** (real rooms/messages)
and **Claude LLM triage**. Further options for the demo video: **Cisco
Modeling Labs Free** (5 virtual IOS-XE nodes — build the pod LAN with real
VLAN/QoS config), **Packet Tracer** (free via NetAcad — visual pod topology),
**Duo Free** (real MFA on the EOC dashboard, up to 10 users), **ThousandEyes
trial** (real path telemetry replacing the relay `/health` probes).

## Add a new disaster type

Drop a YAML file in `pod-agent/hazard-packs/` (sensor, threshold, optional
trend rule, alert text), `docker compose up --build pod1..pod4` — done.
That is the multi-hazard architecture in one sentence.
