const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 9300;
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const SENSOR_SIMULATOR_URL = normalizeUrl(process.env.SENSOR_SIMULATOR_URL || "http://sensor-simulator:9400");
const INFRA_CONTROL_KEY = process.env.INFRA_CONTROL_KEY || "sanjeevani-infra-demo-key";

// The 10 real pod hostnames from docker-compose.yml (service pod-01..pod-10,
// all listening on container port 8000). This is the single place that list
// lives now - nothing about pod topology is hand-typed in the frontend.
const POD_IDS = Array.from({ length: 10 }, (_, i) => `POD-${String(i + 1).padStart(2, "0")}`);

function podStatusUrl(podId) {
  return `http://${podId.toLowerCase()}:8000/api/pod/status`;
}

// Pods report neighbors as raw connection URLs (e.g. "http://pod-02:8000",
// from their NEIGHBORS env var) - resolve those back to pod IDs so the UI
// and mesh-edge dedup below both work with the same "POD-02" shape as podId.
function urlToPodId(url) {
  try {
    return new URL(url).hostname.toUpperCase();
  } catch (error) {
    return url;
  }
}

const links = {
  satellite: {
    label: "Satellite",
    statusKey: "satellite",
    url: normalizeUrl(process.env.SATELLITE_URL || "http://satellite:9100"),
    containerName: process.env.SATELLITE_CONTAINER || "sanjeevani-satellite"
  },
  "celltower-1": {
    label: "CELLTOWER-1",
    statusKey: "celltower1",
    url: normalizeUrl(process.env.CELLTOWER_1_URL || "http://celltower-1:9201"),
    containerName: process.env.CELLTOWER_1_CONTAINER || "sanjeevani-celltower-1"
  },
  "celltower-2": {
    label: "CELLTOWER-2",
    statusKey: "celltower2",
    url: normalizeUrl(process.env.CELLTOWER_2_URL || "http://celltower-2:9202"),
    containerName: process.env.CELLTOWER_2_CONTAINER || "sanjeevani-celltower-2"
  }
};

const towerCoordinatorCoverage = {
  "CELLTOWER-1": [
    { id: "FIRE-01", name: "FireDept", role: "fire" },
    { id: "HOSPITAL-01", name: "Hospital1", role: "hospital" },
    { id: "SHELTER-B", name: "ShelterCampB", role: "shelter" }
  ],
  "CELLTOWER-2": [
    { id: "WORKFORCE-01", name: "WorkForceCamp1", role: "workforce" },
    { id: "WORKFORCE-02", name: "WorkForceCamp2", role: "workforce" },
    { id: "SHELTER-C", name: "ShelterCamp2", role: "shelter" }
  ]
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function requireInfraAccess(req, res, next) {
  if (req.header("x-infra-token") === INFRA_CONTROL_KEY) {
    return next();
  }

  res.status(401).json({
    success: false,
    message: "Missing or invalid x-infra-token header for this infra control action."
  });
}

function dockerRequest(method, dockerPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET,
        method,
        path: dockerPath
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const payload = body ? safeJson(body) : null;
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ statusCode: response.statusCode, data: payload });
            return;
          }
          const message = payload?.message || body || `Docker API returned ${response.statusCode}`;
          const error = new Error(message);
          error.statusCode = response.statusCode;
          error.data = payload;
          reject(error);
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function containerPath(containerName, suffix = "") {
  return `/containers/${encodeURIComponent(containerName)}${suffix}`;
}

async function inspectContainer(link) {
  try {
    const response = await dockerRequest("GET", containerPath(link.containerName, "/json"));
    const state = response.data?.State || {};
    return {
      exists: true,
      running: state.Running === true,
      dockerStatus: state.Status || "unknown",
      startedAt: state.StartedAt,
      finishedAt: state.FinishedAt
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        exists: false,
        running: false,
        dockerStatus: "missing"
      };
    }
    throw error;
  }
}

async function readLinkHealth(link) {
  try {
    const response = await axios.get(`${link.url}/health`, { timeout: 1000 });
    return response.data?.status || "up";
  } catch (error) {
    if (error.response?.data?.status) {
      return error.response.data.status;
    }
    return "down";
  }
}

async function describeLink(linkKey) {
  const link = links[linkKey];
  const container = await inspectContainer(link);
  const health = container.running ? await readLinkHealth(link) : "down";

  return {
    key: linkKey,
    label: link.label,
    containerName: link.containerName,
    url: link.url,
    status: container.running && health === "up" ? "up" : "down",
    health,
    dockerStatus: container.dockerStatus,
    running: container.running,
    startedAt: container.startedAt,
    finishedAt: container.finishedAt
  };
}

async function buildInfraStatus() {
  const entries = await Promise.all(Object.keys(links).map(describeLink));
  const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));

  return {
    satellite: byKey.satellite.status,
    celltower1: byKey["celltower-1"].status,
    celltower2: byKey["celltower-2"].status,
    towerCoverage: towerCoordinatorCoverage,
    details: byKey
  };
}

async function readPodStatus(podId) {
  try {
    const response = await axios.get(podStatusUrl(podId), { timeout: 1200 });
    const data = response.data?.data || response.data || {};
    return {
      podId,
      podName: data.podName || podId,
      reachable: true,
      neighbors: (data.neighbors || []).map(urlToPodId),
      connectedTowers: data.connectedTowers || [],
      mode: data.mode || "unknown",
      activePath: data.activePath || null,
      activeCellTower: data.activeCellTower || null,
      relayPod: data.relayPod || null,
      satelliteStatus: data.satelliteStatus || "unknown",
      cellularStatus: data.cellularStatus || "unknown",
      queuedRequests: data.queuedRequests ?? null
    };
  } catch (error) {
    return {
      podId,
      podName: podId,
      reachable: false,
      neighbors: [],
      connectedTowers: [],
      mode: "unreachable",
      activePath: null,
      activeCellTower: null,
      relayPod: null,
      satelliteStatus: "unknown",
      cellularStatus: "unknown",
      queuedRequests: null
    };
  }
}

function meshEdgesFrom(pods) {
  const seen = new Set();
  const edges = [];

  for (const pod of pods) {
    for (const neighborId of pod.neighbors) {
      const pair = [pod.podId, neighborId].sort();
      const key = pair.join("-");
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ pair, active: false });
      }
    }
  }

  // Mark an edge active when a pod is actually relaying through that
  // neighbor right now - this is what turns a static wiring diagram into a
  // live "this is the real path traffic is taking" view.
  for (const pod of pods) {
    if (pod.mode === "mesh-relay" && pod.relayPod?.podId) {
      const pair = [pod.podId, pod.relayPod.podId].sort();
      const key = pair.join("-");
      const edge = edges.find((item) => item.pair.join("-") === key);
      if (edge) {
        edge.active = true;
      } else {
        edges.push({ pair, active: true });
      }
    }
  }

  return edges;
}

async function buildTopology() {
  const pods = await Promise.all(POD_IDS.map(readPodStatus));
  return {
    pods,
    edges: meshEdgesFrom(pods),
    generatedAt: new Date().toISOString()
  };
}

async function proxySensor(method, sensorPath, body) {
  const response = await axios({
    method,
    url: `${SENSOR_SIMULATOR_URL}${sensorPath}`,
    data: body,
    timeout: 2500,
    validateStatus: () => true
  });
  return response;
}

async function stopContainer(linkKey) {
  const link = links[linkKey];
  const before = await inspectContainer(link);

  if (!before.exists) {
    return {
      success: false,
      message: `${link.label} container does not exist.`,
      status: "missing"
    };
  }

  if (before.running) {
    await dockerRequest("POST", containerPath(link.containerName, "/stop?t=0"));
  }

  const after = await describeLink(linkKey);
  console.log(`[simulation-controller] stopped ${link.containerName}`);
  return {
    success: true,
    message: `${link.label} container stopped by simulation-controller.`,
    status: after.status,
    data: after
  };
}

async function startContainer(linkKey) {
  const link = links[linkKey];
  const before = await inspectContainer(link);

  if (!before.exists) {
    return {
      success: false,
      message: `${link.label} container does not exist.`,
      status: "missing"
    };
  }

  if (!before.running) {
    await dockerRequest("POST", containerPath(link.containerName, "/start"));
  }

  await waitForHealthy(linkKey);
  const after = await describeLink(linkKey);
  console.log(`[simulation-controller] started ${link.containerName}`);
  return {
    success: true,
    message: `${link.label} container started by simulation-controller.`,
    status: after.status,
    data: after
  };
}

async function waitForHealthy(linkKey) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = await describeLink(linkKey);
    if (status.status === "up") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return describeLink(linkKey);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", async (req, res) => {
  const status = await buildInfraStatus();
  res.json({
    success: true,
    data: {
      service: "sanjeevani-simulation-controller",
      status: "up",
      infra: status
    }
  });
});

app.get("/api/infra/status", async (req, res) => {
  try {
    res.json({
      success: true,
      data: await buildInfraStatus()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not read Docker infrastructure status.",
      detail: error.message
    });
  }
});

app.get("/api/topology", async (req, res) => {
  try {
    res.json({
      success: true,
      data: await buildTopology()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not read live pod topology.",
      detail: error.message
    });
  }
});

app.get("/api/sensors/status", async (req, res) => {
  try {
    const response = await proxySensor("get", "/status");
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: `sensor-simulator not reachable at ${SENSOR_SIMULATOR_URL}.`,
      detail: error.message
    });
  }
});

app.post("/api/sensors/spike/:podId/:sensor", async (req, res) => {
  try {
    const response = await proxySensor(
      "post",
      `/spike/${req.params.podId}/${req.params.sensor}`,
      req.body
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({ success: false, message: "Could not reach sensor-simulator.", detail: error.message });
  }
});

app.post("/api/sensors/reset/:podId/:sensor", async (req, res) => {
  try {
    const response = await proxySensor(
      "post",
      `/reset/${req.params.podId}/${req.params.sensor}`,
      req.body
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({ success: false, message: "Could not reach sensor-simulator.", detail: error.message });
  }
});

app.post("/api/sensors/press/:podId", async (req, res) => {
  try {
    const response = await proxySensor("post", `/press/${req.params.podId}`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({ success: false, message: "Could not reach sensor-simulator.", detail: error.message });
  }
});

for (const linkKey of Object.keys(links)) {
  app.post(`/api/infra/${linkKey}/fail`, requireInfraAccess, async (req, res) => {
    try {
      const result = await stopContainer(linkKey);
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `Could not stop ${linkKey}.`,
        detail: error.message
      });
    }
  });

  app.post(`/api/infra/${linkKey}/restore`, requireInfraAccess, async (req, res) => {
    try {
      const result = await startContainer(linkKey);
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `Could not start ${linkKey}.`,
        detail: error.message
      });
    }
  });
}

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Simulation controller endpoint not found."
  });
});

app.listen(PORT, () => {
  console.log(`[simulation-controller] listening on ${PORT}`);
});