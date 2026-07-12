# SANJEEVANI — Complete Demo Runbook

*Everything you need to record the FAQ-mandated 5-minute video and drive a live judge demo. Every command is copy-paste ready for Windows PowerShell. Ports verified against `docker-compose.yml`.*

---

## 0. What the FAQ Requires (and where this runbook covers it)

The demo video (FAQ Q19) must show:

| FAQ requirement | Covered in |
|---|---|
| Project Name | Section 3 · Scene 0 |
| GitHub Repository URL | Section 3 · Scene 0 (say it + on screen) |
| Summary — core concept & value | Section 3 · Scene 1 |
| Technology Stack | Section 3 · Scene 1 + Section 6 |
| Core user-experience demonstration (functional / mock UI of the main workflow) | Section 3 · Scenes 2–7 (the whole live run) |

Also remember (FAQ Q16, Q17, Q20): repo **private**, admin rights to `https://github.com/bobybhadouria143`, no updates after the deadline, and the repo must contain **README + 1–2 page ADR + 2–4 architecture diagrams + demo code**. Video: **720p, ≤ 2 GB**.

> **Time budget for the 5 minutes:** Pitch 0:45 · Normal SOS 0:45 · Failover 1:00 · Mesh/Island 1:00 · Signed alert + forgery 0:45 · Coordinator resolution 0:30 · Close 0:15.

---

## 1. Pre-Flight (do this BEFORE you hit record)

```powershell
# from the repo root
cd "D:\CISCO Hackathon\SANJEEVANI_Code_With_Cisco"

# build & start the whole stack (first build ~3-5 min; do this early)
docker compose up -d --build

# wait ~30s, then confirm everything is healthy and green
docker compose ps
```

You want every service showing `Up`. Key URLs to have open in browser tabs, in this order:

| Tab | URL | Role in demo |
|---|---|---|
| 1 | http://localhost:9400 | **Command Center (EOC dashboard)** — your main stage |
| 2 | http://localhost:8001 | **POD-01 citizen portal** — where you submit SOS |
| 3 | http://localhost:8004 | **POD-04 portal** — the no-cellular pod, for the mesh demo |
| 4 | http://localhost:8101 | **Hospital-1 coordinator** — to show resolution |
| 5 | http://localhost:9300 | Simulation controller UI (optional, backup for fail/restore) |

**Reset to a clean slate** (run this right before recording so counts start fresh — optional):

```powershell
docker compose restart cloud-api
```

**A second terminal** kept open for the `curl`/`docker` commands during the demo. Keep this runbook on a second monitor or phone.

> **Health probes are cached ~2.5s and pods poll every 5s.** After any fail/restore, **wait 5–8 seconds** before narrating the result — the UI is telling the truth, it just polls on an interval. Build these pauses into your script; they read as drama, not lag.

---

## 2. The Cast (say these names on camera — they map to real Cisco roles)

| In the demo | Port | Real-world Cisco device it models |
|---|---|---|
| Field Pod | 8001–8010 | Catalyst IR1800 + IOx edge app |
| Citizen Wi-Fi | pod portal | Meraki MR captive portal |
| Satellite link | 9100 | LEO / 5G-NTN backhaul |
| Cell towers ×2 | 9201 / 9202 | Meraki MG cellular gateway |
| Pod-to-pod mesh | mesh API | Cisco URWB |
| Sensors | 9500 | Meraki MT10/MT12/MT14 + MT30 button |
| Command Center | 9400 | EOC / SD-WAN + ThousandEyes control plane |
| Simulation controller | 9300 | (demo tool — stops real containers to model physical failure) |

---

## 3. THE SCRIPT — Scene by Scene

### Scene 0 — Open (0:15) — *say, don't demo yet*

> "This is **SANJEEVANI** — a disaster-response SOS network. Repo is at **[your private GitHub URL]**. The idea in one line: when a flood or earthquake hits, the network is the first thing to die — so we built a system that assumes the network is *already dead*, and still guarantees a citizen's cry for help is never lost. Everything you're about to see is a live 14-service Docker stack, not a mock-up."

On screen: the Command Center dashboard at http://localhost:9400, all pods green.

---

### Scene 1 — The Normal Path (0:45)

**Narrate:** "First, the happy path. A citizen with a working connection."

**Do:** On the **POD-01 portal (tab 2)**, fill the SOS form:
- Name: `Ramesh`
- Category: `Medical`
- Message: `my grandfather is unconscious and needs insulin`
- Location: `Zone 3`
- Submit.

**Or via curl (backup / faster):**
```powershell
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -H "x-device-id: demo-ramesh" -d '{\"name\":\"Ramesh\",\"category\":\"Medical\",\"message\":\"my grandfather is unconscious and needs insulin\",\"location\":\"Zone 3\"}'
```

**Point out (switch to Command Center, tab 1):**
- A new row appears in the live requests table within ~5s.
- It is flagged **CRITICAL** — narrate: *"the word 'unconscious' tripped the triage instantly, offline, at the pod — severity 9."*
- It was routed to the **Hospital** guild automatically from the text.

**The line that scores:** *"No human dispatcher classified that. The pod did it in one heartbeat, in any of 11 languages — here it's English, but the same keyword list carries Hindi, Telugu, Tamil, Bengali and more."*

---

### Scene 2 — Predictive Failover (1:00) — *the showstopper*

**Narrate:** "Now the disaster. Watch what happens when I physically kill the satellite — I'm stopping the real container."

**Do:** In the Command Center **Network page**, click **"Fail Satellite."**
**Or via curl:**
```powershell
curl.exe -X POST http://localhost:9400/api/infra/satellite/fail
```

**Wait 6–8 seconds.** Then:
- The topology shows **SATELLITE → down**.
- Pods that were on satellite have **rerouted to cellular** — narrate this as it happens.

**Submit another SOS during the outage** (proves nothing is lost):
```powershell
curl.exe -X POST http://localhost:8002/api/requests -H "Content-Type: application/json" -H "x-device-id: demo-anita" -d '{\"name\":\"Anita\",\"category\":\"Rescue\",\"message\":\"two people trapped near the old bridge\",\"location\":\"Zone 2\"}'
```
- It still reaches the cloud — now stamped as arriving **via a cell tower**, not satellite.

**Optional — show the degraded/ThousandEyes idea explicitly** (rain fade, not a full kill):
```powershell
# 40% packet loss on the satellite = "degraded", not "down"
curl.exe "http://localhost:9100/set?loss=0.4"
```
**Narrate:** *"At 25% loss the link confesses 'degraded' — and pods move traffic to a healthier path *before* it fully dies. That's the ThousandEyes pattern, one rule."*

**Then restore:**
```powershell
curl.exe -X POST http://localhost:9400/api/infra/restore-all
```

---

### Scene 3 — Mesh Relay & Island Mode (1:00) — *the deepest resilience*

**Narrate:** "POD-04 is a riverbank village with **no cell tower of its own**. Let me cut every uplink and show you it still gets a message out."

**Do — kill both towers and satellite (full blackout for POD-04):**
```powershell
curl.exe -X POST http://localhost:9400/api/infra/satellite/fail
curl.exe -X POST http://localhost:9400/api/infra/cellular/fail
```

**Wait 6–8 seconds**, then submit an SOS at **POD-04**:
```powershell
curl.exe -X POST http://localhost:8004/api/requests -H "Content-Type: application/json" -H "x-device-id: demo-flood" -d '{\"name\":\"Village family\",\"category\":\"Rescue\",\"message\":\"water is rising, family stranded on the roof, need a boat\",\"location\":\"Riverbank\"}'
```

**Two things to show:**
1. **Mesh relay:** POD-04 forwards through a neighbor pod that still has a path. On the dashboard, POD-04's entry shows a **relay trail** (relayed via a neighbor). Narrate: *"POD-04 couldn't reach the cloud, so it shouted over the pod-to-pod mesh — Cisco URWB in production — to a neighbor who could. The request carries its full relay trail."*
2. **If truly islanded** (no neighbor either), check the queue is holding:
```powershell
curl.exe http://localhost:8004/api/queue
```
Narrate: *"Zero connectivity is not an error here — it's a supported state. The SOS sits safely on the pod's disk. Delayed, never lost."*

**The restore — "the convoy":**
```powershell
curl.exe -X POST http://localhost:9400/api/infra/restore-all
```
**Wait ~8s**, re-check the queue — it drains to empty:
```powershell
curl.exe http://localhost:8004/api/queue
```
Narrate: *"The moment a path returns, the whole backlog flushes in one batched transmission — one latency payment for the entire queue."*

---

### Scene 4 — Signed Alerts & The Shield (0:45) — *the security story*

**Narrate:** "The Command Center can broadcast an evacuation order. Every order is cryptographically signed — Ed25519 — and every pod verifies it, even offline."

**Do — send a real signed alert** (Command Center Alerts page → type & send, **or** curl):
```powershell
curl.exe -X POST http://localhost:9400/api/broadcast -H "Content-Type: application/json" -d '{\"hazard\":\"flood\",\"message\":\"EVACUATION: move to high ground immediately\"}'
```
- Show it appear in the **Alerts log**, delivered + verified at pods.

**Now the attack — inject a FORGED alert** (the tame assassin):
```powershell
py -3 integrations\inject_forged_alert.py http://localhost:8001
```
**Expected output:** `Pod rejected the decoy alert: HTTP 401 …`

**Narrate:** *"A forged 'move to the riverbank NOW' order — the most dangerous lie in a disaster — is rejected at the pod with a 401, even with zero connectivity, and logged as a security event that climbs back to the EOC. Transport security and message security are independent layers: a compromised pipe still cannot forge an evacuation order."*

Show the **Shield / security events** on the dashboard.

---

### Scene 5 — Coordinator Resolution — Closing the Loop (0:30)

**Narrate:** "The other half of the system: the responders. Data doesn't just flow down — it flows back."

**Do:** Open **Hospital-1 coordinator (tab 4, http://localhost:8101)**.
- Ramesh's insulin request from Scene 1 is in its inbox (routed there by text).
- Click **Acknowledge**, then **Resolve** (add a note like "ambulance dispatched").

**Switch to Command Center:**
- That request now shows **resolved** on the delivery board.

**Narrate:** *"The coordinator resolved it in the field; that closure flowed all the way back to the operator's screen. The loop is closed — every SOS is tracked from cry to resolution."*

*(Optional, advanced — shortage-aware routing: in the coordinator UI, set a resource like medicine kits to 0. Narrate that the cloud will now steer new hospital requests to Hospital-2 automatically. Only do this if you have spare time.)*

---

### Scene 6 — Sensor-Driven Early Warning (OPTIONAL, 0:30)

*Only if under time. Shows the Meraki MT sensor story.*

**Do — spike POD-04's water sensor past the flood threshold:**
```powershell
curl.exe -X POST http://localhost:9300/api/sensors/spike/POD-04/water_level -H "Content-Type: application/json" -d '{\"ticks\":6,\"step\":20}'
```
**Wait ~20–30s** (the sensor ramps over several 4-second ticks).

**Narrate:** *"A Meraki MT12 water sensor at POD-04 crosses its flood threshold. The pod fires an automated EARLY-WARNING, the cloud answers with a *signed* broadcast to every pod, and responder phones buzz over Webex — all without a human in the loop."*

Show the early-warning entry + the new signed alert in the Alerts log.

**Press the MT30 panic button (bonus):**
```powershell
curl.exe -X POST http://localhost:9300/api/sensors/press/POD-03
```
Narrate: *"A physical Meraki MT30 button — one press, instant severity-9 SOS, no words needed."*

---

### Scene 7 — Close (0:15)

**Narrate:** *"Break the network — watch it heal. SANJEEVANI keeps the disconnected connected when it matters most. Everything you saw is real, running code — the containers are the rehearsal for Cisco hardware: IR1800, URWB, Meraki MT, and Webex. Thank you."*

End on the Command Center dashboard, all green again after restore.

---

## 4. The Master "Chaos" Sequence (if you want ONE continuous take)

Paste these into the second terminal, narrating between each. This is the whole story in order:

```powershell
# 1. Normal SOS
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -H "x-device-id: d1" -d '{\"name\":\"Ramesh\",\"category\":\"Medical\",\"message\":\"grandfather unconscious needs insulin\",\"location\":\"Zone 3\"}'

# 2. Kill satellite -> watch cellular failover (wait 8s)
curl.exe -X POST http://localhost:9400/api/infra/satellite/fail

# 3. SOS during outage still lands (via cellular)
curl.exe -X POST http://localhost:8002/api/requests -H "Content-Type: application/json" -H "x-device-id: d2" -d '{\"name\":\"Anita\",\"category\":\"Rescue\",\"message\":\"two trapped near old bridge\",\"location\":\"Zone 2\"}'

# 4. Full blackout -> mesh / island (wait 8s)
curl.exe -X POST http://localhost:9400/api/infra/cellular/fail
curl.exe -X POST http://localhost:8004/api/requests -H "Content-Type: application/json" -H "x-device-id: d3" -d '{\"name\":\"Family\",\"category\":\"Rescue\",\"message\":\"water rising, stranded on roof, need boat\",\"location\":\"Riverbank\"}'
curl.exe http://localhost:8004/api/queue

# 5. Restore -> convoy flush (wait 8s)
curl.exe -X POST http://localhost:9400/api/infra/restore-all
curl.exe http://localhost:8004/api/queue

# 6. Signed alert + forgery
curl.exe -X POST http://localhost:9400/api/broadcast -H "Content-Type: application/json" -d '{\"hazard\":\"flood\",\"message\":\"EVACUATION: move to high ground\"}'
py -3 integrations\inject_forged_alert.py http://localhost:8001
```

---

## 5. Verification Evidence (record this ONCE, before the demo, as proof)

FAQ Q10 rewards a real working backend. Capture terminal output of the integration suites passing — a strong slide/appendix or a 10-second clip:

```powershell
# full resilience suite: signed alerts, forgery, hazard->broadcast, rain fade, rate limit, batch sync
py -3 integrations\integration_test.py

# AI triage chain (against a mock model, no 2GB download)
py -3 integrations\ai_triage_test.py

# crowd surge realism (rate limiting under load)
py -3 integrations\simulate_crowd.py 30 http://localhost:8001
```
Screenshot the `RESULT: N/N checks passed` lines.

---

## 6. Technology Stack (say this verbatim for FAQ Q19)

> "**Backend:** Node.js + Express, 14 containerized microservices. **Data:** MongoDB with an in-memory fallback. **AI:** a local Ollama LLM (qwen2.5) for triage — runs fully offline. **Frontend:** React (Vite) citizen portals + a vanilla-JS EOC dashboard with Socket.io realtime. **Security:** Ed25519 signing/verification. **Orchestration:** Docker Compose. **Cisco:** real Meraki Dashboard API + Catalyst 8000v RESTCONF + Webex bot integrations; link physics and the MT sensor fleet are simulated with the same data contract as the real hardware webhook."

---

## 7. Troubleshooting (keep this handy while recording)

| Symptom | Fix |
|---|---|
| Dashboard blank / no data | wait 10s after `up`; hard-refresh (Ctrl+F5); `docker compose ps` to confirm cloud-api is Up |
| Fail/restore seems to do nothing | wait 8s (health cache + 5s poll); confirm with `curl.exe http://localhost:9300/api/infra/status` |
| `curl.exe` JSON quoting errors | the `\"` escaping above is correct for PowerShell; don't remove the backslashes |
| Forged-alert script says "accepted" | pod hasn't enrolled the pubkey yet — wait 15s after startup and retry |
| A pod shows offline | `docker compose restart pod-04` (or the relevant one) |
| Ports already in use | `docker compose down` then `docker compose up -d` |
| Reset all data mid-demo | `docker compose restart cloud-api` (clears in-memory request list) |
| Full clean restart | `docker compose down; docker compose up -d --build` |

**Golden rule on camera:** after every fail/restore command, pause and *say what you expect to happen* before it appears. The 5–8s poll interval becomes suspense instead of dead air.

---

## 8. Case Coverage Checklist (tick before you submit)

- [ ] Normal SOS → triaged critical → routed to hospital by text
- [ ] Satellite fail → cellular failover, SOS still lands
- [ ] Degraded link (rain fade) → predictive failover before death
- [ ] Full blackout → mesh relay through a neighbor (relay trail visible)
- [ ] True island → queue holds on disk → convoy flush on restore
- [ ] Signed evacuation broadcast → verified at pods
- [ ] Forged alert → rejected 401 → security event to EOC
- [ ] Coordinator acknowledge → resolve → loop closes on dashboard
- [ ] (Optional) MT sensor spike → auto early-warning → signed broadcast
- [ ] (Optional) MT30 button press → instant severity-9 SOS
- [ ] Integration suites screenshot captured as evidence
- [ ] Video is 720p, ≤ 2 GB, ≤ 5 min
- [ ] Repo private + admin rights to bobybhadouria143 + README + ADR + diagrams
