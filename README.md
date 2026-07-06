# SANJEEVANI Docker Pod Network

SANJEEVANI is a Docker simulation of a disaster SOS network with ten local pods, shared satellite/cellular middlemen, mesh relay, and island-mode local caching.

Pods do not post directly to the cloud. A pod must forward through the satellite link-node, a configured cell tower link-node, or a mesh neighbor that still has one of those uplinks. If no path is available, the SOS is stored in that pod's local queue.

## Folder Structure

```text
.
|-- docker-compose.yml
|-- cloud-api/                 # central cloud receiver on port 9000
|-- link-node/                 # shared satellite and celltower service image
|-- simulation-controller/     # global Docker stop/start controller on port 9300
|-- pod-agent/                 # shared pod backend and React/Vite citizen SOS UI
|   |-- client/                # modular React frontend source
|   |-- public/                # legacy static fallback
|   `-- services/              # routing, queue, settings, hazard, triage modules
|-- integrations/              # optional external demo feeders
`-- pod-data/                  # generated runtime state, ignored by git
```

Removed from the active architecture: the old root `control-center`, old `pod-simulator`, nested pod network folder, duplicate pod agents, and relay folder.

## Run

```powershell
docker compose up -d --build
```

Open:

```text
POD-01 UI:                 http://localhost:8001
POD-02 UI:                 http://localhost:8002
...
POD-10 UI:                 http://localhost:8010
Cloud API health:          http://localhost:9000/api/health
Satellite health:          http://localhost:9100/health
CELLTOWER-1 health:        http://localhost:9201/health
CELLTOWER-2 health:        http://localhost:9202/health
Simulation controller UI:  http://localhost:9300
Simulation controller API: http://localhost:9300/api/infra/status
```

## Active Services

```text
cloud-api              stores SOS requests received through link-nodes
satellite              satellite middleman forwarding to cloud-api
celltower-1            cellular middleman forwarding to cloud-api
celltower-2            cellular middleman forwarding to cloud-api
simulation-controller  stops/starts satellite and cell tower Docker containers
pod-01..pod-10         local pod SOS app, routing engine, queue, and mesh relay
```

## 10-Pod Topology

```text
POD-01: CELLTOWER-1, neighbors POD-02
POD-02: CELLTOWER-1, neighbors POD-01/POD-03
POD-03: CELLTOWER-1, neighbors POD-02
POD-04: no cell tower, neighbors POD-05
POD-05: CELLTOWER-1, neighbors POD-04
POD-06: no cell tower, no mesh neighbors
POD-07: CELLTOWER-2, neighbors POD-09
POD-08: CELLTOWER-2, no mesh neighbors
POD-09: no cell tower, neighbors POD-10
POD-10: no cell tower, neighbors POD-09
```

CELLTOWER-1 covers POD-01, POD-02, POD-03, and POD-05. CELLTOWER-2 covers POD-07 and POD-08.

Every pod has satellite configured. Local pod controls can disable satellite/cellular/mesh for only that pod. Global infrastructure controls fail or restore the shared satellite/celltower services for all pods.

## Queue And Routing Order

Every citizen SOS is first accepted by that pod's own backend and stored in that pod's persistent queue at `pod-data/pod-XX/queue.json`. The pod sync worker wakes immediately after submission and also runs every 5 seconds.

1. If satellite is enabled locally and globally up, the queued SOS is sent to `satellite -> cloud-api`.
2. Otherwise, if cellular is enabled locally and a configured tower is up, it is sent to `celltower-* -> cloud-api`.
3. Otherwise, if mesh is enabled and a surrounding pod has a direct cloud route, it is relayed to that neighbor. The surrounding pod adds it to its own queue and its sync worker forwards it.
4. Otherwise, the SOS remains cached in the local pod queue until satellite, cellular, or mesh becomes available again.

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

Fail satellite globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/satellite/fail -H "Content-Type: application/json" -d "{}"
```

Restore satellite globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/satellite/restore -H "Content-Type: application/json" -d "{}"
```

Fail CELLTOWER-1 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-1/fail -H "Content-Type: application/json" -d "{}"
```

Restore CELLTOWER-1 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-1/restore -H "Content-Type: application/json" -d "{}"
```

Fail CELLTOWER-2 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-2/fail -H "Content-Type: application/json" -d "{}"
```

Restore CELLTOWER-2 globally through the simulation controller:

```powershell
curl.exe -X POST http://localhost:9300/api/infra/celltower-2/restore -H "Content-Type: application/json" -d "{}"
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

## Stop And Reset

Stop containers:

```powershell
docker compose down
```

Reset generated queues, pod display names, and local path settings:

```powershell
Remove-Item -Recurse -Force .\pod-data
docker compose up -d --build
```
