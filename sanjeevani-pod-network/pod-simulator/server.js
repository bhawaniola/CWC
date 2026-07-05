const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8100;
const MANAGER_API_KEY = process.env.MANAGER_API_KEY || "sanjeevani-manager-demo-key";
const ALLOWED_PATHS = new Set(["satellite", "cellular", "mesh"]);
const ALLOWED_STATES = new Set(["up", "down"]);

const DEFAULT_PODS = Array.from({ length: 10 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return `POD-${number}=http://pod-${number}:8000`;
}).join(",");

const podTargets = parsePodTargets(process.env.PODS || DEFAULT_PODS);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, "");
}

function parsePodTargets(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [podId, url] = entry.split("=");
      return {
        podId: String(podId || "").trim().toUpperCase(),
        url: normalizeUrl(url || "")
      };
    })
    .filter((target) => target.podId && target.url);
}

function selectTargets(podIds) {
  if (!Array.isArray(podIds)) {
    return podTargets;
  }

  if (podIds.length === 0) {
    return [];
  }

  const selected = new Set(podIds.map((podId) => String(podId).toUpperCase()));
  return podTargets.filter((target) => selected.has(target.podId));
}

async function fetchPodStatus(target) {
  try {
    const response = await axios.get(`${target.url}/api/pod/status`, { timeout: 2200 });
    return {
      ...response.data.data,
      simulatorUrl: target.url,
      reachable: true
    };
  } catch (error) {
    return {
      podId: target.podId,
      podName: target.podId,
      simulatorUrl: target.url,
      reachable: false,
      error: error.message,
      mode: "unknown",
      activePath: "unknown",
      relayPod: null,
      networkState: {
        satellite: "unknown",
        cellular: "unknown",
        mesh: "unknown"
      },
      queuedRequests: "-"
    };
  }
}

async function setNetwork(target, pathName, state) {
  const response = await axios.post(`${target.url}/api/network/${pathName}/${state}`, {}, {
    timeout: 2500,
    headers: {
      "x-manager-token": MANAGER_API_KEY
    }
  });

  return {
    podId: target.podId,
    success: true,
    message: response.data.message,
    data: response.data.data
  };
}

async function renamePod(target, podName) {
  const response = await axios.post(
    `${target.url}/api/pod/name`,
    { podName },
    {
      timeout: 2500,
      headers: {
        "x-manager-token": MANAGER_API_KEY
      }
    }
  );

  return response.data;
}

async function syncPod(target) {
  const response = await axios.post(
    `${target.url}/api/sync`,
    {},
    {
      timeout: 5000,
      headers: {
        "x-manager-token": MANAGER_API_KEY
      }
    }
  );

  return response.data;
}

async function applyNetworkTargets(targets, pathName, state) {
  return Promise.all(
    targets.map(async (target) => {
      try {
        return await setNetwork(target, pathName, state);
      } catch (error) {
        return {
          podId: target.podId,
          success: false,
          message: error.message
        };
      }
    })
  );
}

async function applyMany(targets, operations) {
  const results = [];

  for (const operation of operations) {
    const operationResults = await applyNetworkTargets(targets, operation.path, operation.state);
    results.push(...operationResults.map((result) => ({ ...result, operation })));
  }

  return results;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-pod-simulator",
      status: "up",
      pods: podTargets.length
    }
  });
});

app.get("/api/pods", async (req, res) => {
  const data = await Promise.all(podTargets.map(fetchPodStatus));
  res.json({
    success: true,
    count: data.length,
    data
  });
});

app.post("/api/pods/network", async (req, res) => {
  const { podIds, path: pathName, state } = req.body || {};

  if (!ALLOWED_PATHS.has(pathName) || !ALLOWED_STATES.has(state)) {
    return res.status(400).json({
      success: false,
      message: "Use path satellite/cellular/mesh and state up/down."
    });
  }

  const targets = selectTargets(podIds);
  const results = await applyNetworkTargets(targets, pathName, state);

  res.json({
    success: results.every((result) => result.success),
    message: `${pathName} set ${state} for ${targets.length} pod(s).`,
    results
  });
});

app.post("/api/pods/name", async (req, res) => {
  const { podId, podName } = req.body || {};
  const target = podTargets.find((candidate) => candidate.podId === String(podId || "").toUpperCase());

  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Pod not found."
    });
  }

  try {
    const result = await renamePod(target, podName);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.response && error.response.data ? error.response.data.message : error.message
    });
  }
});

app.post("/api/pods/sync", async (req, res) => {
  const targets = selectTargets(req.body && req.body.podIds);
  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        const result = await syncPod(target);
        return {
          podId: target.podId,
          success: true,
          result
        };
      } catch (error) {
        return {
          podId: target.podId,
          success: false,
          message: error.response && error.response.data ? error.response.data.message : error.message
        };
      }
    })
  );

  res.json({
    success: results.every((result) => result.success),
    message: `Manual sync requested for ${targets.length} pod(s).`,
    results
  });
});

app.post("/api/pods/island", async (req, res) => {
  const targets = selectTargets(req.body && req.body.podIds);
  const results = await applyMany(targets, [
    { path: "satellite", state: "down" },
    { path: "cellular", state: "down" },
    { path: "mesh", state: "down" }
  ]);

  res.json({
    success: results.every((result) => result.success),
    message: `Island mode applied to ${targets.length} pod(s).`,
    results
  });
});

app.post("/api/pods/restore-all", async (req, res) => {
  const targets = selectTargets(req.body && req.body.podIds);
  const results = await applyMany(targets, [
    { path: "satellite", state: "up" },
    { path: "cellular", state: "up" },
    { path: "mesh", state: "up" }
  ]);

  res.json({
    success: results.every((result) => result.success),
    message: `All paths restored for ${targets.length} pod(s).`,
    results
  });
});

app.listen(PORT, () => {
  console.log(`[pod-simulator] listening on ${PORT}`);
  console.log(`[pod-simulator] controlling ${podTargets.length} pods`);
});
