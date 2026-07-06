const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 9400;
const CLOUD_URL = normalizeUrl(process.env.CLOUD_URL || "http://cloud-api:9000");
const CONTROLLER_URL = normalizeUrl(
  process.env.SIMULATION_CONTROLLER_URL || "http://simulation-controller:9300"
);
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
app.use(express.static(path.join(__dirname, "public")));

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

// ---- aggregation endpoints (real data fanned out from the cluster) ----

app.get("/api/overview", async (req, res) => {
  const [cloud, requestsPayload, alertsPayload, infraPayload, pods] = await Promise.all([
    getJson(`${CLOUD_URL}/api/health`),
    getJson(`${CLOUD_URL}/api/requests`),
    getJson(`${CLOUD_URL}/api/alerts`),
    getJson(`${CONTROLLER_URL}/api/infra/status`),
    fetchPods()
  ]);

  const requests = requestsPayload?.data || [];
  const alerts = alertsPayload?.data || [];
  const infra = infraPayload?.data || {};

  const citizenRequests = requests.filter(
    (r) => r.category !== "EARLY-WARNING" && r.category !== "SECURITY"
  );
  const online = pods.filter((p) => p.reachable && p.mode !== "offline");
  const islandCount = pods.filter((p) => p.mode === "island").length;
  const totalQueued = pods.reduce((sum, p) => sum + (p.queuedRequests || 0), 0);

  const severityOf = (r) => r.triage?.severity || 0;
  const critical = citizenRequests.filter((r) => severityOf(r) >= 8).length;

  res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      cloudUp: Boolean(cloud?.data),
      mode: islandCount > 0 ? "ISLAND MODE" : online.length === pods.length ? "CLOUD MODE" : "MIXED",
      counts: {
        activeRequests: citizenRequests.length,
        critical,
        podsOnline: online.length,
        podsTotal: pods.length,
        queued: totalQueued,
        islandPods: islandCount,
        alerts: alerts.length
      },
      infra,
      pods,
      requests: citizenRequests.slice(0, 12),
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

app.get("/api/alerts", async (req, res) => {
  const payload = await getJson(`${CLOUD_URL}/api/alerts`);
  res.json({ success: true, data: payload?.data || [] });
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
      const response = await axios.post(`${CONTROLLER_URL}/api/infra/${t}/${action}`, {}, { timeout: 8000 });
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
      await axios.post(`${CONTROLLER_URL}/api/infra/${t}/restore`, {}, { timeout: 8000 });
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
  res.json({ success: true, data: { service: "sanjeevani-command-center", status: "up", pods: POD_URLS.length } });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[command-center] listening on ${PORT} (${POD_URLS.length} pods, cloud ${CLOUD_URL})`);
});
