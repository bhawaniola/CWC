# THE SANJEEVANI CHRONICLE

### A Storyteller's Field Guide to Every Realm, Every Character, and Every Line of Consequence

*This book explains the entire SANJEEVANI codebase as a living kingdom. Each directory is a realm; each file and function is a character with a job, a power, and a failure mode. Unlike a summary, this volume goes deep: real thresholds, real timeouts, real data shapes, real line numbers. Read it cover to cover, or open the chapter for the realm you are working in.*

---

## PROLOGUE — The World Map

### The Kingdom at a Glance

```
                                   ┌──────────────────────────────┐
                                   │   THE STORM-BRINGER          │  simulation-controller :9300
                                   │   (holds the Docker socket)  │  can UNMAKE the bridges
                                   └──────────────┬───────────────┘
                                                  │ stop/start containers
                 ┌────────────────────────────────┼────────────────────────────────┐
                 │                                │                                │
        ┌────────▼─────────┐            ┌─────────▼────────┐             ┌─────────▼────────┐
        │  SKY-BRIDGE      │            │  TOLL BRIDGE 1   │             │  TOLL BRIDGE 2   │
        │  satellite :9100 │            │  celltower-1     │             │  celltower-2     │
        │  80ms, loss dice │            │  :9201, 30ms     │             │  :9202, 30ms     │
        └────────┬─────────┘            └─────────┬────────┘             └─────────┬────────┘
                 │            every byte crosses a bridge — no back roads          │
                 └────────────────────────────────┼────────────────────────────────┘
                                                  │
                                   ┌──────────────▼───────────────┐
                                   │   THE CAPITAL                │  Command-Center/Backend :9000
                                   │   Ed25519 signet ring        │  ("sanjeevani-cloud-api")
                                   │   MongoDB archive            │  + Ollama Oracle + Webex Falconer
                                   └──────────────┬───────────────┘
                                                  │ Socket.io bells
                                   ┌──────────────▼───────────────┐
                                   │   THE WATCHTOWER             │  Command-Center/Frontend :9400
                                   │   (EOC operator dashboard)   │  React SPA + realtime bridge
                                   └──────────────────────────────┘

   TEN VILLAGES (pod-agent :8001..:8010)          NINE GUILD HALLS (coordinators :8000 each)
   citizens submit SOS here                        fire / 2 hospitals / 3 shelters /
   fireproof JSONL ledgers                         2 workforce camps / flood rescue

   THE WEATHER-MAKERS (sensor-simulator)           THE EMBASSY (integrations/)
   15 simulated Meraki MT sensors + 3 MT30s        real Meraki + Catalyst envoys,
   tick every 4 s into village sensor gates        forgery drills, crowd sieges, test rigs
```

### The Laws of the Kingdom (the design constitution)

Every realm obeys the same ten laws. When you read any function in this book, you will find at least one of these behind it:

1. **Write before you send; delete only on receipt.** Every plea is persisted to disk *before* any delivery attempt, and struck out only when a downstream receipt returns.
2. **The AI is an enhancer, never a gatekeeper.** Nothing in the pipeline ever waits for a model. A dead model costs a log line, nothing more.
3. **Severity only climbs.** No duplicate, re-delivery, or stale copy may ever lower a severity that a rule or the AI already raised.
4. **First arrival keeps its timestamp.** A second copy over another path must not make a request look new, or erase work already done on it.
5. **Every crossing pays physics.** Latency is slept, loss is diced. The network is never abstracted away.
6. **Nobody crosses an unconfessed bridge.** Paths are chosen only from live health confessions (`/health`), never assumptions.
7. **Trust anchors travel once; verification happens locally.** Ed25519 public keys are fetched at enrollment so signatures verify even fully offline.
8. **The data plane may be open; the control plane never is.** Destroying infrastructure requires a token. Submitting an SOS does not.
9. **Deduplicate by id, everywhere.** Requests, deliveries, alerts, history entries — one id, one record, merged not duplicated.
10. **Be honest about what is simulated.** Code comments name exactly which hop is fake and which Cisco device would own it in production.

### The Ports of the Realm

| Port | Realm | Service |
|---|---|---|
| 9000 | The Capital | `Command-Center/Backend/server.js` (cloud-api) |
| 9400 | The Watchtower | `Command-Center/Frontend/server.js` |
| 9100 | Sky-Bridge | `link-node` as `satellite` |
| 9201 / 9202 | Toll Bridges | `link-node` as `celltower-1` / `celltower-2` |
| 8001–8010 | Ten Villages | `pod-agent` as POD-01…POD-10 |
| 8000 (internal ×9) | Guild Halls | `coordinators` as FIRE-01, HOSPITAL-01/02, SHELTER-A/B/C, WORKFORCE-01/02, FLOOD-01 |
| 9300 | Storm-Bringer | `simulation-controller` |
| 9500→9400 | Weather-Makers | `sensor-simulator` (host 9500 maps to container 9400) |
| 11434 | The Oracle | Ollama container (`qwen2.5:3b`) |
| 27017 | The Archive | MongoDB |

---

# CHAPTER ONE — The Capital
## `Command-Center/Backend/server.js` (2,123 lines)

The Capital is the largest single character in the kingdom, and it wears many faces. This chapter walks through all of them in the order the code declares them.

### 1.1 The Founding Artifacts (lines 1–57)

At startup the Capital forges its two treasures:

**The Signet Ring** (line 32): `crypto.generateKeyPairSync("ed25519")` mints a fresh Ed25519 keypair *every boot*. The private key never leaves this process. The public key is exported as DER/SPKI hex (`pubkeyDerHex`) and served at `GET /api/pubkey` so villages can enroll. Note the consequence of a fresh key per boot: after a Capital restart, villages hold a stale trust anchor until they re-enroll — the demo restarts everything together, so this never bites, but it is worth knowing.

**The Ledgers**: six in-memory arrays hold the kingdom's live state — `requests`, `coordinatorEvents`, `coordinatorMessages`, `coordinatorDeliveries` (capped at 600), `sensorReadings` (capped at 100), and `alertsSent` (capped at 50). MongoDB is the durable shadow of each; memory is the source of truth for speed.

**The Bell Tower**: a Socket.io server rides the same HTTP server. On any client connect it immediately emits `cloud:hello` (service identity + Mongo status) and `cloud:snapshot` (the complete live state via `realtimeSnapshot()`), so a reconnecting Watchtower never starts blind.

### 1.2 The Archive — MongoDB with a Memory Fallback (lines 38–48, 669–731)

Six Mongoose models are declared with deliberately **loose schemas** — `new mongoose.Schema({}, { strict: false, timestamps: true, versionKey: false })`. The Capital does not fight its payloads; whatever shape a request arrives in, it is stored whole. The models: `CloudRequest`, `CoordinatorEvent`, `CoordinatorMessage`, `CoordinatorDelivery`, `CloudAlert`, `SensorReading`.

- `connectMongo()` tries `mongodb://mongodb:27017/sanjeevani-command-center` with a 5-second server-selection timeout. Failure is **not fatal**: `mongoConnected = false` and the Capital runs on memory alone, logging one warning. (Law 2 generalized: persistence is an enhancer too.)
- `loadPersistedState()` on boot rehydrates memory from Mongo, newest first, with hard limits: 300 requests, 300 events, 300 messages, 600 deliveries, 50 alerts, 100 sensor readings. It also recovers `alertSeq` as the max stored alert sequence, so anti-replay numbering survives restarts.
- `persistDocument(Model, filter, doc)` is the single write primitive: an upsert (`findOneAndUpdate` with `$set`) that returns `false` instead of throwing when Mongo is down. Every store in the file funnels through it.
- `toPlain()` strips Mongo's `_id`, `createdAt`, `updatedAt` before documents re-enter memory, so in-memory shapes stay clean.

### 1.3 The Registry of Guilds (lines 59–123, 229–234)

`DEFAULT_COORDINATORS` hard-codes the nine guilds with their Docker hostnames and — critically — their **tower shadows**: FIRE-01 and HOSPITAL-01 and SHELTER-B sit under CELLTOWER-1; SHELTER-C and both WORKFORCE camps under CELLTOWER-2; HOSPITAL-02, SHELTER-A, and FLOOD-01 have `towers: []` — **no cellular at all**, satellite or nothing. The env var `COORDINATOR_URLS` can replace the whole registry using the format `id|name|role|url|TOWER-1,TOWER-2;id|...` parsed by `parseCoordinatorRegistry()`.

`CELL_TOWER_URLS` and `SATELLITE_URL` give the Capital its own map of the bridges, because the Capital does its own deliveries (see 1.7).

### 1.4 The Dispatcher's Lexicon — `ROUTING_RULES` and the Classifiers (lines 125–454)

`ROUTING_RULES` defines five responder roles, each with `categoryTerms` (matched against the request's category field) and `keywords` (matched against the full text). Hospital knows *ambulance, blood, breathe, chest pain, insulin, oxygen, pregnant, stroke, unconscious…*; flood knows *boat, drowning, marooned, roof, stranded…*; shelter, workforce, and fire have their own vocabularies.

The matching machinery:

- `normalizeForMatch()` lowercases and collapses everything non-alphanumeric to single spaces, so "life-jacket!" matches "life jacket".
- `requestTextForRouting()` concatenates **fourteen possible fields** (`category, type, hazard, message, detail, details, description, emergency, emergencyText, emergencyDetails, tellMore, tellUsMore, notes, location, locationName, address, triage.reason`) — the Capital assumes nothing about which field a client used.
- `severityNumber()` accepts either a number or a word: `critical→9, high→7, medium→5, low→2`, else 0.

**`classifyCriticality(request)`** (line 355) is the tripwire that decides life-and-death priority. A request is critical if *any* of: `isCritical === true`, an explicit `criticality/priority` of "critical", numeric severity ≥ 8, **or** the text contains any of fourteen dread terms (*bleeding, blood loss, breathing, cardiac, critical, drowning, heart, icu, life threatening, pregnant, severe, stroke, trapped, unconscious*). If a term matched but the numeric severity was lower, the function **bumps severity up to 8** — words outrank numbers. It returns `{ isCritical, criticality, criticalReason, severity }`, and `criticalReason` always names its evidence (`severity 9` or `matched "unconscious"`).

**`classifyRequest(request)`** (line 404) builds the routing verdict:

1. For each role, a category hit and up to **four** keyword hits are recorded as evidence strings (`emergency text matched "boat"`), collected in a `Map` so a role appears once with accumulated evidence.
2. `needsFieldTeam` fires when severity ≥ 7 **and** the text mentions *evacuate/evacuation/rescue/stranded/trapped/transport/carry* — then flood matches also summon **workforce** ("flood rescue needs deployable field workers"), fire matches summon workforce for evacuation crews, and shelter matches with *delivery/transport/send/distribute* summon workforce for dispatch.
3. If nothing matched at all: **fallback to shelter** with evidence "fallback: no specialist keywords found" — Law: no cry goes unanswered.

The result is `{ roles, departments (with evidence), summary, severity, ...criticality }`.

### 1.5 The Sensor Annals (lines 469–658, 1757–1795)

`defaultSensorReadings()` seeds six demo instruments (Budameru River gauge at 6.24 m and rising, a flood-risk index at 0.82, rainfall, soil saturation, river flow, wind), each with a nine-point `history` array for sparklines. `seedSensorReadings()` installs them once at boot (memory + Mongo).

`sensorSummaryFrom(readings)` computes the operator-facing risk verdict. If no flood-risk sensor reports, it derives one:

```
risk = clamp( water/7.6 × 0.5  +  rainfall/80 × 0.3  +  soil/100 × 0.2 , 0..1 )
```

Labels: `HIGH` at ≥ 0.75, `ELEVATED` at ≥ 0.5, else `NORMAL`. It also counts critical/warning sensors and returns the freshest reading timestamp. `upsertSensorReading()` merges by id, re-sorts newest first, caps at 100, persists, and — when asked — rings `sensor:updated` with the recomputed summary attached, so the Watchtower's risk tile updates the moment any instrument reports.

### 1.6 The Bell Tower — `emitRealtime()` (line 655)

Every mutation in the Capital rings twice: once on the generic channel `cloud:update` and once on a typed channel (`request:created`, `request:updated`, `request:routed`, `request:deleted`, `alert:created`, `sensor:updated`, `coordinator-delivery:updated`, `coordinator-event:created/updated`, `coordinator-message:created/updated`, `coordinator-shortage:updated`). Payloads with ids are logged with a traceable prefix `[cloud-api][socket][<id>]`. The Watchtower's bridge (Chapter Two) listens to `cloud:update` and re-broadcasts everything to browsers.

### 1.7 The Courier Service — Deliveries to the Guilds (lines 733–1166)

This is the heart of the Capital's outbound machinery.

**The Scout** — `readLinkHealth(url)` GETs `{link}/health` with a **1-second** timeout, returning `"up"` only for an explicit up. `readDeliveryLinks()` probes the satellite and both towers **in parallel** and caches the verdict for **2.5 seconds** (`LINK_HEALTH_CACHE_MS`). The comment records the war story behind the cache: a batch of 100 SOS once meant 300 sequential health probes before a single delivery.

**The Ledger Entry** — `buildDelivery(request, target, classification)` creates a delivery with id **`${request.id}:${target.id}`** — one row per request-guild pair, ever (Law 9). It carries the target's url and towers, the classification, `status: "queued"`, an empty `attempts` array, and a full payload snapshot with routing embedded.

**The Ride** — `attemptCoordinatorDelivery(delivery, links, trigger)` (line 854):

1. Terminal statuses (`delivered`, `resolved`, `rejected`) return immediately — no zombie retries.
2. Route candidates are built in priority order: **satellite first** (if up), then **the guild's own tower** via `towerForTarget()` — a guild is only ever dialed through a tower in its registered shadow, mirroring RF reality.
3. No candidates → status `queued` with the human-readable reason *"No satellite path or matching cell tower path is currently online."*, attempts trimmed to the last 9.
4. For each candidate, `postToCoordinator()` POSTs the payload (decorated by `buildCoordinatorPayload()` with `transport`, `deliveryRoute {trigger, transport, linkName, sentAt}`, and full routing metadata) to `{guild}/api/coordinator/inbox` with a **2.8-second** timeout.
5. **The rejection covenant**: a 2xx reply with `accepted: false` means the guild answered and *refused* (role mismatch). That is a **permanent `rejected`** — never retried, logged loudly. An HTTP failure, by contrast, is a transient `failed` attempt and the next candidate is tried.
6. Success → status `delivered` with `deliveredVia` (transport) and `deliveredLink` (bridge name), attempt appended (last 10 kept).
7. All candidates failed → back to `queued` with the last error as `lastReason`.

Every state change flows through `persistDelivery()` → memory upsert (`upsertDeliveryInMemory`, cap 600) → Mongo → `coordinator-delivery:updated` bell.

**The Drum** — `retryQueuedDeliveries(trigger)` sweeps all non-terminal deliveries, refreshes the link scout once, and re-attempts each. It is **single-flight** (an `activeDeliveryRetry` promise guard) and runs on a `DELIVERY_RETRY_INTERVAL_MS` = **5-second** interval from `start()`, plus on demand via `POST /api/coordinator-deliveries/retry`.

**The Quartermaster** — `coordinatorShortageLevels` is a `Map<coordinatorId, Map<fieldId, level>>` fed by shortage events (see 1.10). `coordinatorIsOutOfStock()` returns true if *any* field of that guild is `out-of-stock`. `targetsWithStock(targets, roles)` then filters delivery targets **per role**: skip out-of-stock guilds when a same-role alternative has stock, logging exactly who was skipped and who covers; but if *every* guild of a role is out of stock, **deliver anyway** — the comment is the doctrine: *"a struggling responder is still better than silence."*

**The Master Router** — `routeRequestToCoordinators(request, duplicate)` (line 1052):

1. Coordinator-originated events and SECURITY events are never routed (they are inputs, not work orders).
2. `classifyRequest()` runs. Then two override layers, in strict precedence:
   - **Hazard-pack declared roles** (`request.roles` filtered to known roles): if present they **replace** the keyword classification entirely — an earthquake alert's text matches no keywords, but its pack says `["hospital","workforce"]`, and the pack is trusted.
   - **AI-discovered roles** (`request.aiTriage.roles`), only when no declared roles exist: these are **unioned in**, never replacing — the AI adds targets, never removes them (Law 2 in routing form).
3. The request itself is updated in place with `requestTypes` and a `routing` block (classification, target summary, `plannedAt`), persisted, and logged as `identified as <summary>; targets=<names>`.
4. For each stocked target, an existing delivery is reused (on `duplicate=true` its payload/classification are refreshed) or a new one built, then `attemptCoordinatorDelivery` rides immediately with trigger `request-created` or `request-update`.
5. A `request:routed` / `request:updated` bell rings.

### 1.8 The Oracle's Antechamber — the AI Triage Worker (lines 1168–1287)

The section banner in the code says it all: *"AI triage (enhancer, never gatekeeper). The local LLM re-reads every citizen SOS AFTER it is stored, routed, and delivered. It can only confirm or UPGRADE severity — never downgrade."*

- `aiTriageEligible(request)`: AI enabled, not a coordinator event, category not EARLY-WARNING or SECURITY.
- `applyAiTriage(request)`:
  - Guards: has id, eligible, not already `complete`, not currently in the `aiTriageInFlight` set (a per-id mutex).
  - Calls `aiTriage.triageRequest()` (Chapter 1-A). If the request was deleted while the model was thinking, it simply returns — the comment even says so.
  - **The upgrade-only merge**: `mergedSeverity = max(ruleSeverity, verdict.severity)`. The AI's reason only replaces the triage reason if it actually upgraded. `isCritical` flips on at merged ≥ 8 and never flips off.
  - The request gains an `aiTriage` block: the verdict plus `status: "complete"`, `previousSeverity`, and `upgraded: true/false`.
  - Persist, ring `request:updated`, log `UPGRADED severity 3 -> 9 (qwen2.5:3b, 1840ms): <reason>` or `confirmed severity N`.
  - **Re-route** with `duplicate=true` so newly-discovered roles get deliveries (already-delivered guilds are protected by the terminal-status guard and pick the upgrade up on their 6-second cloud pull).
  - If the upgrade crossed into critical: `webex.notifyCriticalRequest(refreshed, { aiUpgraded: true })` — the Falconer flies with the 🤖 badge.
  - On any error: the request is stamped `aiTriage: { status: "unavailable", error }` (error text sliced to 200 chars) and the rule-based verdict stands untouched.
- `retryPendingAiTriage()` sweeps every `AI_RETRY_SWEEP_MS` = **60 seconds**, picking at most **3** pending requests per sweep — a backlog from an Ollama outage drains gently instead of flooding the CPU.

### 1.9 The Duty Officer's Desk — SITREP (lines 1289–1346, 1836–1854)

`buildSitrepSnapshot()` assembles a strictly factual JSON picture: network status (fresh scout read), the top 15 **open citizen** requests (resolved ones filtered out by `isResolvedCloudRequest`, each trimmed to severity/critical/category/140-char message/location/pod/AI reason), counts (open, critical, queued deliveries), the flattened shortage table (guild, role, resource, level), and the last 5 alerts (120-char messages).

`POST /api/sitrep` feeds that snapshot to `aiTriage.generateSitrep()` and caches the result in `lastSitrep` (with the counts attached as `facts`) so `GET /api/sitrep` can serve the last report instantly after a page reload. Failures return 503 with the reason — the button degrades, the dashboard does not.

### 1.10 The Gatekeeper Scribe — `storeRequest()` (lines 1504–1682)

Every SOS in the kingdom terminates at this desk. Its ritual, in order:

1. **Criticality first**: `classifyCriticality()` runs before anything else; the stored triage severity is the bumped one.
2. **Identity**: missing ids get `cloud-request-<timestamp>-<uuid>`; `cloudReceivedAt` is stamped.
3. **The duplicate covenant** (mesh re-delivery, pod re-sync): if the id exists, the records merge under three rules spelled out in comments — `cloudReceivedAt` keeps the **original** arrival time ("or every entry shows 'just now'"); `resolutions` and `routing` already stored are kept; severity takes the **max** of both copies ("a re-arrival still carries the origin pod's keyword severity — it must never downgrade a severity the AI already raised"); criticality is sticky.
4. Persist to Mongo (with an explicit log saying whether Mongo or the memory fallback took it), ring `request:created` or `request:updated`, and log a compact `requestSnapshot` (id, pod, category, link, relay trail).
5. **EARLY-WARNING reflex**: a new early-warning triggers `broadcastAlert({hazard, message, scope:"all"})` *immediately* (fire-and-forget with its own catch) and `webex.notifyEarlyWarning()` — a hazard that reached the cloud through whatever path survived is answered with a signed broadcast to everyone.
6. **SECURITY events** are logged loudly.
7. **Coordinator events** route to `upsertCoordinatorEvent()`, and two special kinds get extra handling:
   - `coordinator-request-resolution`: finds the delivery `${requestId}:${coordinatorId}`, flips it to `resolved` (with `resolutionAt` and the field note as `lastReason`), then updates the original request's `resolutions` array (one entry per guild, replaced not appended) and a human-readable `resolutionSummary` ("Hospital1: resolved; FloodRescueDept: acknowledged"), ringing `request:updated`.
   - `coordinator-resource-shortage`: `recordCoordinatorShortage(coordinatorId, fieldId, level)` updates the Quartermaster's map (a `null` level clears the entry — restock), warns on the console for real shortages, and rings `coordinator-shortage:updated`.
8. **Routing**: `routeRequestToCoordinators()` runs for every stored request (including duplicates, so refreshed payloads propagate).
9. **The Falconer at ingest**: a *new*, *citizen*, *non-warning* request that is already critical triggers `webex.notifyCriticalRequest()` — deliberately **after** routing, so the alert can name its targets.
10. **The Oracle, fire-and-forget**: `applyAiTriage(routedRequest).catch(warn)` — the SOS is stored, queued, and delivered before the model ever sees it (Law 2, verbatim in the comment).

`seedDemoUserRequests()` at boot funnels four demo SOS (pregnant woman POD-03 sev 9, roof-stranded family POD-06 sev 8, supplies POD-05 sev 6, elderly shelter transfer POD-08 sev 7) through this same `storeRequest()` pipeline — the demo data exercises the real machinery, including routing and (aged-out) Webex suppression.

### 1.11 The Herald — `broadcastAlert()` (lines 1384–1426)

`canonicalAlert()` produces the signing target: all keys except `signature`, **sorted**, JSON-serialized — canonical form so the villages can reproduce the exact bytes. The alert carries `id: alert-<seq>`, an incrementing `seq` (anti-replay), `hazard`, `message`, `scope` (default `"all"`), `issuedAt`, then `signature = crypto.sign(null, canonical, privateKey).hex` (Ed25519 needs no digest argument — `null` is correct).

Fan-out: a parallel `Promise.all` POST to every registered pod's `/api/alerts` with a **2.5-second** timeout; the per-pod result (HTTP status or `"unreachable"`) is recorded in a `delivery` map on the stored record — the Alerts page can show exactly which villages heard the decree. The record joins `alertsSent` (cap 50), Mongo, and the `alert:created` bell.

### 1.12 The Public Gates (lines 1797–2084)

A quick atlas of every endpoint the Capital answers:

| Gate | Purpose |
|---|---|
| `GET /api/health` | service vitals: db mode, counts of everything, queued deliveries |
| `GET /api/ai/health`, `GET /api/webex/health` | delegate to the Oracle/Falconer health checks |
| `POST /api/webex/test` | rehearsal falcon into the bot's spaces |
| `POST/GET /api/sitrep` | generate / read the cached AI situation report |
| `GET /api/pubkey` | the trust anchor (algorithm + DER hex) |
| `POST /api/alerts` | sign & broadcast (201 with delivery map) |
| `GET /api/alerts` | last 50 signed alerts |
| `GET/POST /api/sensors` | annals + summary; upsert a reading |
| `POST /api/requests` | the Scribe's desk (201 new / 200 duplicate) |
| `POST /api/requests/batch` | sequential `storeRequest` per item; returns stored ids |
| `GET /api/requests` | the full ledger |
| `DELETE /api/requests/:id` | removes the request **and every delivery row for it** (memory + Mongo), rings `request:deleted` with counts |
| `GET /api/coordinator-deliveries` | filterable by `requestId` / `status` |
| `POST /api/coordinator-deliveries/retry` | manual drumbeat |
| `POST/GET /api/coordinator-events` | store / filter by coordinatorId / role |
| `POST/GET /api/coordinator-messages` | upsert by id; GET filtered by `coordinatorMessageMatchesQuery` (matches explicit id, role, or the `"all"` wildcard) |

`start()` sequences the boot: connect Mongo → load state → seed sensors → seed demo requests → listen (logging pod count and coordinator/bridge registry) → start the 5-second delivery drum → if AI enabled, log model status and start the 60-second AI retry sweep.

---

# CHAPTER ONE-A — The Oracle
## `Command-Center/Backend/services/aiTriage.js` (179 lines)

A small local seer: an Ollama container inside the cluster running `qwen2.5:3b` (overridable via `AI_TRIAGE_MODEL`), reachable at `OLLAMA_URL` (default `http://ollama:11434`), disabled entirely by `AI_TRIAGE_ENABLED=false`, with a **60-second** call timeout — generation on CPU is slow, and nothing waits for it anyway. The header comment is the realm's oath: *"the AI is an enhancer, never a gatekeeper… The model runs inside the cluster, so the AI keeps working even with zero external internet — it degrades exactly like the rest of the network."*

**The Triage Liturgy** — `TRIAGE_SYSTEM_PROMPT` casts the model as "the triage officer of a disaster-response Emergency Operations Center", demands **only** a JSON object with exactly `severity` (1–10), `roles` (1–3 of hospital/flood/shelter/workforce/fire), `category` (one word), `reason` (one dispatcher-readable sentence), and teaches the severity bands: 9–10 life-threatening *now* (cardiac, drowning, trapped, not breathing, childbirth); 7–8 urgent within hours (rising water, fire nearby, no critical medicine); 4–6 essential needs; 1–3 general. It explicitly trains for **implied emergencies without alarm words**: *"'chest feels heavy', 'lips turning blue', 'water reached the bed' are all severe."*

**The Anchoring Defense** — `requestTextForAi()` builds the user message from name, age, citizen-chosen category, message, location — and **deliberately omits the keyword triage's severity**. The comment explains: *"a small model anchors on any number it is shown and just agrees with it. The AI must judge the message fresh; the upgrade-only merge reconciles the two after."* This is the most subtle design decision in the file.

**The Call** — `callOllama(messages, {asJson, numPredict, temperature})` POSTs `/api/chat` with `stream: false`, `format: "json"` when structured output is needed, `temperature: 0.1` and `num_predict: 220` for triage (deterministic, short). Empty responses throw.

**The Validator** — `validateTriageVerdict(raw)` is the firewall between a probabilistic model and a deterministic pipeline: severity is rounded and clamped to 1–10 (non-numeric throws); roles are lowercased, filtered against the known five, capped at 3; category sliced to 40 chars; reason trimmed to 240. Whatever nonsense the model emits, only a well-formed verdict escapes this function.

**`triageRequest(request)`** stitches it together and decorates the verdict with `model`, `evaluatedAt`, `tookMs`. It throws on any failure — *"the caller decides what a failure means (always: keep the keyword triage and move on)."*

**The SITREP Liturgy** — `SITREP_SYSTEM_PROMPT` casts a duty officer producing a 30-second read-aloud report in exactly four sections — SITUATION / CRITICAL / RESOURCES / ACTIONS — with the closing commandment *"Only state facts present in the snapshot. Never invent numbers or places."* `generateSitrep()` runs it as free text (`asJson: false`), 450 tokens, temperature 0.2.

**`aiHealth()`** GETs Ollama's `/api/tags` (2.5 s) and reports `ready` / `model-not-pulled` (the model list is checked with prefix tolerance) / `unreachable` / `disabled`.

---

# CHAPTER ONE-B — The Falconer
## `Command-Center/Backend/services/webexNotifier.js` (279 lines)

The Falconer posts formatted alerts into Cisco Webex spaces via the bot **Sanjeevni-Sentinel** — *"the phone in a responder's pocket, not just the dashboard in the EOC."* Its charter repeats the oath: *"enhancer, never gatekeeper. Every call is fire-and-forget with a short timeout; a dead internet connection costs one warning line in the log and nothing else."* (This is the one feature that needs real internet; in production it rides the satellite uplink.)

**Configuration**: `WEBEX_BOT_TOKEN` enables the whole module (`WEBEX_ENABLED` requires a token *and* not being explicitly disabled). `WEBEX_ROOM_ID` pins one room; otherwise `refreshRooms()` discovers the bot's spaces via `GET /rooms?max=20&sortBy=lastactivity`, keeps the top **3** (`MAX_ROOMS`), and caches for **60 seconds**. Send timeout: **6 seconds**.

**The Discipline Stack** — four independent guards, each defending against a different disaster-day pathology:

1. **Dedup forever**: `notifiedKeys` remembers every alert key (`critical:<id>` / `warning:<id>`) — *"one alert per request id, ever"* — so the same SOS re-arriving over mesh, or the AI confirming a request that already alerted at ingest, stays silent. The set self-clears past 2,000 entries.
2. **Rate limit**: a sliding-window array of send timestamps caps sends at `WEBEX_MAX_PER_MINUTE` = **6**/minute — *"a surge of 100 critical SOS must not buzz phones 100 times."*
3. **Staleness**: `tooOldToAlert()` drops anything whose `cloudReceivedAt` is older than **30 minutes** (`WEBEX_MAX_ALERT_AGE_MIN`) — a Capital restart re-processing stored requests must not buzz phones about hours-old emergencies. The comment highlights the deliberate subtlety: `cloudReceivedAt` (not creation time) is used **on purpose**, so an island-mode SOS delivered late has a *fresh* arrival time — *"delayed but never lost" still alerts*. Demo seeds are separately excluded by `isDemoSeed()` (source contains "seed").
4. **The Retry Roost**: failed sends enter `retryQueue` (max **10** items, max **5** attempts each); a 30-second `setInterval` — `.unref()`ed so it never keeps a test process alive — retries one item per beat when not rate-limited. Any single send failure also zeroes the room cache timestamp, forcing re-discovery next flight (*"the room may be gone (bot removed, space deleted) — re-discover instead of retrying a dead id"*).

**The Messages** — Webex squashes loose paragraphs, so the format is heading + blockquote + bullets. `criticalAlertMarkdown()`: `## 🚨 CRITICAL SOS — severity N`, optional `(🤖 caught by AI triage)`, the quoted message (300 chars), who, where (+pod), the AI verdict with previous severity when upgraded, `📟 Routed to:` naming the delivery targets, and an IST timestamp (`Asia/Kolkata`, 12-hour). `earlyWarningMarkdown()`: `## ⚠️ EARLY WARNING — FLOOD`, the message, the detecting pod, and *"signed broadcast sent to all pods"*. `sendTestAlert()` posts a friendly wiring check listing what the space will receive.

**`webexHealth()`** authenticates via `GET /people/me` (cached bot identity), force-refreshes rooms, and reports `ready` / `no-spaces` / `no-token` / `disabled` / `unreachable` with the space titles.

---

# CHAPTER TWO — The Watchtower
## `Command-Center/Frontend/server.js` (429 lines) and the React mural

The Watchtower (port 9400) never decides anything. It **aggregates**, **relays**, and **carries the operator's seal**.

### 2.1 Static Serving with a Fallback

`STATIC_DIR` prefers a built React bundle (`dist/index.html`) and falls back to the legacy `public/` — the realm serves whichever face has been built, and the final `app.get("*")` catch-all makes client-side routing work on refresh.

### 2.2 The Realtime Bridge — `connectBackendRealtime()` (lines 83–138)

A `socket.io-client` connection to the Capital (`CLOUD_SOCKET_URL`, websocket transport, reconnection backoff 1 s → 8 s) feeds a local Socket.io server (`uiIo`) that browsers connect to. `publishRealtime(type, payload)` stamps `realtimeStatus` (last event type/time — inspectable at `GET /api/realtime/status`) and emits everything to browsers as `command-center:update`. Traceable double-logging shows each event received from the backend and forwarded to the browser, keyed by payload id. Connection lifecycle events (`backend:connected`, `backend:disconnected` with reason, connect errors with timestamps) are themselves published, so the UI can show a live/stale indicator honestly. On `cloud:snapshot` it forwards just the counts — the browser gets its full data through REST, the socket carries deltas.

### 2.3 The Great Fan-Out — `GET /api/overview` (lines 186–253)

One request from the browser becomes a parallel `Promise.all` across the whole kingdom: Capital health, all requests, all alerts, Storm-Bringer infra status, sensor annals, **and** `fetchPods()` — which probes all ten villages' `/api/pod/status` (1.5-second timeout each) and normalizes each into `{podId, podName, reachable, mode, activePath, activeCellTower, satelliteStatus, cellularStatus, queuedRequests, hazardAlertCount, triggeredHazards, relayPod}`; an unreachable village is honestly `{reachable: false, mode: "offline", activePath: "none"}`.

The aggregation logic:

- **Citizen filter**: requests minus EARLY-WARNING, SECURITY, and anything coordinator-originated (`requestKind` prefix or `coordinatorId`).
- **Open filter**: minus anything whose `resolutions` contain a `resolved` entry.
- **Freshness**: `isLastHour()` on `cloudReceivedAt` (with fallbacks) yields the "last hour" KPI variants.
- **Criticality**: `isCriticalRequest()` — explicit flag, "critical" string, or severity ≥ 8, matching the Capital's boundary exactly so the same request never reads differently on two screens.
- **Mode verdict**: any island pod → `ISLAND MODE`; all pods online → `CLOUD MODE`; else `MIXED`.
- Returned: counts (active, resolved, last-hour, critical, critical-last-hour, podsOnline/Total, queued at pods, queued coordinator deliveries, island pods, alerts), infra, the pod array, the 12 newest citizen requests, all coordinator deliveries, sensor readings + summary, 5 early warnings, 5 security events, 8 alerts.

### 2.4 The Proxies and the Seal

Most other gates are honest pass-throughs to the Capital (`/api/requests`, `DELETE /api/requests/:id`, `/api/coordinator-deliveries` + retry, `/api/alerts`, `/api/sensors`, `/api/ai/health`, `/api/sitrep` — the POST with a **120-second** timeout because CPU generation is slow, `/api/broadcast` → the Herald). Two are special:

- **`POST /api/infra/:target/:action`** — the operator's destructive lever. A target map expands `cellular` to *both* towers; only `fail`/`restore` are accepted; each expanded target is POSTed to the Storm-Bringer **with the `x-infra-token` seal** (`CONTROLLER_AUTH_HEADERS`), results collected per container. `POST /api/infra/restore-all` heals all three bridges in sequence.
- **`GET /api/pods`** and **`GET /api/infra`** give the topology pages their raw data.

### 2.5 The Mural — `Frontend/client/src/App.jsx` (2,126 lines)

The React SPA renders the five operator surfaces (Dashboard KPIs and live request table, Requests, Network topology with the simulation buttons, Resources, Alerts with the broadcast form and Shield events), consumes `/api/overview` on an interval, and layers `command-center:update` socket deltas on top for the real-time feel. It is deliberately a *view*: every decision it appears to make is actually a Capital or Storm-Bringer decision reflected.

---

# CHAPTER THREE — The Guild Halls
## `coordinators/server.js` (1,632 lines) — one charter, nine buildings

Nine containers run this identical file; environment decrees (`COORDINATOR_ID`, `COORDINATOR_NAME`, `COORDINATOR_ROLE`, `COORDINATOR_REGION`, `COVERAGE_NODES`, `SATELLITE_URL`, `CELL_TOWERS`, `CONNECTED_TOWERS`, `NEIGHBORS`) individuate them at birth. Unknown roles fall back to the shelter charter.

### 3.1 The Five Charters — `ROLE_TEMPLATES` (lines 25–202)

Each role defines four things:

- **Matching vocabulary**: `matchCategories` + `matchKeywords` (hospital hears *insulin, oxygen, icu…*; flood hears *boat, marooned, roof, trapped…*).
- **The treasury** — six `numberField(id, label, value, unit, min, max)` entries per role. Hospital: beds 18/200, oxygen cylinders 42/400, emergency doctors 8/80, ambulances 3/30, critical patients, medicine kits 64/800. Flood: trapped-people cases, boats 6/80, active teams, completed rescues, life jackets 74/500, rope kits. The `max` values matter — they anchor the low-stock threshold (see 3.5).
- **Seed tasks** (three per role, e.g. hospital's "Triage queue / Ambulance dispatch / Oxygen redistribution") and **seed incidents** (two per role with ids like MED-214, FLOOD-501) so a freshly-booted guild hall looks staffed.

### 3.2 The Vault — three files and an atomic pen (lines 261–301)

State lives in `DATA_DIR`: `coordinator-state.json` (the ledger: identity, fields, tasks, incidents, inbox, history, hazardUpdates), `sync-queue.json` (the outbound mailbag), `network-state.json` (the three local switches). `writeJson()` writes a `.tmp` then renames atomically — with an explicit Windows fallback: on `EACCES`/`EPERM` it copies then best-effort unlinks, because *"some Windows workspaces deny unlinking immediately after copy."* `readJson()` self-heals corrupt files by resetting to the fallback with a warning.

### 3.3 The Restorer — `mergeState()` and the resurrection guards (lines 348–428)

Every `getState()` re-merges saved state over `defaultState()`:

- Saved field values overlay charter fields **by id**, so charter evolution (new fields) never loses saved values.
- `dedupeById()` repairs any pre-dedup-era duplicates ("lists are newest-first, so keeping the first occurrence keeps the newest").
- **The tomb rule**: anything in `history` is subtracted from the `inbox` — *"anything already in history must not also sit in the inbox — repairs requests that resurrected via the cloud pull before this guard existed."*

### 3.4 The Scout — `calculateMode()` (lines 575–647)

The guild's ladder, evaluated fresh on demand: local switches consulted (`network-state.json`); satellite `/health` (1-second timeout) and all towers probed in parallel; `summarizeCellular()` says `up` (all up), `degraded` (some up), `down`, or `not-configured`.

Rungs, in order: satellite enabled **and** `"up"` → `cloud/satellite`; any tower `"up"` → `cloud/cellular` with `activeCellTower`; mesh enabled → walk `identity.neighbors`, calling `inspectNeighborForRelay()` which politely tries **two doors** — `/api/pod/relay-candidate` then `/api/coordinator/relay-candidate` (900 ms each) — accepting any neighbor reporting `mode: "cloud"`; else **island**.

> **An honest difference from the villages**: the guild ladder has *no degraded tail*. A pod (Chapter Five) will ride a degraded satellite before falling to mesh; a guild treats degraded satellite as unusable and goes straight to towers/mesh/island. Same doctrine family, stricter dialect.

### 3.5 The Quartermaster — shortage math (lines 694–760)

`shortageLevelFor(field)`: numeric fields only; value ≤ 0 → `"out-of-stock"`; value ≤ **10%** of `max` (`LOW_STOCK_RATIO`) → `"low-stock"`; else `null` (healthy). `buildShortageEvent(field, level, route)` composes a `coordinator-resource-shortage` event whose message is written for the *operator*: out-of-stock says *"Command Center should route new hospital requests to another coordinator"*; recovery says *"restocked… can take new assignments again."* Severity is 9 (out) / 6 (low) / 3 (recovered), with a matching triage block. These events are what feed the Capital's `coordinatorShortageLevels` map and `targetsWithStock` steering (Chapter 1.7).

### 3.6 The Receiving Clerk — `storeIncoming()` (lines 868–1026)

The most intricate function in the realm. Step by step:

1. **The banner check** — `matchesCoordinatorRole(payload)`: accept if explicitly addressed (`targetCoordinatorId` matches), role-addressed (`targetRole`), listed among `routing.targets` (each normalized to `{id, role}` and matched by id first, else role), category matches the charter, or any charter keyword appears in `textForMatching()` (category/type/hazard/alertType/title/message/detail/location concatenated). Otherwise `{accepted: false}` — which the Capital records as a permanent **rejected**.
2. **The tomb check**: if the id is already in `history`, or the payload's own `resolutions` show *this* guild resolved it (`resolvedAtCloud` — covering the case where the guild's data volume was wiped), the request must **never resurrect into the inbox**. The comment names the enemy precisely: *"the cloud keeps every request forever and re-sends the whole list on the 6s pull, and a mesh copy can arrive minutes later — local history is the source of truth."* The archived card is still refreshed in place (severity via `higherSeverity`, a late-arriving completed AI verdict attached, `lastSeenAt` stamped) without changing its position.
3. **Severity normalization** — `normalizeSeverity()` maps words directly, or numbers by the **same boundaries as the Command Center** (≥8 critical, ≥6 high, ≥4 medium, else low) — the comment: *"so the same request never reads LOW on one screen and MEDIUM on another."* `SEVERITY_RANK` (info 0 → critical 4) powers `higherSeverity()`.
4. **The card** is built with everything the field team needs: title/category/message/location, severity, source and transport, source pod, requester name, the `deliveryId` (linking back to the Capital's delivery row), the delivery route (transport/link/trigger/sentAt), matched departments with routing summary, the AI verdict *only if complete* (a direct radio copy without a verdict must not erase one — Law 3's cousin), and `originatedAt` (creation at the origin pod — *"can be much earlier than receivedAt if it waited in an offline queue"*).
5. **The merge covenant** for duplicates: `receivedAt` keeps the **first** arrival ("a second copy over another path must not make the request look like it just came in"); `workStatus`/`acknowledgedAt` are preserved; severity only climbs; the AI verdict is never erased; `transport`/`source` keep a direct-mesh identity if that's how it first arrived; and `seenVia` accumulates the set of every transport that has carried this request — a wax seal per messenger. A receipt is logged only for genuinely new arrivals or new transports.
6. **Placement**: merged duplicates keep their position; only new requests go on top (*"re-pulls from the cloud must not reshuffle the list"*). Inbox caps at **80**; hazard payloads (`isHazardPayload`: has hazard/alertType/kind) additionally enter `hazardUpdates` (cap 40).

### 3.7 The Outbound Machinery (lines 1028–1227)

- `enqueueSyncEvent()` upserts into `sync-queue.json` by id with `queuedAt`/`queueUpdatedAt` stamps.
- `forwardViaCloudLink(route, event)` → `POST {activeLink.url}/api/forward` (2.5 s) — the event crosses a bridge and pays physics.
- `forwardViaMesh(route, event)` → `POST {relayPod.url}/api/mesh/inbox` (4.5 s), stamped `syncStatus: "relayed-over-direct-pod-mesh"` plus a `meshLink {fromPodId, toPodId, sentAt}` block.
- `runSync(trigger)`: empty queue → early out; island → *"Coordinator updates are retained locally"*; otherwise each queued event is stamped with `syncAttemptAt`, a path-specific `syncStatus`, and a `network` block (mode/path/tower/relay), then forwarded; success removes it from the mailbag, failure keeps it with a warning. `syncOnce()` is single-flight — concurrent triggers join the running promise. Auto-interval: **5 seconds**; `triggerSync(trigger)` also fires 150 ms after any field/task/resolution change.
- `pullCloudMessages(trigger)` — the Pilgrim, every **6 seconds**: only with a direct cloud route; walks the bridge's read lane `GET {link}/api/cloud/coordinator-messages?targetCoordinatorId&targetRole&role` **and** `GET {link}/api/cloud/requests` (2.5 s each), feeding every result through `storeIncoming()` (skipping `coordinator-*` kinds from the requests list — a guild does not ingest other guilds' ledger updates as work). Push (Capital deliveries) and pull (this) together mean a request must dodge two messengers to be lost.

### 3.8 The Public Gates (lines 1229–1611)

- `GET /api/coordinator/status` — the full ledger, with inbox sorted by `receivedAt` and history by `resolvedAt`, **at response time**: *"merge/re-pull churn must never decide the on-screen order — an operator reads arrival order, latest on top."* Includes role branding (label/dashboard/accent), the network route, sync queue depth, and coverage.
- `GET /api/coordinator/relay-candidate` (+ a `/api/pod/relay-candidate` alias that internally rewrites the URL) — answers neighbors asking *"can you reach the capital?"* using a no-mesh, cached-health route calculation.
- `GET /api/gossip` — hops 0 (direct cloud), 1 (mesh-relay), or 999 (island), with a route path — making guilds first-class citizens of the villages' gossip protocol.
- `PATCH /api/coordinator/fields/:fieldId` — validates numerics, saves, computes the shortage transition, queues the `coordinator-field-update` event (which carries a **full state snapshot** — fields, tasks, incidents — so the Capital always has the guild's latest picture), queues a shortage event **only when the level actually changed** (*"so repeated saves at the same level don't spam the cloud"*), and triggers sync.
- `PATCH /api/coordinator/tasks/:taskId` — status update + `coordinator-task-update` event.
- `POST /api/coordinator/inbox` (+ `/api/mesh/inbox` + `/api/relay` — three doors, one room, `acceptCoordinatorInbox`): payloads whose `requestKind` starts with `coordinator-` are **not** work — they are another guild's sync events being relayed through this guild's better connectivity; they go straight into the mailbag (stamped `relayedByCoordinator`) and 202. Everything else goes to the Clerk; refusals return 202 with `accepted: false` and the reason.
- `PATCH /api/coordinator/inbox/:requestId` — the lifecycle: only `acknowledged` or `resolved`. Acknowledge stamps the card in place; resolve moves it inbox → history (cap 50, **one entry per id, ever** — re-resolving a returned copy replaces, never twins) and queues a `coordinator-request-resolution` event whose deterministic id `coord-resolution-<guild>-<request>-<status>` makes it idempotent. The section comment marks the historical significance: *"closing the loop (before this, data only ever flowed downward)."*
- `POST /api/sync` — manual sync and pull in parallel; `POST /api/network/:path/:state` — the local switches; a final error middleware turns unhandled throws into a clean 500.

---

# CHAPTER FOUR — The Bridges
## `link-node/server.js` (233 lines) — one charter, three crossings

One codebase, three incarnations via environment: `satellite` (:9100, latency 80 ms), `celltower-1` (:9201, 30 ms), `celltower-2` (:9202, 30 ms). This is the only realm whose *job* is to be imperfect (Law 5).

### 4.1 The Soul — `linkState` and `linkStatus()` (lines 16–31)

Two numbers are the bridge: `loss` (0–1 probability any crossing fails; env `LOSS`, default 0) and `latencyMs` (env `LATENCY_MS`, defaulting by link type). One rule interprets them: `loss >= DEGRADED_LOSS` (default **0.25**) → status `"degraded"`, else `"up"`. The header comment names the lineage: *"loss >= DEGRADED_LOSS makes /health report 'degraded', which pods treat as a predictive-failover signal (the ThousandEyes idea with one rule)."* Rain fade is one curl away: `curl "http://localhost:9100/set?loss=0.4"`.

### 4.2 The Two Laws — `sleep()` and `packetLost()` (lines 44–50)

`sleep(latencyMs)` is the toll — every forward waits, no exceptions. `packetLost()` is one throw of `Math.random() < loss`. Four lines that carry all the physics in the simulation.

### 4.3 The Confessor — `GET /health` and `GET /api/link/status` (lines 78–84)

Both return `statusPayload()`: linkId, linkType, status, loss, latencyMs. The Confessor never lies and never blocks — it reports `degraded` while the bridge drops 40% of traffic. Its audience is every scout in the kingdom: pod Marshals (5-second poll), guild Scouts (on demand), and the Capital's delivery scout (2.5-second cache).

### 4.4 The Weather Altar — `ALL /set` (lines 86–101)

Accepts `loss` (clamped 0–1) and `latencyMs` (floored at 0) from query or body, logs the new conditions with the resulting status. **Architect's note**: this altar is unauthenticated — a deliberate demo convenience, in pointed contrast to the Storm-Bringer's sealed gates. Lock it before anything resembling production.

### 4.5 The Enrollment Road — `GET /api/pubkey` (lines 103–116)

A passthrough to the Capital's `/api/pubkey` (2-second timeout, 502 with the bridge's name on failure). The comment states the constitutional rule it exists for: *"pods never talk to the cloud directly, so even the one-time public-key fetch travels through a link-node."* Every future forgery rejection in the kingdom begins with this crossing.

### 4.6 The Caravan Gate — `POST /api/forward` (lines 118–155)

The main ritual: **sleep** the toll → **roll** the dice (a loss logs `DROPPED <id>` and answers **503** *"packet lost on a degraded link"*) → **stamp** the survivor via `withForwardMetadata()` (`forwardedBy: <linkId>`, `linkType`, `forwardedAt` — how every dashboard later knows *which* bridge carried a request) → **deliver** to the Capital's `/api/requests` (2-second timeout), passing the Capital's status and body back to the sender. A cloud failure answers **502** *"could not reach cloud API."* The two failure codes mean different tragedies: 503 = the bridge ate it, retry; 502 = the bridge crossed but the Capital's gate was shut.

### 4.7 The Convoy Gate — `POST /api/forward-batch` (lines 157–191)

The thin-uplink answer: validates a non-empty `requests` array, sleeps the toll **once** for the whole convoy, then per item rolls the dice and forwards individually — survivors into `forwarded`, casualties into `failed`, both returned so the sender re-queues only the casualties. `success` is true only when nothing failed.

### 4.8 The Passthrough Lanes (lines 193–227)

- `POST /api/forward/(.+)` — generic westbound: stamps metadata and forwards the body to `{cloud}/api/<path>` (2.5 s). This is how guild sync events reach `/api/coordinator-events` etc.
- `GET /api/cloud/(.+)` — generic eastbound: forwards with the **query string faithfully preserved** (extracted from `originalUrl`), 2.5 s. This is the Pilgrim's road.

**Architect's note**: these lanes charge no toll and roll no dice — physics applies only to the SOS gates. A simplification the demo never notices, and a known asymmetry worth remembering.

---

# CHAPTER FIVE — The Villages
## `pod-agent/` — `server.js` (954 lines) and seven services (1,831 lines)

Ten containers, one charter, individuated by `POD_ID`, `POD_NAME`, `SATELLITE_URL`, `CELL_TOWERS`, `CONNECTED_TOWERS`, `NEIGHBORS`, `DATA_DIR`, `COORDINATOR_ROUTES`. Each village holds one promise: *a cry for help, once spoken inside these walls, can never be lost.*

### 5.1 The Reeve — `server.js`

**Boot order matters** (lines 33–56, 938–955): the sync worker is constructed with the Marshal's functions injected (`calculateMode`, `forwardViaRoute`, `forwardBatchViaRoute`, `sendToRelay`, `podInfo`); health polling starts with an `onChange` listener that logs the change and wakes the sync worker (`triggerQueueSync("health-change")` — a 250 ms deferred `syncOnce`); after `listen`, gossip neighbors are configured, the **2-second** gossip sweep starts, and `startEnrollment()` begins fetching the trust anchor.

**`createRequest(body, route)`** (line 314) forges the canonical SOS: a UUID, pod identity, name/age/phone, the Healer's triage verdict (severity/priority/reason — and the triage *category* overrides the citizen's choice when critical), a normalized `language` block (`normalizeRequestLanguage` handles object, string, or absent → defaults to English/`en-IN`), and a **complete network snapshot at submission time** (mode, activePath, tower, relay, statuses, poll metadata, switch states) — forensic gold when reconstructing how a request traveled. `syncStatus: "pending"`, `createdAt` stamped.

**The Citizens' Gate — `POST /api/requests`** (line 750): rate-limit → validate (message required — it feeds triage) → `calculateMode()` → `createRequest` → **`queueLocal()` first** (Law 1: `localQueue.enqueue` with `syncStatus: "queued-at-origin-pod"`) → `notifyMatchingCoordinators()` (the direct radio shout, below) → `triggerQueueSync("submission")` → **202** with the request and the route ("Sync worker will try satellite, cellular, then pod mesh").

**The Crowd Gate — `rateLimitRequests`** (line 674): a token bucket per `x-device-id` header (IP fallback): burst **6**, one token refilled per **2 seconds** (`RATE_LIMIT_BURST`, `RATE_LIMIT_REFILL_MS`). Exhausted buckets get 429 with the kingdom's kindest error: *"Your earlier SOS is already queued — volunteers will reach you."* The design intent per the comment: *"protects the shared uplink from a stuck retry loop or a hostile flood without ever blocking a first SOS."*

**The Direct Radio Shout — `notifyMatchingCoordinators()`** (lines 116–312): `COORDINATOR_ROUTES` parses `role=url,url;role=url` (or bare URLs as role `all`). `requestMatchesCoordinatorRole()` matches, in order: role `all`; **explicit hazard-pack roles** (`request.roles` — *"so they route even when the alert text contains no role keyword"*); category; charter keywords over the request text. `coordinatorTargetsForRequest()` dedups by `role|url`. `postCoordinatorInbox()` then POSTs each target's `/api/coordinator/inbox` with an AbortController **2.2-second** timeout, stamping `source: "nearby-pod-mesh"`, `transport: "direct-pod-mesh"`, a `meshLink` block, and the pod's route at notify time. Failures are logged and *swallowed* — the shout is an enhancer; the queue-and-ladder path is the guarantee.

**The Sky-Herald's Gate — `POST /api/alerts`** (line 548): `connectivity.verifyAlert()` renders the Shield verdict. On failure: log `SHIELD rejected alert: <reason>`, and if the code is 401 (a *cryptographic* rejection, not a missing anchor), queue a severity-9 SECURITY event and wake the sync worker — the attack report rides the normal ladder to the Capital. On success: `hazardPacks.storeAlert({...verified: true, source, receivedAt})` and 201.

**The Instruments' Gate — `POST /api/sensors`** (line 590, with a legacy `/sensor` alias that rewrites the URL): `hazardPacks.recordSensorReading()` journals and evaluates. For every fired hazard: (1) `connectivity.sendPodAlert()` queues it as an EARLY-WARNING SOS in the Ledger — the comment explains the category is load-bearing: *"the cloud only answers with a signed broadcast to every pod when it sees this category — without it the 'warn all pods' step silently never happens"*; (2) the direct radio shout runs with an EARLY-WARNING dressing (*"so the local fire/flood camp reacts even when every uplink to the cloud is down"* — the URWB range annotation); (3) the sync worker is woken immediately. Response is 201 when anything fired, 200 otherwise.

**The Red Fixture — `POST /api/sensors/button`** (line 704): the Meraki MT30 gate. The comment explains the philosophy: a physical press *"doesn't carry sensor thresholds — it's an unambiguous 'someone needs help now' signal, so it skips hazardPackService entirely."* The request is forged with defaults, then **overridden unconditionally**: category `Medical/Rescue`, severity **9**, priority critical, reason *"Meraki MT30 smart automation button pressed on-site"* — *"a pressed button is inherently urgent regardless of message wording."* Queued, synced, 202.

**The Neighbors' Gate — `acceptMeshInbox`** (line 779, doors `/api/mesh/inbox` and `/api/relay`): id required (400). `hasMeshHopVisitedPod()` checks origin pod, `relayedBy`, and the entire `relayTrail` — a request never re-enters a village it already visited (loop prevention at the data layer, complementing gossip's path-vector at the routing layer); such arrivals get a 202 `skipped: true`. Otherwise `buildMeshInboxRequest()` appends this village to `relayTrail` (podId/podName/region/receivedAt), sets `relayedBy`, and annotates `network.meshInbox*`; the request is queued as `"queued-at-mesh-inbox"`, coordinators are shouted at, 202 returned, sync woken. **The carried cry becomes this village's own responsibility.**

**Drills and switches**: `POST /api/hazards/reset` and `POST /api/security/forged-alert` require the manager seal (`x-manager-token`); the latter records a Shield drill as a security event without a real forgery. `POST /api/network/:path/:state` flips the village's own three switches (satellite/cellular/mesh × enable/disable — `localQueue.setNetworkPath`), enabling *local* failure drills distinct from the Storm-Bringer's *global* ones. `GET /api/pod/status` supports an `x-sanjeevani-probe: direct` header (or `?scope=direct`) that disables mesh consideration — so a neighbor probing "are YOU directly connected?" doesn't recursively trigger this pod's own mesh hunt.

### 5.2 The Marshal — `services/connectivityManager.js` (767 lines)

**The Codex** (line 40) — `ciscoSimulation` — the file names its own physical body: pod edge = *"Cisco Catalyst IR1800 IOx edge app for local SOS intake and cache"*; satellite = *"LEO satellite / 5G-NTN backhaul"*; cellular = *"Cisco Meraki MG cellular backhaul"*; mesh = *"Cisco URWB pod-to-pod relay path"*; local Wi-Fi = *"Meraki MR captive portal"*; sensors = *"Meraki MT style hazard inputs."* This object is returned inside every `/api/pod/status` — the demo UI can show the hardware story live.

**The Watchtower** — health polling: `pollHealthOnce()` probes satellite + all towers in parallel (1-second timeouts; an error *body* carrying a status is honored — a bridge can confess through an error). `summarizeCellular` here counts `degraded` towers as *usable*: all up → `up`; any usable → `degraded`; none → `down`. A JSON signature of the snapshot detects change; **only changes fire the listeners** (and the very first poll doesn't, avoiding a spurious wake at boot). `refreshHealthSnapshot()` is single-flight; `getHealthSnapshot()` serves cache unless stale (default max age 1.5 s; `calculateMode` demands 250 ms freshness). The poll interval is **5 seconds**.

**The Ladder** — `calculateMode(options)` (line 395), the full doctrine with the degraded tail:

1. satellite enabled + `"up"` → `cloud/satellite`
2. cellular enabled + any tower `"up"` → `cloud/cellular` (that tower)
3. satellite enabled + `"degraded"` → `cloud/satellite` with `degradedLink: true` — the comment: *"a DEGRADED link ranks below any healthy link — traffic moved away above — but a degraded link that still works always beats mesh relay and island mode."*
4. any tower `"degraded"` → `cloud/cellular` degraded
5. mesh enabled + neighbors exist → `findMeshRelay()`
6. island.

**The Mesh Hunt** — `findMeshRelay()` delegates to the gossip brain: `getBestDynamicNeighbor()` returns the shortest-path living neighbor or null (→ island). Selection logs are throttled (only on route change or every 60 s). The chosen neighbor is wrapped in the `relayPod` shape the rest of the app expects. (The older direct-probe `inspectNeighborForRelay()` — GET a neighbor's `/api/pod/relay-candidate`, require `mode: "cloud"` — remains in the file as the compatible fallback path.)

**The Shield** (lines 608–682): `fetchPubkeyOnce()` tries the satellite then each tower's `/api/pubkey` (2 s each), builds a `crypto.createPublicKey` from DER hex, caches it forever, and logs *"enrolled: alert trust anchor cached via <source>."* `startEnrollment()` retries every 5 s until success. `canonicalAlert()` mirrors the Capital's byte-exact canonical form. `verifyAlert(alert)` renders one of five verdicts: **503** *"no trust anchor yet"* (not yet enrolled — refuse but don't cry foul); **401** *"unsigned alert rejected"*; **401** *"invalid signature"* (any `crypto.verify` exception counts as invalid); **401** *"stale sequence — replay rejected"* (`seq <= lastAlertSeq`); **401** *"scope mismatch"* (scope ≠ `all` and doesn't include this podId); else **ok**, and `lastAlertSeq` advances.

**The Outbound Hands**: `forwardViaRoute` (`POST {link}/api/forward`, 2.5 s), `forwardBatchViaRoute` (`/api/forward-batch`, 8 s), `sendToRelay` (fetch to a neighbor's `/api/mesh/inbox`, 5 s, with tolerant JSON parsing of the reply). `sendPodAlert` and `sendSecurityEvent` do not send at all — they **enqueue** (Law 1) shaped events (EARLY-WARNING / SECURITY categories) and let the Porter carry them.

### 5.3 The Porter — `services/syncWorker.js` (249 lines)

`runSync(trigger)`:

1. Empty queue → done. Otherwise log the intent: *"checking N queued request(s) from <trigger>: satellite -> cellular -> mesh."*
2. `calculateMode()`; island → *"Queue retained locally"*, everything remains.
3. **The Convoy rule**: cloud route + queue length > 3 → one `forwardBatchViaRoute` carrying all items, each stamped `syncStatus: "synced-after-reconnect-via-<path>"` and `network.syncBatch: true`; only ids in the bridge's `forwarded` list are removed from the Ledger (Law 1: receipt-based deletion, per item, even in a batch). A batch *error* falls back to per-item sync in the same pass.
4. Per-item: cloud → `forwardViaRoute`; mesh → `meshTargetsFor()` filters the route's relay pods against `relayVisitedPods()` (origin + relayedBy + full trail — never hand a cry back to a hand that held it); each surviving target is tried, success requires **at least one** acceptance; then `localQueue.removeFromQueue(id)`.
5. Failures keep the item with a warning; the summary reports synced/failed/remaining.

`syncOnce()` is single-flight — a manual trigger during an auto pass *joins* the running promise (logged as such). The auto-interval is **5 seconds**; wakes also arrive from submissions, mesh arrivals, hazards, security events, health changes, and MT30 presses.

### 5.4 The Whisper Network — `services/gossipRouter.js` (223 lines)

A singleton `GossipRouter(POD_ID, NEIGHBORS)`. Constants: `MAX_HOPS = 12` (*"the absolute maximum size of our network to kill ghost loops"*), `PEER_TTL_MS = 1500`.

- `sweepNetwork()` — every 2 s, overlap-guarded: dedup + self-exclude the configured neighbors, ping each `/api/gossip` with a **300 ms** timeout in parallel (`Promise.allSettled`), record answering peers `{podId, hopsToCloud, routePath, lastSeen}`, delete the silent, expire anyone unseen past 1.5 s, then `recalculateShortestPath()`.
- `recalculateShortestPath()` — the pocket **BGP path-vector**: reject any peer whose advertised `routePath` already contains this pod (loop prevention), accept only routes strictly under 12 hops, choose minimum `hopsToCloud`.
- `getMyGossipData(mode)` — this pod's own advertisement: direct cloud → hops 0, path `[me]`; a live best relay → its hops + 1, path `[me, ...its path]`; else hops 999 (island) with the relay cleared.
- `setNeighborUrls()` prunes peers no longer configured — the mesh stays range-bounded by the compose topology. Logging is signature-throttled with modes (`changes` default, `summary`, `debug`, `off`).

### 5.5 The Watchman of Omens — `services/hazardPackService.js` (218 lines)

Four scrolls in `HAZARD_PACKS`, each declaring `sensor`, `threshold`, optional trend (`trendWindow`, `trendMinRise`), `severity`, **`roles`** (the comment: roles drive *"BOTH the direct pod → in-range coordinator notification and the cloud's routing, so a hazard never depends on its alert text happening to contain a role keyword"*), and a templated alert with `{site}`/`{value}`:

| Hazard | Sensor | Threshold | Trend | Severity | Roles |
|---|---|---|---|---|---|
| flood | water_level | 150 cm | +25 over 5 readings | 9 | flood, shelter |
| earthquake | shake_g | 0.4 g | — | 10 | hospital, workforce |
| heatwave | temperature | 45 °C | — | 7 | hospital, shelter |
| wildfire | air_quality (MT14 PM2.5) | 250 µg/m³ | +120 over 5 | 8 | fire, workforce |

`recordSensorReading(identity, body)`: validates sensor name and numeric value; appends to a per-sensor journal capped at the **last 30 readings** (`sensor-readings.json`); then for each un-latched pack on this sensor, fires on threshold (`value >= threshold`) **or** trend (rise across the window ≥ `trendMinRise` — this is what catches a flood *while it rises*, before the absolute line); a firing writes the latch (`hazard-triggers.json` — **once per hazard until reset**), stores the formatted alert (cap 25, `alerts.json`), and returns it in `fired`. `resetHazards()` (manager-sealed at the Reeve) clears all three files. All writes are atomic temp-and-rename.

### 5.6 The Fireproof Ledger — `services/localQueue.js` (164 lines)

`queue.json` and `network-state.json` under `DATA_DIR` (the Docker volume `pod-data/pod-XX/`). `enqueue()` upserts by id (`queueUpdatedAt` on merge, `queuedAt` on insert); `removeFromQueue(id)` returns how many were removed; `getQueueCount()` backs the status endpoint. Network state normalizes legacy value forms (`"down"/"disabled"/"false"` → false; `"up"/"degraded"/"enabled"/"true"` → true) and `setNetworkPath()` validates path (`satellite|cellular|mesh`) and action (`enable|up|restore` / `disable|down|fail`). Every write is atomic; corrupt files self-heal to fallbacks with a warning.

### 5.7 The Healer — `services/triageService.js` (143 lines)

Two keyword lists, written in **eleven scripts** (English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Urdu, Odia):

- `CRITICAL_KEYWORDS` (*unconscious, bleeding, insulin, pregnant, trapped, chest pain, stroke, drowning, seizure, snake bite…* and their translations; the entry `"breath"` is deliberately a substring so one entry covers *breathe/breathing/breathless*) → severity **9**, priority critical, category forced to `Medical/Rescue`, reason naming the matched keyword.
- `ESSENTIAL_KEYWORDS` (*food, water, medicine, shelter, blanket, ration…* and translations) → severity **6**, medium.
- Neither → severity **3**, low, *"General assistance request."*

Synchronous, instantaneous, dependency-free — triage that works in a bunker.

### 5.8 The Name-Keeper — `services/podSettings.js` (67 lines)

Persists the operator-editable pod display name (surfaced through `getPodIdentity()` and `POST /api/pod/name`) so a renamed village keeps its name across restarts.

### 5.9 The Citizen's Face — `client/`

A Vite/React SPA (`EmergencyRequestForm`, `HeroPanel`, `LocationSelector`, `PodNetworkDetails`, `PodSensorPanel`, `ResilienceBanner`, `TrustFooter`) with an i18n layer (`LanguageContext`, `languages.js`, `translations.js`) matching the Healer's multilingualism. Served from `dist/` when built, with the legacy `public/` as fallback — same pattern as the Watchtower.

---

# CHAPTER SIX — The Weather-Makers
## `sensor-simulator/index.js` (255 lines)

The stagehands' guild: it plays **Nature** and **the instrument fleet** at once, and documents exactly where the pretending stops.

### 6.1 The Charter's Honesty (lines 16–55)

The header comments are a model of simulation ethics: a real MT10/MT12 talks BLE to a Meraki MR/MV gateway → Meraki cloud → Dashboard API poll (*"exactly what integrations/meraki_live.py does for real"*) or a Sensor Alert Profile webhook. This file plays only *"the thing on the other end of that webhook/API"* — same `{sensor, value, unit, source}` contract, same delivery. *"The BLE hop, the gateway, and the Meraki dashboard itself are NOT simulated — only the data contract and delivery are."* And the casting note: `shake_g` is *"intentionally NOT labeled Meraki — Cisco has no seismic MT sensor"* — it is framed as a third-party accelerometer via a Catalyst IOx edge app. The MT14's PM2.5 needs no such caveat — it is a genuine Meraki metric.

### 6.2 The Census — `STATIONS` and `BUTTONS` (lines 56–83)

Fifteen sensor rows across the ten pods — model, unit, `base` (resting value), `drift` (wander amplitude), `min`/`max` clamps. Names and URLs are *"pulled straight from your real docker-compose.yml, not placeholders."* Multi-sensor pods are paired where hazards genuinely co-locate (Riverbank Village: flood + quake; Evacuation Route: flood or quake can cut it; High Ground Shelter: heat + quake but too high to flood; Remote Village and Medical Camp: heat + MT14 smoke). The `max` values are deliberately set **past** the hazard thresholds — *"clamping at, say, 130cm would let you 'spike' POD-04 forever and never see a flood alert fire."* Three MT30 buttons (School Shelter, Medical Camp, Mobile Relay) live in their own list because a button is a signal, not a threshold.

### 6.3 The Physics — `stepStation()` (lines 100–117)

Per tick, per station: if a spike is armed, add `spikeStep` and decrement the counter; otherwise apply **mean-reversion plus noise** — `(base − value) × 0.1 + uniform(−drift, +drift)` — then clamp to `[min, max]`. The comment names the purpose: an idle station *hovers near base* instead of random-walking into a hazard threshold over a long demo; *"only a manual /spike should trigger a pack."* Nature, with stage discipline.

### 6.4 The Couriers and the Metronome (lines 119–143)

`sendReading()` steps the physics, rounds to 2 decimals, and POSTs `{sensor, value, unit, source: "Meraki <model> (simulated)"}` to the pod's `/api/sensors` (2-second timeout), recording `lastSentAt`/`lastError` per station; failures warn and never crash. The metronome fires all fifteen couriers every `TICK_MS` = **4 seconds**.

### 6.5 The Director's Console (lines 147–250)

- `GET /health`, `GET /status` — the playbill: every station with model, current value, spike state, last delivery, last error, plus the button roster.
- `POST /spike/:podId/:sensor` — body `{ticks (default 6), step (default 15)}` arms a ramp; the response echoes the plan and current value. A ramp, not a jump — which lets the flood pack's *trend* rule fire on the climb.
- `POST /reset/:podId/:sensor` — value back to base, spike disarmed.
- `POST /press/:podId` — forwards a simulated MT30 press to the pod's dedicated `/api/sensors/button` (3-second timeout), with an optional custom message; 502 with detail if the pod is unreachable.

Compose note: inside the network the simulator answers on container port **9400** (host-mapped to 9500) — which is exactly what the Storm-Bringer's default `SENSOR_SIMULATOR_URL` expects.

---

# CHAPTER SEVEN — The Storm-Bringer
## `simulation-controller/server.js` (484 lines)

The realm above the realms: it holds `/var/run/docker.sock` — the loom of reality — mounted through its temple wall by compose.

### 7.1 The Hand on the Loom — `dockerRequest()` (lines 86–126)

Raw Node `http.request` over the Unix socket path — no axios, no HTTP host, the primal tongue. It promisifies a single Docker Engine API call, resolving 2xx with parsed JSON and rejecting otherwise with the daemon's message and status code attached. Everything the deity does flows through this one hand.

### 7.2 The Book of Dooms (lines 33–65)

`links` maps each bridge to its public URL **and its true container name** (`sanjeevani-satellite`, `sanjeevani-celltower-1/2`) — destruction requires the true name. `towerCoordinatorCoverage` records which guilds live in each tower's shadow (FireDept/Hospital1/ShelterB under tower 1; the Workforce camps and ShelterCamp2 under tower 2) so the UI can show failure blast-radius. `POD_IDS` generates POD-01…POD-10 — the comment notes this is *"the single place that list lives now — nothing about pod topology is hand-typed in the frontend."*

### 7.3 The Seal-Keeper — `requireInfraAccess` (lines 75–84)

Every `fail`/`restore` demands `x-infra-token === INFRA_CONTROL_KEY`; missing or wrong → 401. Reading status requires nothing. Law 8 in four lines: *the data plane may be open; the control plane never is.*

### 7.4 The Coroner and the Twin Verdict (lines 132–197)

`inspectContainer(link)` GETs `/containers/<name>/json` and distills Docker's `State` into `{exists, running, dockerStatus, startedAt, finishedAt}` (404 → `missing`, not an error). `readLinkHealth(link)` asks the bridge's own Confessor (1-second timeout). `describeLink()` then demands **two witnesses**: `status: "up"` only when the container is *running* **and** health answers *up*; either dissent → `"down"`. `buildInfraStatus()` runs all three bridges in parallel and returns the flat verdicts (`satellite`, `celltower1`, `celltower2`), the coverage census, and full per-bridge detail.

### 7.5 The Executioner and the Resurrector (lines 289–352)

`stopContainer(linkKey)`: inspect first (missing → honest 404-shaped result); if running, `POST /containers/<name>/stop?t=0` — **zero grace**, because a flood does not send SIGTERM; re-describe and return the aftermath. `startContainer()`: inspect; if stopped, `POST .../start`; then — the crucial vigil — `waitForHealthy(linkKey)` polls the twin verdict every **350 ms** for up to **5 seconds**, so the word *"restored"* is only spoken once the bridge actually answers its Confessor. Both log their deed.

### 7.6 The Cartographer (lines 199–276)

`readPodStatus(podId)` probes `http://pod-XX:8000/api/pod/status` (1.2 s), normalizing neighbors from raw URLs back to pod ids (`urlToPodId`) so mesh-edge math works in one shape; the unreachable are drawn honestly (`mode: "unreachable"`), never omitted. `meshEdgesFrom(pods)` derives undirected, deduplicated edges from every pod's declared neighbors (sorted-pair keys), then walks the census again marking an edge **`active: true`** wherever a pod reports `mode: "mesh-relay"` through that neighbor (adding the edge if the wiring didn't declare it) — the comment: *"this is what turns a static wiring diagram into a live 'this is the real path traffic is taking' view."* `buildTopology()` returns pods + edges + timestamp; served at `GET /api/topology`.

### 7.7 The Envoy to the Weather and the Gates (lines 278–481)

`proxySensor()` relays to the Weather-Makers with `validateStatus: () => true` — even refusals pass through verbatim. Gates: `GET /api/health`, `GET /api/infra/status`, `GET /api/topology`, `GET /api/sensors/status`, `POST /api/sensors/spike|reset/:podId/:sensor`, `POST /api/sensors/press/:podId` — one control plane for catastrophe and provocation alike. The fail/restore routes are generated in a loop over the Book of Dooms, each wrapped by the Seal-Keeper. A JSON 404 handler closes the temple. A small `public/` control room UI rides along.

---

# CHAPTER EIGHT — The Embassy and the Proving Grounds
## `integrations/` — seven travelers, no territory

No container hosts this realm; its inhabitants are summoned by hand, act, and vanish.

### 8.1 The Meraki Ambassador — `meraki_live.py` (177 lines)

Speaks to the **real** Meraki Dashboard API (`https://api.meraki.com/api/v1`) with the `X-Cisco-Meraki-API-Key` header. Powers, in order of the `main()` flow: list organizations (honoring `MERAKI_ORG_ID` if set, else the first); list networks with product types; list devices and translate each through the `ROLE` codex (*MR → shelter Wi-Fi captive portal; MS → PoE backbone; MX → SD-WAN multipath failover; MT → hazard-pack sensing; MV → occupancy analytics; MG → cellular uplink*); pull `sensor/readings/latest` and print real MT telemetry, capturing the latest temperature. Modes: `--demo` sends a canned 46.5 °C event without touching Meraki; `--feed-control-center` posts a `report_sensor` payload to the control center; `--feed-pod <url>` injects the **real** temperature into a pod's `/sensor` gate — genuine Cisco telemetry driving the alert pipeline (46.5 °C is past the 45° heatwave threshold by design). Missing/expired keys exit with instructions pointing at the free DevNet "Meraki Always-On" sandbox.

### 8.2 The Catalyst Ambassador — `catalyst_restconf.py` (137 lines)

Speaks RESTCONF/YANG to a real (virtual) **Catalyst 8000v** in the DevNet "IOS XE Always-On" sandbox: HTTPS with basic auth, self-signed cert accepted (`CERT_NONE` — sandbox only), media type `application/yang-data+json`. Read mode GETs `ietf-interfaces:interfaces` and prints the interface roster. `--configure` PUTs the `LOOPBACK` document — `Loopback101`, description *"SANJEEVANI pod1 citizens-segment marker (configured by code)"*, address 10.99.1.1/32 — then GETs it back to verify, printing: *"This is the same mechanism (NETCONF/RESTCONF) the pod's Catalyst 9200/IE3300 would use for zero-touch VLAN + QoS setup."* Both ambassadors also try to `report_*` home to control-center endpoints — see the Loose Threads appendix.

### 8.3 The Tame Assassin — `inject_forged_alert.py` (36 lines)

Crafts the most dangerous lie in the kingdom — *"URGENT: Shelter compromised! Everyone move to the riverbank NOW."* — with `seq: 999` and `signature: "deadbeef"×16`, and POSTs it to a pod's `/api/alerts`. **Success is being caught**: an HTTPError 401 prints the rejection and reminds you the SECURITY event is now queued and will sync to the cloud; a 2xx prints `UNEXPECTED: pod accepted the forged alert!` and exits 1. The docstring includes the contrasting curl for a *genuine* alert, so the demo can show both fates side by side.

### 8.4 The Crowd Conjurer — `simulate_crowd.py` (63 lines)

Summons N (default 20) distinct victims — random names, ages, +91 phones, eight case templates from insulin to a dying phone battery — each with a **unique `x-device-id`** (`victim-<uuid8>`), submitted to one pod over ~a minute (0.5–2 s jitter). Tallies accepted / rate-limited (429) / failed, proving the token bucket throttles a hammering device while letting a genuine crowd through.

### 8.5 The Grand Inquisitor — `integration_test.py` (184 lines)

Summons a pocket kingdom as **local Node processes, no Docker**: the Capital (:19000, AI disabled), the Sky-Bridge (:19100), POD-01 (:18001, satellite-only, temp data dir), with per-service logs in a temp folder. After a 6-second enrollment pause, seven trials:

1. **Signed broadcast** → cloud delivery map shows POD-01: 201; the pod's stored alert has `verified: true`.
2. **The forgery** → 401 at the pod; within 15 s a SECURITY-category request appears at the cloud *via the ladder*.
3. **The dead bypass** → an alert claiming `verified: true` with no valid signature must still be rejected — a regression tombstone for a real past vulnerability.
4. **Hazard round-trip** → water readings 60→158 posted to the pod; within 15 s the pod holds a *flood* alert whose `source` is `cloud-api` and `verified` is true (pod → EARLY-WARNING → cloud → signed broadcast → back), and the cloud holds the EARLY-WARNING.
5. **Rain fade** → `set?loss=0.4`; the pod reports `satelliteStatus: "degraded"` **and** `mode: "cloud"` — degraded-but-used, the predictive-failover signal.
6. **Rate limiting** → ten rapid posts from one `x-device-id` produce at least one 429.
7. **Blackout & convoy** → `loss=1.0`, five rescues queue at the pod; `loss=0`, the queue drains to zero within 20 s and the cloud holds ≥5 "trapped near bridge" requests — the batch path proven.

Cleanup terminates every process regardless of outcome; a failure prints the log directory.

### 8.6 The Understudy Oracle and Its Examiner — `mock_ollama.js` (37 lines) + `ai_triage_test.py` (133 lines)

The understudy answers `/api/tags` (model present) and `/api/chat` — JSON mode returns severity 9 / roles [hospital] / *"Chest heaviness with dizziness suggests a possible cardiac event"*; text mode returns a four-section SITREP — so the entire AI chain is testable without a 2 GB download. The Examiner boots mock + Capital (AI enabled, Mongo timeout 500 ms) and verifies: health `ready`; a keyword-blind SOS ("my chest feels heavy and I'm dizzy", rule severity 3) is accepted at 3 and then upgraded to 9 with criticality flipped, `upgraded: true`, "cardiac" in the reason, **hospital added to routing** with evidence naming AI triage; SITREP generates and is served from cache on GET; then it **kills the understudy** and proves the constitution — a new request is *"still accepted instantly,"* ends `aiTriage.status: "unavailable"`, severity untouched at 3. Enhancer, never gatekeeper — executed, not asserted.

---

# APPENDIX A — The Cisco Concordance

| Kingdom construct | Code location | Real Cisco construct |
|---|---|---|
| The village hall itself | `pod-agent` (per `ciscoSimulation`) | Catalyst IR1800 running the agent as an IOx edge app |
| Citizens' Wi-Fi gate | pod React UI / `/api/requests` | Meraki MR captive portal |
| Sky-Bridge | `link-node` as satellite | LEO satellite / 5G-NTN backhaul behind the MX |
| Toll Bridges | `link-node` as celltower-1/2 | Meraki MG cellular gateways |
| Path choice at every realm | `calculateMode()` ladders | Meraki MX SD-WAN multipath policy |
| The `degraded` confession | `DEGRADED_LOSS = 0.25` | ThousandEyes-style pre-failure path telemetry |
| The village fence / direct guild shout | mesh inbox, `notifyMatchingCoordinators` | Cisco URWB pod-to-pod radio |
| The whisper network | `gossipRouter.js` (BGP path-vector comment) | Routing-protocol loop prevention, URWB topology |
| The omens | `hazardPackService` + `sensor-simulator` | Meraki MT10 / MT12 / MT14 sensors |
| The red fixture | `/api/sensors/button` | Meraki MT30 smart automation button |
| The seismic exception | `shake_g` census rows | Third-party accelerometer via Catalyst IOx (Cisco has no seismic MT — and the code says so) |
| Zero-touch segmentation | `catalyst_restconf.py` Loopback101 | RESTCONF/YANG on Catalyst 9200 / IE3300 (proven on a real 8000v) |
| Fleet census & real telemetry | `meraki_live.py` | Meraki Dashboard API |
| The falcon roads | `webexNotifier.js` | Webex bot Sanjeevni-Sentinel |
| Convoy gates / QoS | `forward-batch`, batch sync | Priority queuing on thin uplinks |
| Control-plane seals | `x-infra-token`, `x-manager-token` | Authenticated management plane (API keys, RESTCONF credentials) |

# APPENDIX B — The Loose Threads (honest findings)

1. **The unanswered embassy gates.** `meraki_live.py` (`report_sensor` → `POST /api/integrations/meraki/sensor`), `catalyst_restconf.py` (`report_device` → `POST /api/integrations/catalyst/device`), and `integrations/README.md` (`GET /api/integrations/events`, `/api/state`) all address endpoints that **do not exist** in `Command-Center/Backend/server.js`. Those calls will 404. The `--feed-pod` and `--demo`-to-pod paths work. Either add the two small endpoints or rehearse only the feed-pod flows.
2. **The unguarded weather altar.** `link-node`'s `ALL /set` accepts loss/latency changes from anyone, unlike every destructive gate elsewhere (`x-infra-token`, `x-manager-token`). Fine for a demo; a one-line middleware before production.
3. **Physics-free passthrough lanes.** `link-node`'s `/api/forward/*` and `/api/cloud/*` charge no latency and roll no dice — only the SOS gates pay physics. Coordinator sync and pulls therefore cross bridges "for free."
4. **The guilds lack the degraded tail.** Pod `calculateMode` rides a degraded link before mesh/island; coordinator `calculateMode` requires strictly `"up"` links. A degraded-satellite, no-tower guild goes to mesh/island where a pod would have limped on the satellite.
5. **Fresh signet ring per boot.** The Capital regenerates its Ed25519 keypair at startup; villages cache the pubkey once at enrollment. A Capital-only restart would strand villages on a stale anchor (all genuine alerts 401 as "invalid signature") until pods restart or re-enroll. The demo restarts the stack together, so this stays theoretical — but it is the kind of theoretical that bites in production.

# EPILOGUE

Read as one book, the kingdom has a single plot: **every realm assumes the realm next to it will fail, and writes everything down before trusting anyone.** The villages assume the bridges will fall; the bridges assume packets will drown; the Capital assumes the guilds are unreachable; the guilds assume the Capital will re-send everything forever; the Oracle and the Falconer assume they themselves are optional; the Weather-Makers assume nothing should happen unless commanded; and the Storm-Bringer exists to prove all of them right, on schedule, in front of witnesses.

That is not ten services. That is one argument, made ten ways: *in a disaster, the network is the first casualty — so build every promise on the assumption that it is already dead.*
