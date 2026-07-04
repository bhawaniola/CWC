# SANJEEVANI Pod Network

SANJEEVANI is a Docker-based simulation of a self-healing disaster communication pod network. Each pod behaves like a local emergency network node: it serves a React SOS frontend for victims, accepts emergency requests, triages them, sends them to cloud when possible, relays through a neighboring pod when needed, and stores requests locally in island mode.

The architecture follows the project PDF:

- Tier 2 - Cloud mode: satellite or cellular is available, so requests go straight to cloud.
- Tier 1 - Mesh relay mode: this pod has no direct uplink, but Cisco URWB-style mesh can reach a neighbor pod that still has cloud.
- Tier 0 - Island mode: no usable outside path exists, so the pod keeps local service alive and syncs later.

## Pod Abilities

- Local frontend on the pod's mapped host port.
- Local Express API for emergency requests.
- Manager-only simulation controls through the pod simulator console.
- Editable pod display name persisted in each pod's local data volume.
- Persistent JSON queue under `./pod-data/pod-XX`.
- Satellite-first, cellular-second, mesh-third path selection.
- One-hop mesh relay only when a neighbor pod has direct cloud mode.
- Island mode when no cloud-reaching path exists.
- Auto-sync worker every 5 seconds after connectivity returns.
- Manual failure and restoration APIs for satellite, cellular, and mesh.
- Simple explainable triage with severity, priority, and reason.

## Cisco Product Mapping

| SANJEEVANI capability | Cisco simulation mapping |
| --- | --- |
| Citizen Wi-Fi and captive portal | Meraki MR46 |
| Local API, queue, edge logic | Cisco Catalyst IR1800 with IOx |
| SD-WAN failover and QoS | Meraki MX67C |
| LTE/5G backup | Meraki MG51 |
| Pod-to-pod relay | Cisco URWB IW9167E |
| Flood, panic, and environment sensing | Meraki MT sensors |

## Project Structure

```text
sanjeevani-pod-network/
  docker-compose.yml
  cloud-api/
    Dockerfile
    package.json
    server.js
  pod-agent/
    Dockerfile
    package.json
    server.js
    vite.config.js
    client/
      src/
        api/
        components/
        constants/
        pages/
        styles/
        utils/
    services/
      connectivityManager.js
      localQueue.js
      syncWorker.js
      triageService.js
    public/
      index.html
      style.css
      app.js
  pod-simulator/
    Dockerfile
    package.json
    server.js
    vite.config.js
    client/
      src/
        api/
        components/
        constants/
        pages/
        styles/
        utils/
    public/
      index.html
      style.css
      app.js
  README.md
```

## Run

From this directory:

```bash
docker compose up --build
```

Open the pod frontends:

| Pod | URL |
| --- | --- |
| POD-01 | http://localhost:8001 |
| POD-02 | http://localhost:8002 |
| POD-03 | http://localhost:8003 |
| POD-04 | http://localhost:8004 |
| POD-05 | http://localhost:8005 |
| POD-06 | http://localhost:8006 |
| POD-07 | http://localhost:8007 |
| POD-08 | http://localhost:8008 |
| POD-09 | http://localhost:8009 |
| POD-10 | http://localhost:8010 |

For the Docker simulation, opening `http://localhost:8004` means you are connected to `POD-04` through that pod's local `SANJEEVANI-HELP` Wi-Fi simulation. Inside Docker, pods communicate using service names such as `http://pod-02:8000`, never host `localhost`.

Open the simulator console:

```text
http://localhost:8100
```

Use the simulator console to select multiple pods, edit pod display names, fail or restore satellite/cellular/mesh paths, force island mode, and manually sync queues. These controls are intentionally not present on the victim-facing pod UI.

Cloud API:

```text
http://localhost:9000/api/requests
http://localhost:9000/api/health
```

## API Quick Reference

Every pod exposes:

- `GET /api/pod/status`
- `GET /api/network/status`
- `POST /api/requests`
- `POST /api/relay`

Manager-only pod APIs require `x-manager-token: sanjeevani-manager-demo-key`:

- `POST /api/pod/name`
- `GET /api/queue`
- `POST /api/sync`
- `POST /api/network/:path/:state`

Edit a pod display name:

```powershell
curl.exe -X POST http://localhost:8001/api/pod/name -H "Content-Type: application/json" -H "x-manager-token: sanjeevani-manager-demo-key" -d "{\"podName\":\"Main Relief Camp Pod\"}"
```

The simulator exposes:

- `GET http://localhost:8100/api/pods`
- `POST http://localhost:8100/api/pods/network`
- `POST http://localhost:8100/api/pods/island`
- `POST http://localhost:8100/api/pods/restore-all`

Valid network paths:

- `satellite`
- `cellular`
- `mesh`

Valid network states:

- `up`
- `down`

## Test Payload

Use `curl.exe` on Windows PowerShell:

```powershell
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Ramesh Kumar\",\"age\":68,\"phone\":\"+91 9876543210\",\"category\":\"Medical\",\"message\":\"My grandfather needs insulin and cannot walk\",\"location\":\"Kothapalli Zone 3\"}"
```

Expected triage:

- Severity: `9`
- Priority: `critical`
- Reason includes `insulin`

## Testing Scenarios

### Scenario 1: Satellite Working

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/cellular/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Ramesh Kumar\",\"age\":68,\"phone\":\"+91 9876543210\",\"category\":\"Medical\",\"message\":\"My grandfather needs insulin and cannot walk\",\"location\":\"Kothapalli Zone 3\"}"
```

Expected: request synced to cloud using satellite.

Check cloud:

```powershell
curl.exe http://localhost:9000/api/requests
```

### Scenario 2: Satellite Down, Cellular Working

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/cellular/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Anita\",\"age\":42,\"phone\":\"+91 9000000001\",\"category\":\"Water\",\"message\":\"We need clean water and medicine\",\"location\":\"Shelter A\"}"
```

Expected: request synced to cloud using cellular.

### Scenario 3: Satellite Down, Cellular Down, Mesh Relay Working

Keep `POD-02` satellite up, then disable direct uplinks on `POD-01`:

```powershell
curl.exe -X POST http://localhost:8002/api/network/satellite/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8002/api/network/cellular/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/cellular/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/mesh/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Kiran\",\"age\":31,\"phone\":\"+91 9000000002\",\"category\":\"Rescue\",\"message\":\"Two people are trapped near the old bridge\",\"location\":\"Bridge Road\"}"
```

Expected: `POD-01` relays the request through `POD-02`.

### Scenario 4: Island Mode

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/cellular/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/mesh/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Meena\",\"age\":55,\"phone\":\"+91 9000000003\",\"category\":\"Shelter\",\"message\":\"Family needs shelter for the night\",\"location\":\"School Gate\"}"
curl.exe http://localhost:8001/api/queue -H "x-manager-token: sanjeevani-manager-demo-key"
```

Expected: request cached locally. `GET /api/queue` shows the request.

### Scenario 5: Auto Sync After Reconnect

```powershell
curl.exe -X POST http://localhost:8001/api/network/cellular/up -H "x-manager-token: sanjeevani-manager-demo-key"
```

Wait 5 seconds, then check:

```powershell
curl.exe http://localhost:8001/api/queue -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe http://localhost:9000/api/requests
```

Expected: local queue becomes empty and the cloud API receives the cached request.

### Scenario 6: Mesh Exists But No Neighbor Has Cloud

`POD-01` neighbors are `POD-02` and `POD-03`. Disable direct uplinks on all three while keeping mesh up on `POD-01`:

```powershell
curl.exe -X POST http://localhost:8001/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/cellular/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/network/mesh/up -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8002/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8002/api/network/cellular/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8003/api/network/satellite/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8003/api/network/cellular/down -H "x-manager-token: sanjeevani-manager-demo-key"
curl.exe -X POST http://localhost:8001/api/requests -H "Content-Type: application/json" -d "{\"name\":\"Dev\",\"age\":24,\"phone\":\"+91 9000000004\",\"category\":\"Food\",\"message\":\"Need food packets for 30 people\",\"location\":\"Community Hall\"}"
```

Expected: `POD-01` enters island mode because mesh has no cloud-reaching neighbor.

## Reset Local Pod State

Stop the stack, delete `./pod-data`, then start again:

```bash
docker compose down
rm -rf pod-data
docker compose up --build
```

On Windows PowerShell:

```powershell
docker compose down
Remove-Item -Recurse -Force .\pod-data
docker compose up --build
```

## Demo Flow

1. Open `http://localhost:8001`.
2. Submit the default insulin request and show cloud sync.
3. Open `http://localhost:8100` and fail satellite on `POD-01` to show cellular takeover.
4. Fail cellular on `POD-01`, keep `POD-02` online, and show mesh relay.
5. Force island mode on `POD-01` and show local queueing.
6. Restore cellular and wait for auto-sync.
7. Open `http://localhost:9000/api/requests` to show all synced requests.
