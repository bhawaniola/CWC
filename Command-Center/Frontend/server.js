const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { io: createBackendSocket } = require("socket.io-client");

const app = express();
const server = http.createServer(app);
const uiIo = new Server(server, {
  cors: {
    origin: "*"
  }
});
const PORT = process.env.PORT || 9400;
const CLOUD_URL = normalizeUrl(process.env.CLOUD_URL || "http://cloud-api:9000");
const CLOUD_SOCKET_URL = normalizeUrl(process.env.CLOUD_SOCKET_URL || CLOUD_URL);
const CONTROLLER_URL = normalizeUrl(
  process.env.SIMULATION_CONTROLLER_URL || "http://simulation-controller:9300"
);
const INFRA_CONTROL_KEY = process.env.INFRA_CONTROL_KEY || "sanjeevani-infra-demo-key";
const CONTROLLER_AUTH_HEADERS = { "x-infra-token": INFRA_CONTROL_KEY };
const POD_URLS = String(process.env.POD_URLS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes("="))
  .map((entry) => {
    const [podId, url] = entry.split("=", 2);
    return { podId, url: normalizeUrl(url) };
  });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
const DIST_DIR = path.join(__dirname, "dist");
const PUBLIC_DIR = path.join(__dirname, "public");
const STATIC_DIR = fs.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR;
app.use(express.static(STATIC_DIR));

let realtimeStatus = {
  backend: CLOUD_SOCKET_URL,
  connected: false,
  lastEventAt: "",
  lastEventType: ""
};

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

async function getJson(url, timeout = 2000) {
  try {
    const response = await axios.get(url, { timeout });
    return response.data;
  } catch (error) {
    return null;
  }
}

function publishRealtime(type, payload = {}) {
  if (payload?.id) {
    console.log(`[command-center][frontend-bridge][${payload.id}] received ${type} from backend`);
  }

  realtimeStatus = {
    ...realtimeStatus,
    lastEventAt: new Date().toISOString(),
    lastEventType: type
  };

  uiIo.emit("command-center:update", {
    type,
    payload,
    generatedAt: realtimeStatus.lastEventAt
  });

  if (payload?.id) {
    console.log(`[command-center][browser-socket][${payload.id}] forwarded ${type} to browser frontend`);
  }
}

function connectBackendRealtime() {
  const backendSocket = createBackendSocket(CLOUD_SOCKET_URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    transports: ["websocket"]
  });

  backendSocket.on("connect", () => {
    realtimeStatus = {
      ...realtimeStatus,
      connected: true,
      socketId: backendSocket.id,
      lastConnectedAt: new Date().toISOString()
    };
    publishRealtime("backend:connected", { backend: CLOUD_SOCKET_URL });
    console.log(`[command-center] realtime socket connected to ${CLOUD_SOCKET_URL}`);
  });

  backendSocket.on("disconnect", (reason) => {
    realtimeStatus = {
      ...realtimeStatus,
      connected: false,
      lastDisconnectReason: reason,
      lastDisconnectedAt: new Date().toISOString()
    };
    publishRealtime("backend:disconnected", { reason });
    console.warn(`[command-center] realtime socket disconnected: ${reason}`);
  });

  backendSocket.on("connect_error", (error) => {
    realtimeStatus = {
      ...realtimeStatus,
      connected: false,
      lastError: error.message,
      lastErrorAt: new Date().toISOString()
    };
  });

  backendSocket.on("cloud:update", (event) => {
    publishRealtime(event.type || "cloud:update", event.payload || event);
  });

  backendSocket.on("cloud:snapshot", (snapshot) => {
    publishRealtime("cloud:snapshot", {
      counts: {
        requests: snapshot.requests?.length || 0,
        alerts: snapshot.alerts?.length || 0,
        coordinatorEvents: snapshot.coordinatorEvents?.length || 0,
        coordinatorDeliveries: snapshot.coordinatorDeliveries?.length || 0
      }
    });
  });

  return backendSocket;
}

async function fetchPods() {
  return Promise.all(
    POD_URLS.map(async ({ podId, url }) => {
      const payload = await getJson(`${url}/api/pod/status`, 1500);
      const data = payload?.data;
      if (!data) {
        return { podId, reachable: false, mode: "offline", activePath: "none" };
      }
      return {
        podId: data.podId || podId,
        podName: data.podName || podId,
        reachable: true,
        mode: data.mode,
        activePath: data.activePath,
        activeCellTower: data.activeCellTower,
        satelliteStatus: data.satelliteStatus,
        cellularStatus: data.cellularStatus,
        queuedRequests: data.queuedRequests || 0,
        hazardAlertCount: data.hazardAlertCount || 0,
        triggeredHazards: data.triggeredHazards || [],
        relayPod: data.relayPod || null
      };
    })
  );
}

function requestTimeMs(request) {
  const value = request.cloudReceivedAt || request.createdAt || request.receivedAt || request.timestamp;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function isLastHour(request) {
  const ms = requestTimeMs(request);
  return ms > 0 && Date.now() - ms <= 60 * 60 * 1000;
}

function isCriticalRequest(request) {
  if (request.isCritical === true || String(request.criticality || "").toLowerCase() === "critical") {
    return true;
  }
  return Number(request.triage?.severity || request.severity || 0) >= 8;
}

// ---- aggregation endpoints (real data fanned out from the cluster) ----

app.get("/api/overview", async (req, res) => {
  const [cloud, requestsPayload, alertsPayload, infraPayload, sensorPayload, pods] = await Promise.all([
    getJson(`${CLOUD_URL}/api/health`),
    getJson(`${CLOUD_URL}/api/requests`),
    getJson(`${CLOUD_URL}/api/alerts`),
    getJson(`${CONTROLLER_URL}/api/infra/status`),
    getJson(`${CLOUD_URL}/api/sensors`),
    fetchPods()
  ]);

  const requests = requestsPayload?.data || [];
  const alerts = alertsPayload?.data || [];
  const infra = infraPayload?.data || {};
  const sensors = sensorPayload?.data || {};
  const deliveriesPayload = await getJson(`${CLOUD_URL}/api/coordinator-deliveries`);
  const coordinatorDeliveries = deliveriesPayload?.data || [];

  const citizenRequests = requests.filter(
    (r) =>
      r.category !== "EARLY-WARNING" &&
      r.category !== "SECURITY" &&
      !String(r.requestKind || "").startsWith("coordinator-") &&
      !r.coordinatorId
  );
  const online = pods.filter((p) => p.reachable && p.mode !== "offline");
  const islandCount = pods.filter((p) => p.mode === "island").length;
  const totalQueued = pods.reduce((sum, p) => sum + (p.queuedRequests || 0), 0);

  const openRequests = citizenRequests.filter(
    (r) => !(Array.isArray(r.resolutions) ? r.resolutions : []).some((item) => item.status === "resolved")
  );
  const recentRequests = openRequests.filter(isLastHour);
  const critical = openRequests.filter(isCriticalRequest).length;
  const criticalLastHour = recentRequests.filter(isCriticalRequest).length;

  res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      cloudUp: Boolean(cloud?.data),
      mode: islandCount > 0 ? "ISLAND MODE" : online.length === pods.length ? "CLOUD MODE" : "MIXED",
      counts: {
        activeRequests: openRequests.length,
        resolvedRequests: citizenRequests.length - openRequests.length,
        activeRequestsLastHour: recentRequests.length,
        critical,
        criticalLastHour,
        podsOnline: online.length,
        podsTotal: pods.length,
        queued: totalQueued,
        queuedCoordinatorDeliveries: coordinatorDeliveries.filter(
          (delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status)
        ).length,
        islandPods: islandCount,
        alerts: alerts.length
      },
      infra,
      pods,
      requests: citizenRequests.slice(0, 12),
      coordinatorDeliveries,
      sensorReadings: sensors.readings || [],
      sensorSummary: sensors.summary || null,
      earlyWarnings: requests.filter((r) => r.category === "EARLY-WARNING").slice(0, 5),
      securityEvents: requests.filter((r) => r.category === "SECURITY").slice(0, 5),
      alerts: alerts.slice(0, 8)
    }
  });
});

app.get("/api/requests", async (req, res) => {
  const payload = await getJson(`${CLOUD_URL}/api/requests`);
  res.json({ success: true, data: payload?.data || [] });
});

app.delete("/api/requests/:id", async (req, res) => {
  try {
    const response = await axios.delete(`${CLOUD_URL}/api/requests/${encodeURIComponent(req.params.id)}`, {
      timeout: 5000
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 502).json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
});

app.get("/api/coordinator-deliveries", async (req, res) => {
  const payload = await getJson(`${CLOUD_URL}/api/coordinator-deliveries`);
  res.json({ success: true, data: payload?.data || [] });
});

app.post("/api/coordinator-deliveries/retry", async (req, res) => {
  try {
    const response = await axios.post(`${CLOUD_URL}/api/coordinator-deliveries/retry`, {}, { timeout: 8000 });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 502).json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
});

app.get("/api/alerts", async (req, res) => {
  const payload = await getJson(`${CLOUD_URL}/api/alerts`);
  res.json({ success: true, data: payload?.data || [] });
});

app.get("/api/sensors", async (req, res) => {
  const payload = await getJson(`${CLOUD_URL}/api/sensors`);
  res.json({
    success: true,
    data: payload?.data || { readings: [], summary: null }
  });
});

app.get("/api/pods", async (req, res) => {
  res.json({ success: true, data: await fetchPods() });
});

app.get("/api/infra", async (req, res) => {
  const payload = await getJson(`${CONTROLLER_URL}/api/infra/status`);
  res.json({ success: true, data: payload?.data || {} });
});

// Network simulation controls -> proxy to the simulation-controller (real
// docker stop/start of satellite / cell tower containers).
app.post("/api/infra/:target/:action", async (req, res) => {
  const { target, action } = req.params;
  const map = {
    satellite: ["satellite"],
    cellular: ["celltower-1", "celltower-2"],
    "celltower-1": ["celltower-1"],
    "celltower-2": ["celltower-2"]
  };
  const targets = map[target];
  if (!targets || !["fail", "restore"].includes(action)) {
    return res.status(400).json({ success: false, message: "Unknown target or action." });
  }
  const results = {};
  for (const t of targets) {
    try {
      const response = await axios.post(
        `${CONTROLLER_URL}/api/infra/${t}/${action}`,
        {},
        { timeout: 8000, headers: CONTROLLER_AUTH_HEADERS }
      );
      results[t] = response.data?.status || "ok";
    } catch (error) {
      results[t] = error.response?.data?.message || "error";
    }
  }
  res.json({ success: true, target, action, results });
});

app.post("/api/infra/restore-all", async (req, res) => {
  const results = {};
  for (const t of ["satellite", "celltower-1", "celltower-2"]) {
    try {
      await axios.post(
        `${CONTROLLER_URL}/api/infra/${t}/restore`,
        {},
        { timeout: 8000, headers: CONTROLLER_AUTH_HEADERS }
      );
      results[t] = "restored";
    } catch (error) {
      results[t] = "error";
    }
  }
  res.json({ success: true, results });
});

// Broadcast a signed alert to every pod (via the cloud's Ed25519 signer).
app.post("/api/broadcast", async (req, res) => {
  try {
    const response = await axios.post(`${CLOUD_URL}/api/alerts`, req.body || {}, { timeout: 5000 });
    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-command-center",
      status: "up",
      pods: POD_URLS.length,
      realtime: realtimeStatus
    }
  });
});

app.get("/api/realtime/status", (req, res) => {
  res.json({ success: true, data: realtimeStatus });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

uiIo.on("connection", (socket) => {
  socket.emit("command-center:hello", {
    service: "sanjeevani-command-center",
    realtime: realtimeStatus,
    connectedAt: new Date().toISOString()
  });
});

connectBackendRealtime();

server.listen(PORT, () => {
  console.log(
    `[command-center] listening on ${PORT} (${POD_URLS.length} pods, cloud ${CLOUD_URL}, realtime ${CLOUD_SOCKET_URL})`
  );
});
