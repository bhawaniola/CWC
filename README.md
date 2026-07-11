# SANJEEVANI — Self-Healing Disaster Lifeline Network

SANJEEVANI is a Docker simulation of a complete disaster-response network: **ten citizen pods**, **nine relief-team coordinator dashboards** (hospitals, shelters, workforce camps, fire, flood rescue), a **Cisco Meraki-style sensor layer** that raises its own alarms, and an **EOC Command Center** — all connected by shared satellite/cellular link-nodes, URWB-style pod mesh relay, and island-mode local caching.

Pods do not post directly to the cloud. A pod must forward through the satellite link-node, a configured cell tower link-node, or a mesh neighbor that still has one of those uplinks. If no path is available, the SOS is stored in that pod's local queue and retried every 5 seconds — **a message can be delayed, but it is never lost**.

Three design principles run through the whole system:

1. **Every message has two lives** — a local one (direct radio push to relief teams in range, works with zero internet) and a global one (store-and-forward to the cloud over whatever link survives).
2. **Idempotency everywhere** — one ID per event, deduplication at every hop (`seenVia` records each path the same request arrived on), first-arrival timestamps that duplicates can never reset.
3. **A closed feedback loop** — field actions flow back up: coordinators acknowledge/resolve requests, report resource shortages, and the Command Center routes new requests around out-of-stock teams and archives closed cases.

## Folder Structure

```text
.
|-- docker-compose.yml
|-- Command-Center/            # EOC frontend + cloud backend module
|   |-- Frontend/              # command-center React/Vite UI + proxy on port 9400
|   `-- Backend/               # cloud API on port 9000 with MongoDB + sockets
|-- coordinators/              # shared relief-team dashboard image (9 containers)
|   |-- client/                # React/Vite coordinator UI (tabs, lifecycle, history)
|   `-- server.js              # role templates, inbox, sync queue, shortage events
|-- link-node/                 # shared satellite and celltower service image
|-- sensor-simulator/          # simulated Meraki MT10/MT12/MT14 sensors + MT30 buttons
|-- simulation-controller/     # network drill controller + sensor spike UI on port 9300
|-- pod-agent/                 # shared pod backend and React/Vite citizen SOS UI
|   |-- client/                # modular React frontend source
|   |-- public/                # legacy static fallback
|   `-- services/              # routing, queue, settings, hazard, triage modules
|-- integrations/              # optional external demo feeders + integration test
|-- pod-data/                  # generated pod runtime state, ignored by git
`-- coordinator-data/          # generated coordinator state (inbox, history, sync queue)
```

## Run

```powershell
docker compose up -d --build
```

The first start downloads the local AI model (~2 GB, one time) into the
`ollama-models` volume; AI triage comes online a few minutes later. Everything
else works immediately — the AI is an enhancer, never a dependency.

Open:

```text
Command Center (EOC):      http://localhost:9400      <-- START HERE
POD-01..POD-10 (citizen):  http://localhost:8001 .. http://localhost:8010

Relief-team coordinators:
  Hospital 1 Command:      http://localhost:8101
  Hospital 2 Command:      http://localhost:8102
  Shelter A Camp:          http://localhost:8103
  Shelter B Camp:          http://localhost:8104
  Shelter C Camp:          http://localhost:8105
  Workforce Camp 1:        http://localhost:8106
  Workforce Camp 2:        http://localhost:8107
  Fire Coordinator:        http://localhost:8108
  Flood Coordinator 1:     http://localhost:8109

Cloud API health:          http://localhost:9000/api/health
Satellite health:          http://localhost:9100/health
CELLTOWER-1 health:        http://localhost:9201/health
CELLTOWER-2 health:        http://localhost:9202/health
Simulation controller UI:  http://localhost:9300      (network drills + sensor spikes)
Sensor simulator API:      http://localhost:9500/status
```

## Active Services

```text
command-center           EOC dashboard aggregating the whole network (port 9400)
cloud-api                backend API: MongoDB storage, keyword routing, delivery
                         receipts, resolution tracking, signed alerts, AI triage
                         worker + SITREP generator (port 9000)
mongodb                  persistent database for the cloud API
ollama                   local LLM (qwen2.5:3b) for AI triage + SITREP; runs
                         fully inside the cluster, no external API (port 11434)
satellite                satellite middleman forwarding to cloud-api
celltower-1 / -2         cellular middlemen forwarding to cloud-api
simulation-controller    fails/restores satellite + towers, drives sensor spikes
sensor-simulator         Meraki MT fleet posting readings to pods every 4s (port 9500)
pod-01..pod-10           local pod SOS app, triage, routing engine, queue, mesh relay
*-coordinator (x9)       relief-team dashboards: role inbox, dispatch board,
                         request lifecycle, resource fields, own sync ladder
```

## Command Center (EOC dashboard) — http://localhost:9400

A single operator console (React/Vite, served by a Node aggregator in
`Command-Center/Frontend`). The cloud backend lives beside it in
`Command-Center/Backend`, persists to the `mongodb` container, and pushes
realtime socket events to the browser (with a polling fallback). Pages:

- **Dashboard** — KPI tiles (open/critical requests, pods online, current
  mode), live emergency requests (open cases only), pod network status,
  early-warning sensor feed, zone map, and the full activity feed. All real,
  from the cluster.
- **Requests** — the operator workbench, split into **Active** and
  **Past history**. Every card shows the triage severity pill *and* the
  lifecycle pill (`In Progress -> Assigned -> Acknowledged -> Resolved`),
  the routing logic, and one receipt chip per targeted coordinator
  (`delivered / queued / rejected / resolved` with the transport it used).
  When a field team marks a request handled, the card turns green and moves
  to Past history automatically.
- **Network** — live topology, QoS table, pod-route table, and **simulation
  controls that really fail/restore the satellite and cell tower containers**.
  Fail a link and watch the pod table reroute.
- **Resources / Volunteers** — live stock per coordinator, reported by the
  coordinators themselves. Every coordinator syncs its full resource state
  (a snapshot at boot, a slow heartbeat, and on every field edit) up its own
  satellite -> cellular -> mesh ladder; the page shows real values, capacity
  bars, declared `LOW STOCK` / `OUT OF STOCK` flags, and when each team last
  reported. Set Hospital 1's beds to 0 on its dashboard and watch this page
  flag it seconds later — the same signal the router uses to send new medical
  requests to Hospital 2 (scenario 13).
- **Alerts** — a real notification center: the bell badge counts only what
  arrived since the operator last opened this page (persisted per browser),
  plus the signed-alert broadcast box (Ed25519) and the Shield security log.

The three audiences are cleanly separated: **citizens** use the pod SOS pages
(8001-8010), **relief teams** use the coordinator dashboards (8101-8109), and
**the EOC operator** uses the command center (9400).

## Relief Coordinator Network — ports 8101-8109

Nine coordinator containers share one codebase (`coordinators/`); a role
template (hospital / shelter / workforce / fire / flood) shapes each dashboard:
role-specific resource fields, dispatch board, and keyword matching. Each
coordinator is a field office with an unreliable uplink — it runs the same
satellite -> cellular -> mesh -> island ladder as the pods and works fully
offline.

Key mechanics:

- **Two delivery paths into every inbox.** The cloud routes classified
  requests down to matching coordinators, AND pods push directly to
  coordinators pre-registered in their radio (URWB) range — so the local
  flood team hears a drowning SOS even when every uplink is destroyed.
  Duplicates merge by request ID; `seenVia` records both paths as proof of
  redundancy; the first arrival's timestamp always wins. Cards show
  `received 12:04 pm (sent 09:28 am)` when a request waited in an offline
  queue — the delay is visible and honest.
- **Request lifecycle.** Operators **Acknowledge** (team is on it) or
  **Mark handled** (archives to the coordinator's Past history tab). Both
  actions sync back to the cloud as resolution events — the Command Center
  flips the delivery receipt, updates the request card, and archives it.
  Resolving works offline too; the receipt syncs when a link returns.
- **Resource shortage loop.** A numeric resource at zero is `out-of-stock`
  (at <=10% of max: `low-stock`). The dashboard flags it, a shortage event
  syncs to the cloud, and the Command Center **routes new same-role requests
  to another coordinator that still has capacity** (falling back to the
  flagged one only if every coordinator of that role is out). Restocking
  sends a recovery notice.
- **Honest receipts.** `delivered` means the coordinator's server confirmed
  storage over HTTP. If a coordinator answers "not my role", the delivery is
  marked `rejected` (never fake-delivered, never retried). `resolved` only
  ever comes from a human clicking Mark handled.

## Sensor Layer — simulated Cisco Meraki fleet

`sensor-simulator/` plays the role of Meraki hardware: **MT10** temperature,
**MT12** water level, **MT14** air quality/PM2.5, a third-party accelerometer
feeding through a Catalyst IOx edge app, and **MT30** smart buttons. It posts
readings to each pod's `/api/sensors` every 4 seconds; spike/reset per sensor
from the simulation controller UI or `POST http://localhost:9500/spike/POD-06/air_quality`.

When a reading crosses a hazard-pack threshold (flood 150cm, heatwave 45C,
earthquake 0.4g, wildfire smoke 250ug/m3 — or a fast trend rise), the pod:

1. stores a **local warning** for citizens at that pod (works with zero network),
2. queues an **EARLY-WARNING** event up the ladder — the cloud answers with a
   **signed broadcast to every pod**,
3. pushes the alert **directly to responder coordinators in radio range**, and
   the cloud also delivers it to the hazard's declared responder roles
   (flood -> flood+shelter, wildfire -> fire+workforce, earthquake ->
   hospital+workforce, heatwave -> hospital+shelter) — no keyword luck needed.

The **MT30 button** is different: a physical press is an unambiguous call for
help, so it skips thresholds and enters the normal SOS pipeline at severity 9.

Citizen SOS triage happens at the pod (`pod-agent/services/triageService.js`):
critical keywords (breathing/oxygen/suffocation, bleeding, trapped, drowning,
...in 12 languages) -> severity 9 CRITICAL; essential-need keywords (food,
water, medicine, shelter) -> 6 HIGH; otherwise 3 LOW.

## AI Triage + SITREP — smart when connected, safe when dark

A local LLM (`ollama` container, qwen2.5:3b) lives at the cloud tier and
re-reads every citizen SOS **after** it is already stored, queued, and
delivered. Design rules, in order:

1. **Enhancer, never gatekeeper.** Nothing waits for the model. If it is slow,
   down, or still loading, the card just says "rule-based triage" and the
   keyword verdict stands. Edge nodes (pods/coordinators) stay rule-based by
   design — deterministic and battery-safe; intelligence lives where the data
   aggregates and power exists.
2. **Upgrade-only.** The AI can raise a severity or add responder roles the
   keywords missed ("my chest feels heavy and I'm dizzy" -> severity 9,
   hospital), but it can never downgrade or remove a rule match — and a late
   duplicate arriving over another path can never bury an AI upgrade (severity
   only climbs at every merge point: cloud store, delivery, coordinator inbox).
3. **The correction travels.** An upgrade re-routes the request to the newly
   identified coordinators and rides the normal delivery/pull paths down to
   their inboxes, where the card jumps up the severity order with the AI's
   one-line reason attached.
4. **Pattern view.** The Command Center dashboard has an AI **SITREP** button:
   the model reads every open request, shortage, sensor alert, and link status
   and writes a 30-second plain-English briefing (SITUATION / CRITICAL /
   RESOURCES / ACTIONS) — the cross-pod picture no single field team can see.

The model runs entirely inside the cluster — no external API, no internet
needed after the one-time pull — so the AI degrades exactly like the rest of
the network. Endpoints: `GET /api/ai/health`, `POST /api/sitrep` (cloud 9000,
proxied at the Command Center 9400). Verify the whole chain without Docker or
the real model:

```powershell
py -3 integrations/ai_triage_test.py
```

## Webex Alerts — Sanjeevni-Sentinel bot

The cloud posts real Cisco Webex messages into the responders' space
(`SANJEEVNI Alerts`) when: a **critical SOS** arrives, the **AI upgrades** a
request to critical (the alert says "caught by AI triage" with the model's
reason), or a **sensor early warning** fires. Alerts land as push
notifications on every member's phone — the field team hears about the
emergency even when nobody is watching a dashboard.

Setup: copy `.env.example` to `.env`, paste the bot token (from
developer.webex.com > My Webex Apps), and add `sanjeevni_sentinel@webex.bot`
to any Webex space — the bot auto-discovers its spaces, no ids needed.

Guard rails (same "enhancer, never gatekeeper" rule as the AI):
- fire-and-forget with timeout — dead internet costs a log line, nothing else;
- failed sends retry a few times (30s apart) with room re-discovery;
- one alert per request id ever, max 6/minute (a surge cannot spam phones);
- demo-seed requests and stale re-processed records never alert.

Endpoints: `GET /api/webex/health`, `POST /api/webex/test` (rehearsal ping).
The `.env` file is gitignored — the token must never reach GitHub.

## 10-Pod Topology

```text
                    cell tower    mesh neighbors      coordinators in radio range
POD-01 District     CELLTOWER-1   POD-02              Shelter A
POD-02 Hospital     CELLTOWER-1   POD-01, POD-03      Hospital 1
POD-03 School       CELLTOWER-1   POD-02              (none - cloud only)
POD-04 Riverbank    none          POD-05              Hospital 2, Shelter A
POD-05 Evacuation   CELLTOWER-1   POD-04              Shelter A, Fire Dept
POD-06 RemoteVill   none          none                Hospital 1, Shelter B, Flood
POD-07 Warehouse    CELLTOWER-2   POD-09              Hospital 2, Workforce 1
POD-08 MedicalCamp  CELLTOWER-2   none                Shelter C
POD-09 HighGround   none          POD-10, POD-07      Shelter C, Workforce 2, Flood
POD-10 MobileRelay  none          POD-09              (none - cloud only)
```

CELLTOWER-1 covers POD-01, POD-02, POD-03, and POD-05. CELLTOWER-2 covers POD-07 and POD-08. POD-06 is deliberately the most isolated node (satellite-only uplink, no mesh neighbors) — but three relief teams sit in its radio range, so it is the best pod for the "uplink destroyed, help still arrives" demo. POD-10 is the mobile relay: the answer to a fully dark zone is driving it to the edge of one.

Every pod has satellite configured. Local pod controls can disable satellite/cellular/mesh for only that pod. Global infrastructure controls fail or restore the shared satellite/celltower services for all pods.

## Queue And Routing Order

Every citizen SOS is first accepted by that pod's own backend and stored in that pod's persistent queue at `pod-data/pod-XX/queue.json`. The pod sync worker wakes immediately after submission and also runs every 5 seconds.

1. If satellite is enabled locally and globally up, the queued SOS is sent to `satellite -> cloud-api`.
2. Otherwise, if cellular is enabled locally and a configured tower is up, it is sent to `celltower-* -> cloud-api`.
3. Otherwise, if mesh is enabled and a surrounding pod has a direct cloud route, it is relayed to that neighbor. The surrounding pod adds it to its own queue and its sync worker forwards it.
4. Otherwise, the SOS remains cached in the local pod queue until satellite, cellular, or mesh becomes available again.

In parallel with the ladder — and independent of it — the pod immediately pushes the request to any **role-matching coordinator in its radio range** (and every mesh relay pod offers it to its own in-range coordinators too), so nearby relief teams act before the cloud even knows. The cloud copy still follows for the Command Center's picture; the coordinator inbox deduplicates the two arrivals by ID.

The `satellite`, `celltower-*`, and `cloud-api` containers print a compact request snapshot in their logs when they receive an SOS, so the fallback path is visible during demos.

## Useful API Commands

Check running containers:

```powershell
docker compose ps
```

Check POD-01 status:

```powershell
curl.exe http://localhost:8001/api/pod/status
```

Submit an SOS to POD-01:

```powershell
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Ramesh Kumar\",\"age\":68,\"phone\":\"+91 9876543210\",\"category\":\"Medical\",\"message\":\"My grandfather needs insulin and cannot walk\",\"location\":\"Kothapalli Zone 3\"}"
```

The API returns `202 Accepted` after the SOS is queued at the pod. The worker then syncs it through satellite, cellular, mesh, or keeps it cached.

View cloud-received requests:

```powershell
curl.exe http://localhost:9000/api/requests
```

Infra fail/restore endpoints require an `x-infra-token` header (`INFRA_CONTROL_KEY`,
default `sanjeevani-infra-demo-key`) so a stray request can't kill the demo
mid-presentation. The Command Center UI and the simulation-controller's own
UI already send it; add it yourself for direct curl calls:

Fail satellite globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/satellite/fail -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Restore satellite globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/satellite/restore -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Fail CELLTOWER-1 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-1/fail -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Restore CELLTOWER-1 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-1/restore -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Fail CELLTOWER-2 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-2/fail -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Restore CELLTOWER-2 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-2/restore -H "Content-Type: application/json" -H "x-infra-token: sanjeevani-infra-demo-key" -d "{}"
```

Disable satellite only on POD-01:

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/disable -H "Content-Type: application/json" -d "{}"
```

Enable satellite only on POD-01:

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/enable -H "Content-Type: application/json" -d "{}"
```

Disable cellular only on POD-08:

```powershell
curl.exe -X POST http://localhost:8008/api/network/cellular/disable -H "Content-Type: application/json" -d "{}"
```

View a pod queue:

```powershell
curl.exe http://localhost:8001/api/queue
```

Manually sync a pod queue:

```powershell
curl.exe -X POST http://localhost:8001/api/sync -H "Content-Type: application/json" -d "{}"
```

Edit a pod display name:

```powershell
curl.exe -X POST http://localhost:8001/api/pod/name -H "Content-Type: application/json" -d "{\"podName\":\"Updated Command Pod\"}"
```

## Improvements 

All are verified by
`integrations/integration_test.py` (13/13 checks, runs without Docker) and
`integrations/ai_triage_test.py` (12/12 checks on the AI chain, mock model).

- **ThousandEyes idea, one rule (link physics).** `link-node` now applies real
  latency and packet loss. `GET /health` reports `up`/`degraded`/`down` based on
  loss; a **degraded** link (loss >= 25%, e.g. rain fade) ranks below a healthy
  link so pods move traffic *before* an outage — predictive failover. Simulate:
  `curl "http://localhost:9100/set?loss=0.4"`.
- **Real SANJEEVANI-Shield signing.** The cloud holds an Ed25519 private key and
  signs every alert; pods fetch the public key once **through a link-node**
  (`/api/pubkey`, enrollment) and verify locally — signature + sequence
  freshness (anti-replay) + scope. A forged/replayed alert is rejected (401) and
  a `SECURITY` event rides the normal ladder to the cloud. The old
  `verified:true` boolean bypass is gone.
- **Hazard -> cloud -> signed broadcast loop.** A fired hazard pack now enqueues
  an `EARLY-WARNING` event that syncs to the cloud through the ladder; the cloud
  answers with a signed broadcast to every pod (production: Webex Connect blast).
- **Bandwidth answers (Q4).** Per-device **rate limiting** (token bucket, 429 on
  abuse, keyed by `x-device-id`) and **batch sync** (a backlog of >3 items syncs
  in one link transmission via `/api/forward-batch`).
- **AI triage + SITREP** (see the dedicated section above): local LLM upgrades
  keyword-missed emergencies, adds responder roles, and writes operator
  briefings — offline-capable, upgrade-only, never blocking.
- **Surge-proof link checks.** Cloud link health is cached for 2.5s, so a
  batch of 100 queued SOS triggers 3 health probes instead of 300 — batch
  sync completes inside one link transmission window.
- **Demo scripts** in `integrations/`: `simulate_crowd.py` (surge realism),
  `inject_forged_alert.py` (Shield rejection).

Run the verification:

```powershell
py -3 integrations/integration_test.py
```

## Demo Scenarios

1. Normal path: keep all links up, submit SOS to POD-01, and verify `forwardedBy` is `satellite` in `http://localhost:9000/api/requests`.
2. Satellite failover: fail satellite, submit SOS to POD-01, and verify `forwardedBy` is `CELLTOWER-1`.
3. Alternate tower behavior: fail satellite and CELLTOWER-1, then submit to POD-07. It should use `CELLTOWER-2`.
4. No cellular pod with relay: fail satellite, then submit to POD-04. It should relay by mesh to POD-05 if POD-05 has a cloud path.
5. Island mode: disable satellite, cellular, and mesh locally on one pod, submit SOS, then check `/api/queue`.
6. Queue restore: re-enable a path and call `/api/sync`; queued SOS should move to cloud.
7. Local-only control: disable cellular on POD-01 and check POD-02; POD-02 remains unaffected.
8. Global control: fail CELLTOWER-1 and check POD-01, POD-02, POD-03, and POD-05; all see tower 1 down.
9. UI path test: open any pod UI, use the global and local controls, and watch the route card update.
10. **Uplink destroyed, help still arrives**: fail satellite and both towers,
    submit a flood SOS at POD-06 — the Flood coordinator (8109) receives it
    over the direct mesh within a second while the Command Center stays
    blind. Restore satellite and watch the Command Center catch up with the
    honest `received ... (sent ...)` timestamps.
11. **Closed loop**: submit an SOS, watch it turn `Assigned` at the Command
    Center, click **Acknowledge** then **Mark handled** on the coordinator —
    the Command Center card flips to `Acknowledged`, then green `Resolved`,
    and moves to Past history on both ends.
12. **Sensor-initiated response**: spike POD-06 `air_quality` from the
    simulation controller — the pod warns its own citizens, every pod gets a
    signed broadcast, and the Fire coordinator's inbox gets the wildfire
    alert. No human sent anything.
13. **Out-of-stock rerouting**: set Hospital 1's beds to 0, submit a medical
    SOS from POD-02 — the cloud logs `skipping Hospital1: reported
    out-of-stock` and delivers to Hospital 2 instead. Restock and routing
    returns to normal. Two design rules underneath: only **stock** fields
    (beds, kits, boats) can flag a shortage — workload gauges (critical
    patients, camp occupancy) at zero are good news and never reroute — and
    if **every** coordinator of a role is out of stock, the cloud still
    delivers (never silence), but marks the request `last-resort`, shows a
    red escalation note on the EOC card, and buzzes Webex so a human
    restocks a team or activates an external facility.
14. **AI catches what keywords miss**: submit "my chest feels heavy and I'm
    dizzy" at any pod — no critical keyword matches, so the card starts LOW.
    Seconds later the AI upgrades it to CRITICAL severity 9 with the reason
    "possible cardiac event", the hospital coordinator appears in routing,
    and the card jumps to the top of the hospital inbox. Then press
    **Generate SITREP** on the dashboard for the AI's 30-second briefing.
    Kill the ollama container and repeat: everything still flows, cards
    read "rule-based triage" — AI is an enhancer, never a gatekeeper.
15. **Phone in the pocket**: with the Webex app installed, submit an SOS
    with critical words ("unconscious", "bleeding") — the SANJEEVNI Alerts
    space buzzes within seconds, naming the citizen, location, and routed
    coordinators. Then submit one with NO critical words ("speech is
    slurring, face drooping") — the phone buzzes ~15s later with
    "🤖 caught by AI triage" and the model's reason. Spike a sensor and the
    ⚠️ early-warning alert lands too.

## Stop And Reset

Stop containers:

```powershell
docker compose down
```

Reset generated queues, pod display names, coordinator inboxes/history, and local path settings:

```powershell
Remove-Item -Recurse -Force .\pod-data, .\coordinator-data
docker compose up -d --build
```
