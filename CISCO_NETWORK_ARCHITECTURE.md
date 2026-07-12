# SANJEEVANI — Production Cisco Network Architecture

*Maps the POC (Docker containers simulating links) onto real Cisco hardware. Every element below corresponds to something already working in the codebase — the hardware doesn't replace the software story, it embodies it.*

---

## 1. Product Selection — Scored Against the Problem Statement

The problem statement needs exactly ten capabilities. Each selected product earns its place against one of them; everything else from the catalog is rejected (Section 6) to keep the design credible.

| # | Requirement | Selected Cisco Product | Where it already exists in code |
|---|---|---|---|
| 1 | Citizens connect with zero surviving infrastructure | **Catalyst IW9167E** heavy-duty AP (IP67) — open captive-portal Wi-Fi bubble | Pod React UI, `ciscoSimulation.localWifi` |
| 2 | Pod runs its own brain with no server rack | **Catalyst IR1800** rugged router + **Cisco IOx** running the pod-agent Node.js container + local queue on flash | `pod-agent/server.js`, `ciscoSimulation.podEdge` |
| 3 | Multi-path WAN failover (the ladder) | **IR1800 WAN ethernet → Starlink LEO**, **5G/LTE pluggable module**, optional **P-LTE-450** private LTE | `connectivityManager.calculateMode()` |
| 4 | Pod-to-pod mesh when both WANs die | **Catalyst IW9165E with URWB** (directional, km-range, fiber-like) | `gossipRouter.js`, `/api/mesh/inbox` |
| 5 | A lifeline when even the mesh dies | **IXM-LPWA LoRaWAN gateway** — 10–15 km sub-GHz thin pipe | *New tier* — extends island mode (see 4.5) |
| 6 | Power + connect everything in the pod | **Catalyst IE3400** industrial PoE switch (fanless, one battery powers all antennas) | implicit in pod topology |
| 7 | Sensor-driven early warning | **Meraki MT10/MT12/MT14** sensors + **MT30** button | `hazardPackService.js`, `sensor-simulator`, `/api/sensors/button` |
| 8 | Tamper-proof alerting + responder notification | App-layer **Ed25519** (ours) over **SD-WAN IPsec** + **Webex** bot | `verifyAlert()`, `webexNotifier.js` |
| 9 | EOC visibility, control, pre-failure warning | **Catalyst SD-WAN (vManage)** + **ThousandEyes IOx agents** + **IoT Operations Dashboard** / **Meraki Dashboard** | `command-center`, `link-node /health` degraded signal, `simulation-controller` topology |
| 10 | Field humans must still talk in island mode | **IP Phone 8800** + **SRST** on the IR1800 (router becomes the local exchange) | *New* — complements coordinator guild halls |

**Strong optional additions** (include if asked "what else"):
- **Meraki MV72X** rugged camera — edge AI, on-camera storage, sends a 50 KB snapshot instead of a stream: the physical embodiment of our store-and-forward law.
- **Catalyst Micro switches** — backpack pods extending Wi-Fi into collapsed structures.
- **Cisco Cyber Vision** on the IE3400 — OT security for the sensor fleet.
- **Secure Equipment Access (SEA)** — zero-trust remote config of pod routers without VPN.

**EOC (the Keep):** 2× **UCS C220** rack servers (cloud-api, MongoDB, Ollama, command-center — our whole compose file), behind a **Secure Firewall 1150**, on a **Catalyst 9300** access switch. Cloud-hosted SD-WAN controllers and Webex Control Hub. Deliberately small — the EOC is a tent, not a data center.

---

## 2. The Architecture — Five Planes

```
════════════════════════════ CONTROL & OBSERVABILITY PLANE ═════════════════════════════
  SD-WAN Manager (vManage) · ThousandEyes dashboard · IoT Ops Dashboard · Meraki
  Dashboard · Webex Control Hub          (all cloud-hosted, reachable from EOC)
═════════════════════════════════════════════════════════════════════════════════════════

                       ┌─────────────────── EOC / COMMAND CENTER ───────────────────┐
                       │   Secure Firewall 1150 ── Catalyst 9300                    │
                       │   UCS C220 ×2:  cloud-api · MongoDB · Ollama · dashboard   │
                       │   IP Phone 8800 (SRST-registered)                          │
                       └───────┬─────────────────┬──────────────────┬───────────────┘
                               │                 │                  │
                     SD-WAN IPsec tunnels  SD-WAN IPsec      LoRaWAN network server
                               │                 │                  │
        ╔══ TIER 1 ═══════════╗│╔═ TIER 2 ══════╗│╔══ TIER 4 ══════╗│
        ║ Starlink / LEO      ║│║ Commercial 5G ║│║ LoRa thin pipe ║│
        ║ ~80ms, ~100 Mbps    ║│║ + P-LTE-450   ║│║ bytes, 15 km   ║│
        ╚══════════╦══════════╝│╚═══════╦═══════╝│╚═══════╦════════╝│
                   │           │        │        │        │         │
   ┌───────────────┴───────────┴────────┴────────┴────────┴─────────┴──┐
   │                        FIELD POD (×10)                            │
   │                                                                   │
   │   [Starlink dish]   [5G antenna]      [LoRa antenna]              │
   │        └──────┬──────────┘                  │                     │
   │        ┌──────▼──────────────┐       ┌──────▼──────┐              │
   │        │  CATALYST IR1800    │◄──────┤  IXM-LPWA   │              │
   │        │  ─ SD-WAN edge      │       └─────────────┘              │
   │        │  ─ IOx: pod-agent   │                                    │
   │        │    container +      │       TIER 3 ══ URWB MESH ══╗      │
   │        │    queue.json flash │      ┌─────────────┐        ║      │
   │        │  ─ ThousandEyes agt │◄─────┤  IW9165E    │◄═══════╬══► to neighbor pods
   │        │  ─ SRST voice       │      │  (URWB)     │  <10ms/hop    │
   │        └──────┬──────────────┘      └─────────────┘        ║      │
   │        ┌──────▼──────────────┐                                    │
   │        │  IE3400 PoE SWITCH  │──power+data──┬──────┬──────┐       │
   │        └──────┬──────────────┘              │      │      │       │
   │        ┌──────▼──────┐  ┌──────────┐  ┌─────▼──┐ ┌─▼────┐ ┌▼────┐ │
   │        │  IW9167E    │  │ MT10/12/ │  │ MT30   │ │MV72X │ │8800 │ │
   │        │  citizen    │  │ 14 sens. │  │ button │ │camera│ │phone│ │
   │        │  Wi-Fi      │  └──────────┘  └────────┘ └──────┘ └─────┘ │
   │        └─────────────┘                                            │
   │     📱 victims' phones join the open captive portal               │
   └───────────────────────────────────────────────────────────────────┘

   GUILD HALLS (hospital / fire / shelter / workforce / flood — ×9):
   same design, lighter: IR1101 router + IE3300 + IW9167E + 8800 phone + MT sensors
```

**The five planes:**

1. **Access plane** — IW9167E captive portal (open SSID by design: a victim must connect with zero credentials), MT sensors, MT30 buttons, MV72X snapshots.
2. **Compute plane** — IR1800/IOx runs the pod-agent exactly as it exists today; `queue.json` lives on router flash. The pod *is* the router.
3. **Transport plane** — the four-tier ladder (Section 3).
4. **Control plane** — SD-WAN policy = our `calculateMode()` in silicon; RESTCONF zero-touch provisioning (already proven live by `integrations/catalyst_restconf.py` against a real Catalyst 8000v); IoT Ops Dashboard + SEA for fleet management.
5. **Observability & security plane** — ThousandEyes agents *inside* the IR1800 via IOx; SD-WAN IPsec below, our Ed25519 alert signing above (defense in depth: even a compromised transport can't forge an evacuation order); Umbrella DNS filtering on the captive portal; Cyber Vision watching the OT sensors.

---

## 3. The Transport Ladder — Code ↔ Hardware

| Tier | POC today | Production hardware | Trigger to fall to next tier |
|---|---|---|---|
| **1 Satellite** | `link-node :9100` (80 ms, loss dice) | Starlink/LEO on IR1800 WAN1 | ThousandEyes path test: loss ≥ 25% or dish offline → SD-WAN demotes color |
| **2 Cellular** | `link-node :9201/:9202` (30 ms) | 5G module on IR1800; **P-LTE-450** where commercial towers are dead (450 MHz = massive range + wall penetration, private emergency spectrum) | tower unreachable / SIM registration lost |
| **3 Mesh** | `gossipRouter` + `/api/mesh/inbox` | **IW9165E URWB** directional bridges, pod→pod up to ~5 km; URWB's make-before-break ≈ our BGP-path-vector gossip in hardware | no URWB neighbor with an upstream path |
| **4 LoRa thin pipe** | *(new — not in POC)* | **IXM-LPWA**: ~242-byte payloads, 10–15 km through rubble | n/a — always on, in parallel |
| **5 Island** | `queue.json` + syncWorker retry | IOx flash storage + MV72X on-camera recording + SRST local voice | — |

**Tier 4 is the one genuinely new capability the hardware adds** to the software story: even a fully islanded pod whispers a heartbeat — `POD-3: Q-45, CRIT-2` (pod id, queue depth, critical count) — every 30 s over LoRa. The EOC dashboard shows *"island, but alive, 45 queued, 2 critical"* instead of a grey square. A compressed critical SOS (id + category + severity + GPS ≈ 200 bytes) can even trickle out one per uplink. This upgrades island mode from "dark but safe" to "dark but heard."

---

## 4. Communication Flows — All the Possibilities

**A. Normal operations.** Victim's phone → IW9167E captive portal → IE3400 → IR1800, where the IOx pod-agent triages (11 languages, offline) and queues to flash → SD-WAN IPsec tunnel over Starlink → Secure Firewall → cloud-api on UCS → AI triage (Ollama on UCS) → coordinator delivery → Webex push to responder phones. *Same nine steps as the demo; only the containers became metal.*

**B. Degradation (predictive failover).** Rain fade hits the dish. The ThousandEyes agent inside the IR1800 sees loss climbing on the satellite path *before* users feel it and reports path quality; SD-WAN application-aware routing demotes the satellite color and pins SOS-class traffic to cellular. Telemetry class may stay on the degraded satellite (it can afford loss). This is `DEGRADED_LOSS = 0.25` and the "degraded-still-beats-island" tail of `calculateMode()`, executed in silicon. **QoS note:** SOS traffic is DSCP-marked EF at the IR1800; the IE3400 and SD-WAN honor it — the production form of our priority lanes and batch sync.

**C. Total WAN loss → mesh.** Flood takes the dish and the towers. The IW9165E URWB radios already hold formed links to neighbor pods; the IR1800's route to the EOC now points across the mesh to POD-05, whose own SD-WAN tunnel over its surviving tower carries both pods' traffic. Our `relayTrail` bookkeeping remains at the application layer, giving the EOC the full provenance of every relayed SOS.

**D. True island + thin pipe.** POD-06 (no mesh neighbor, per our topology). Everything queues on flash — Law 1, unchanged. The IXM-LPWA whispers the heartbeat to the EOC's LoRaWAN network server 12 km away. The MV72X records locally and queues 50 KB AI-detected snapshots ("person detected, 14:32") behind the SOS class. The medic picks up the 8800 phone and dials the shelter coordinator — **SRST** on the IR1800 switches the call locally over the pod's own network. The pod is cut off and still functioning as a tiny civilization.

**E. Restoration.** Tower comes back. ThousandEyes confirms the path, SD-WAN restores the color, the pod-agent's health-change listener fires, and the syncWorker drains the queue — batched (`forward-batch`) exactly as trial [7] of `integration_test.py` proves today. Delayed, never lost.

**F. Signed alert broadcast (downstream).** EOC issues an evacuation order → cloud-api signs (Ed25519, seq, scope) → fan-out down every SD-WAN tunnel, across URWB to meshed pods, and — as a 180-byte compressed form — over LoRa to islanded pods. Every pod verifies with its cached public key **regardless of which pipe delivered it**. A forged alert injected on any radio layer still dies at the pod with a 401 + SECURITY event. Transport security (IPsec) and message security (Ed25519) are independent layers — that's the pitch line.

**G. Management plane.** vManage pushes path policy; IoT Ops Dashboard monitors the IR fleet; SEA gives engineers zero-trust access to reconfigure a pod router remotely; Meraki Dashboard manages sensors/cameras; RESTCONF (proven in `catalyst_restconf.py`) provisions VLANs/QoS zero-touch — the citizens' segment is stamped by code, not console cables.

---

## 5. Pitch Framing — Three Tiers, One Sentence Each

> **Tier 1 — The Edge:** IW9167E gives every victim a Wi-Fi bubble that needs nothing from the city.
> **Tier 2 — The Mesh:** URWB and LoRa guarantee that pods survive *together* — kilometers of invisible fiber and a sub-GHz whisper that penetrates rubble.
> **Tier 3 — The Brain:** IR1800 + IOx runs our actual Node.js triage at the edge, SD-WAN guarantees the path, ThousandEyes sees the failure before it happens.

And the closing line: *"Everything you just watched in Docker is this rack of hardware. The containers were never the product — they were the rehearsal."*

---

## 6. Rejected — and Why (say this out loud; it builds credibility)

| Product | Why not |
|---|---|
| Nexus 9000/8000, Silicon One G300 | Hyperscale data-center silicon. Our EOC is a tent with two UCS boxes, not a leaf-spine fabric. |
| Catalyst 9500/9600 core, 9800 WLC | Campus core for thousands of users; a pod has ~6 devices and one AP. |
| HyperFlex / Intersight | Hyperconverged infra assumes a DC ops team; a disaster has none. |
| Crosswork | Telco-scale automation; wrong operator, wrong scale. |
| AppDynamics / Splunk APM | ThousandEyes + our own dashboards cover observability at POC scale. |
| ISE (802.1X identity) | Deliberately rejected at the citizen edge: **victims must connect with zero credentials**. Open captive portal is a feature. (Keep identity for the *management* plane via SEA.) |
| Umbrella full SASE stack | DNS-layer filtering on the portal: yes. Full SSE/CASB: no cloud apps to broker in a disaster zone. |

---

## 7. Honesty Ledger (if a judge asks "what's real?")

- **Real today:** the entire application layer (14 services), real Meraki Dashboard API telemetry (`meraki_live.py`), real Catalyst 8000v RESTCONF configuration (`catalyst_restconf.py`), real Webex bot notifications, real Ed25519 offline verification, real failover behavior against simulated links.
- **Simulated today:** the links themselves (link-node containers with latency + loss physics), the MT sensor fleet (sensor-simulator, same data contract as the real webhook), infrastructure failure (simulation-controller stopping containers).
- **Hardware-only (this document):** URWB radios, LoRa thin pipe, SRST voice, MV72X snapshots, SD-WAN/ThousandEyes replacing the simulated link layer. Each has a named code seam where it plugs in.
