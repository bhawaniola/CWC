const axios = require("axios");
const localQueue = require("./localQueue");
const podSettings = require("./podSettings");
const gossipRouter = require("./gossipRouter");

const podInfo = {
  podId: process.env.POD_ID || "POD-LOCAL",
  podName: process.env.POD_NAME || "Local SANJEEVANI Pod",
  region: process.env.POD_REGION || "Region-Local",
  satelliteUrl: normalizeUrl(process.env.SATELLITE_URL || "http://satellite:9100"),
  cellTowers: parseCellTowers(process.env.CELL_TOWERS || "", process.env.CONNECTED_TOWERS || ""),
  connectedTowers: parseList(process.env.CONNECTED_TOWERS || ""),
  neighbors: parseList(process.env.NEIGHBORS || "").map(normalizeUrl),
  simulationControllerUrl: normalizeUrl(
    process.env.SIMULATION_CONTROLLER_URL || "http://simulation-controller:9300"
  )
};

const HEALTH_POLL_INTERVAL_MS = Number(process.env.HEALTH_POLL_INTERVAL_MS || 5000);
let healthPollTimer = null;
let healthPollPromise = null;
const healthChangeListeners = new Set();
let lastHealthSignature = "";
let latestHealthSnapshot = {
  satelliteStatus: "unknown",
  cellularStatus: podInfo.cellTowers.length > 0 ? "unknown" : "not-configured",
  cellTowerStatuses: podInfo.cellTowers.map((tower) => ({
    name: tower.name,
    url: tower.url,
    status: "unknown"
  })),
  checkedAt: null,
  pollIntervalMs: HEALTH_POLL_INTERVAL_MS
};

const ciscoSimulation = {
  podEdge: "Cisco Catalyst IR1800 IOx edge app for local SOS intake and cache",
  satellite: "LEO satellite / 5G-NTN backhaul represented by the satellite link-node",
  cellular: "Cisco Meraki MG cellular backhaul represented by CELLTOWER-1 and CELLTOWER-2",
  mesh: "Cisco URWB pod-to-pod relay path",
  localWifi: "Meraki MR captive portal for citizens submitting SOS requests",
  sensors: "Meraki MT style hazard inputs for flood, heat, and earthquake drills"
};

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCellTowers(cellTowerValue, connectedTowerValue) {
  const rawTowers = parseList(cellTowerValue);
  const names = parseList(connectedTowerValue);

  return rawTowers.map((entry, index) => {
    const [maybeName, maybeUrl] = entry.includes("=") ? entry.split("=", 2) : [names[index], entry];
    return {
      name: maybeName || `CELLTOWER-${index + 1}`,
      url: normalizeUrl(maybeUrl)
    };
  });
}

function getPodIdentity() {
  const settings = podSettings.getPodSettings();

  return {
    podId: podInfo.podId,
    podName: settings.podName || podInfo.podName,
    region: podInfo.region
  };
}

async function readLinkHealth(url) {
  try {
    const response = await axios.get(`${normalizeUrl(url)}/health`, { timeout: 1000 });
    return response.data?.status || "up";
  } catch (error) {
    if (error.response?.data?.status) {
      return error.response.data.status;
    }
    return "down";
  }
}

async function readInfraStatus() {
  try {
    const response = await axios.get(`${podInfo.simulationControllerUrl}/api/infra/status`, {
      timeout: 1200
    });
    return response.data?.data || {};
  } catch (error) {
    return {
      satellite: "unreachable",
      celltower1: "unreachable",
      celltower2: "unreachable"
    };
  }
}

async function buildTowerStatuses() {
  const towerStatuses = await Promise.all(
    podInfo.cellTowers.map(async (tower) => ({
      name: tower.name,
      url: tower.url,
      status: await readLinkHealth(tower.url)
    }))
  );
  return towerStatuses;
}

function summarizeCellular(towerStatuses) {
  if (towerStatuses.length === 0) {
    return "not-configured";
  }

  const upCount = towerStatuses.filter((tower) => tower.status === "up").length;
  if (upCount === towerStatuses.length) {
    return "up";
  }
  if (upCount > 0) {
    return "degraded";
  }
  return "down";
}

function cloneHealthSnapshot() {
  return {
    ...latestHealthSnapshot,
    cellTowerStatuses: latestHealthSnapshot.cellTowerStatuses.map((tower) => ({ ...tower }))
  };
}

function healthSnapshotAgeMs() {
  if (!latestHealthSnapshot.checkedAt) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - new Date(latestHealthSnapshot.checkedAt).getTime();
}

async function pollHealthOnce() {
  const [satelliteStatus, towerStatuses] = await Promise.all([
    readLinkHealth(podInfo.satelliteUrl),
    buildTowerStatuses()
  ]);
  const cellularStatus = summarizeCellular(towerStatuses);

  latestHealthSnapshot = {
    satelliteStatus,
    cellularStatus,
    cellTowerStatuses: towerStatuses,
    checkedAt: new Date().toISOString(),
    pollIntervalMs: HEALTH_POLL_INTERVAL_MS
  };

  const nextSignature = JSON.stringify({
    satelliteStatus,
    cellularStatus,
    towers: towerStatuses.map((tower) => `${tower.name}:${tower.status}`)
  });

  if (nextSignature !== lastHealthSignature) {
    const previousSignature = lastHealthSignature;
    lastHealthSignature = nextSignature;
    console.log(
      `[connectivity] ${podInfo.podId} health poll: satellite=${satelliteStatus}, cellular=${cellularStatus}`
    );

    if (previousSignature) {
      for (const listener of healthChangeListeners) {
        listener(cloneHealthSnapshot());
      }
    }
  }

  return cloneHealthSnapshot();
}

async function refreshHealthSnapshot() {
  if (!healthPollPromise) {
    healthPollPromise = pollHealthOnce().finally(() => {
      healthPollPromise = null;
    });
  }

  return healthPollPromise;
}

async function getHealthSnapshot(options = {}) {
  const maxAgeMs = options.maxAgeMs ?? 1500;

  if (!latestHealthSnapshot.checkedAt) {
    return refreshHealthSnapshot();
  }

  if (options.forceRefresh && healthSnapshotAgeMs() > maxAgeMs) {
    return refreshHealthSnapshot();
  }

  return cloneHealthSnapshot();
}

function startHealthPolling(options = {}) {
  if (typeof options.onChange === "function") {
    healthChangeListeners.add(options.onChange);
  }

  if (healthPollTimer) {
    return healthPollTimer;
  }

  refreshHealthSnapshot().catch((error) => {
    console.warn(`[connectivity] ${podInfo.podId} initial health poll failed: ${error.message}`);
  });

  healthPollTimer = setInterval(() => {
    refreshHealthSnapshot().catch((error) => {
      console.warn(`[connectivity] ${podInfo.podId} health poll failed: ${error.message}`);
    });
  }, HEALTH_POLL_INTERVAL_MS);

  return healthPollTimer;
}

function islandRoute(base) {
  return {
    ...base,
    mode: "island",
    activePath: "none",
    activeLink: null,
    activeCellTower: null,
    relayPod: null
  };
}

function podIdFromNeighborUrl(neighborUrl) {
  try {
    const host = new URL(neighborUrl).hostname;
    const match = host.match(/pod[-_]?(\d+)/i);
    if (match) {
      return `POD-${match[1].padStart(2, "0")}`;
    }
  } catch (error) {
    // Fall through to a readable URL-based label.
  }

  return neighborUrl;
}

function buildMeshRelayPods() {
  return podInfo.neighbors.map((neighborUrl) => ({
    url: neighborUrl,
    podId: podIdFromNeighborUrl(neighborUrl),
    podName: podIdFromNeighborUrl(neighborUrl),
    region: "neighbor",
    cloudPath: "unknown",
    activeCellTower: null
  }));
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`timeout of ${timeoutMs}ms exceeded`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectNeighborForRelay(neighborUrl, base) {
  try {
    console.log(`[connectivity] ${podInfo.podId} probing mesh neighbor ${neighborUrl}`);

    const response = await fetchJson(`${neighborUrl}/api/pod/relay-candidate`, 2500);
    const neighbor = response && response.data;

    if (neighbor) {
      console.log(
        `[connectivity] ${podInfo.podId} inspected neighbor ${neighbor.podId}: ${neighbor.mode}/${neighbor.activePath}, cellular=${neighbor.cellularStatus}, tower=${neighbor.activeCellTower || "none"}`
      );
    }

    if (!neighbor || neighbor.mode !== "cloud") {
      throw new Error(`${neighbor?.podId || neighborUrl} has no direct cloud path`);
    }

    console.log(
      `[connectivity] ${podInfo.podId} selected ${neighbor.podId} as mesh relay via ${neighbor.activePath}`
    );

    return {
      ...base,
      mode: "mesh-relay",
      activePath: "mesh",
      activeLink: null,
      activeCellTower: null,
      relayPod: {
        url: neighborUrl,
        podId: neighbor.podId,
        podName: neighbor.podName,
        region: neighbor.region,
        cloudPath: neighbor.activePath,
        activeCellTower: neighbor.activeCellTower || null
      }
    };
  } catch (error) {
    console.warn(
      `[connectivity] ${podInfo.podId} could not use neighbor ${neighborUrl}: ${error.message}`
    );
    throw error;
  }
}


async function findMeshRelay(base) {
  // 1. Ask our custom Gossip Router for the mathematically shortest path
  const bestDynamicNeighbor = gossipRouter.getBestDynamicNeighbor();

  // 2. If no one is alive around us, we are officially an offline island
  if (!bestDynamicNeighbor) {
    return null; 
  }

  console.log(
    `[connectivity] ${podInfo.podId} ALGORITHM SELECTED ${bestDynamicNeighbor.podId} as optimal mesh relay (${bestDynamicNeighbor.hopsToCloud} hops to cloud)`
  );

  // 3. Format the data so the rest of Pranav's app still understands it
  const relayPodFormat = {
    url: bestDynamicNeighbor.url,
    podId: bestDynamicNeighbor.podId,
    podName: bestDynamicNeighbor.podId,
    region: "dynamic-mesh",
    cloudPath: "dynamic",
    activeCellTower: null
  };

  return {
    ...base,
    mode: "mesh-relay",
    activePath: "mesh",
    activeLink: null,
    activeCellTower: null,
    relayPod: relayPodFormat,
    relayPods: [relayPodFormat]
  };
}


async function calculateMode(options = {}) {
  const allowMeshRelay = options.allowMeshRelay !== false;
  const networkState = localQueue.getNetworkState();
  const healthSnapshot = await getHealthSnapshot({
    forceRefresh: options.forceRefresh !== false,
    maxAgeMs: options.maxAgeMs ?? 250
  });
  const satelliteStatus = healthSnapshot.satelliteStatus;
  const towerStatuses = healthSnapshot.cellTowerStatuses;
  const cellularStatus = healthSnapshot.cellularStatus;

  const base = {
    satelliteStatus,
    cellularStatus,
    cellTowerStatuses: towerStatuses,
    healthLastCheckedAt: healthSnapshot.checkedAt,
    healthPollIntervalMs: healthSnapshot.pollIntervalMs,
    networkState
  };

  if (networkState.satelliteEnabled && satelliteStatus === "up") {
    return {
      ...base,
      mode: "cloud",
      activePath: "satellite",
      activeLink: {
        name: "satellite",
        type: "satellite",
        url: podInfo.satelliteUrl
      },
      activeCellTower: null,
      relayPod: null
    };
  }

  if (networkState.cellularEnabled) {
    const activeTower = towerStatuses.find((tower) => tower.status === "up");
    if (activeTower) {
      return {
        ...base,
        mode: "cloud",
        activePath: "cellular",
        activeLink: {
          name: activeTower.name,
          type: "cellular",
          url: activeTower.url
        },
        activeCellTower: activeTower.name,
        relayPod: null
      };
    }
  }

  if (allowMeshRelay && networkState.meshEnabled && podInfo.neighbors.length > 0) {
    const relayRoute = await findMeshRelay(base);
    if (relayRoute) {
      return relayRoute;
    }
  }

  return islandRoute(base);
}

async function buildPodStatus(options = {}) {
  const route = await calculateMode(options);
  const identity = getPodIdentity();

  return {
    podId: identity.podId,
    podName: identity.podName,
    region: identity.region,
    mode: route.mode,
    activePath: route.activePath,
    activeCellTower: route.activeCellTower,
    relayPod: route.relayPod,
    relayPods: route.relayPods || [],
    satelliteStatus: route.satelliteStatus,
    cellularStatus: route.cellularStatus,
    cellTowerStatuses: route.cellTowerStatuses,
    healthLastCheckedAt: route.healthLastCheckedAt,
    healthPollIntervalMs: route.healthPollIntervalMs,
    networkState: route.networkState,
    queuedRequests: localQueue.getQueueCount(),
    connectedTowers: podInfo.connectedTowers,
    neighbors: podInfo.neighbors,
    ciscoSimulation
  };
}

async function buildRelayCandidate() {
  const route = await calculateMode({
    allowMeshRelay: false,
    forceRefresh: false,
    maxAgeMs: HEALTH_POLL_INTERVAL_MS
  });
  const identity = getPodIdentity();

  return {
    podId: identity.podId,
    podName: identity.podName,
    region: identity.region,
    mode: route.mode,
    activePath: route.activePath,
    activeCellTower: route.activeCellTower,
    satelliteStatus: route.satelliteStatus,
    cellularStatus: route.cellularStatus,
    cellTowerStatuses: route.cellTowerStatuses,
    healthLastCheckedAt: route.healthLastCheckedAt,
    connectedTowers: podInfo.connectedTowers
  };
}

async function forwardViaRoute(route, request) {
  if (!route.activeLink?.url) {
    throw new Error("No active link is available for cloud forwarding.");
  }

  const response = await axios.post(`${route.activeLink.url}/api/forward`, request, {
    timeout: 2500
  });
  return response.data;
}

// Fired hazard alerts now ride the exact same satellite -> cellular -> mesh -> local
// cache pipeline as SOS requests, instead of only being logged locally. Dropping the
// alert into localQueue means the existing syncWorker (already running every 5s, plus
// triggered immediately after submission) will attempt to send it out on its next pass
// and will keep retrying automatically until a path is available.
async function sendPodAlert(alert) {
  const identity = getPodIdentity();
  const queuedAlert = {
    ...alert,
    id: alert.id || `alert-${Date.now()}`,
    type: "hazard-alert",
    podId: alert.podId || identity.podId,
    podName: alert.podName || identity.podName,
    region: alert.region || identity.region,
    syncStatus: "queued-at-origin-pod",
    queuedAt: new Date().toISOString()
  };

  localQueue.enqueue(queuedAlert);

  console.log(
    `[connectivity] ${podInfo.podId} queued hazard alert ${queuedAlert.id} (${queuedAlert.hazard || "unknown hazard"}) for satellite/cellular/mesh sync`
  );

  return { success: true, queued: true, id: queuedAlert.id };
}

async function sendSecurityEvent(event) {
  console.log(`[connectivity] ${podInfo.podId} stored local security event ${event.source}`);
  return { success: true, localOnly: true };
}

async function sendToRelay(relayUrl, request) {
  const timeoutMs = 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizeUrl(relayUrl)}/api/mesh/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    const responseText = await response.text();
    let data = {};

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        data = { raw: responseText };
      }
    }

    if (!response.ok) {
      throw new Error(data.message || `Mesh inbox returned HTTP ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`mesh inbox timeout after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyInfra(path) {
  const response = await axios({
    method: path.endsWith("/status") ? "GET" : "POST",
    url: `${podInfo.simulationControllerUrl}${path}`,
    timeout: 2500
  });
  return response.data;
}

module.exports = {
  buildRelayCandidate,
  buildPodStatus,
  calculateMode,
  ciscoSimulation,
  forwardViaRoute,
  getPodIdentity,
  getHealthSnapshot,
  podInfo,
  pollHealthOnce,
  proxyInfra,
  readInfraStatus,
  sendPodAlert,
  sendSecurityEvent,
  sendToRelay,
  startHealthPolling,
  setPodName: podSettings.setPodName
};
