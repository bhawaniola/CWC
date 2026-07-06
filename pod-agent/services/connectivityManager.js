const crypto = require("crypto");
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
const MESH_RELAY_LOG_INTERVAL_MS = Number(process.env.MESH_RELAY_LOG_INTERVAL_MS || 60000);
let healthPollTimer = null;
let healthPollPromise = null;
const healthChangeListeners = new Set();
let lastHealthSignature = "";
let lastMeshRelayLogSignature = "";
let lastMeshRelayLogAt = 0;
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
  const usableCount = towerStatuses.filter(
    (tower) => tower.status === "up" || tower.status === "degraded"
  ).length;
  if (upCount === towerStatuses.length) {
    return "up";
  }
  if (usableCount > 0) {
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
  // Keep dynamic routing bounded by the range-based neighbor topology from docker-compose.
  gossipRouter.setNeighborUrls(podInfo.neighbors);

  // 1. Ask our custom Gossip Router for the mathematically shortest configured next hop
  const bestDynamicNeighbor = gossipRouter.getBestDynamicNeighbor();

  // 2. If no one is alive around us, we are officially an offline island
  if (!bestDynamicNeighbor) {
    return null; 
  }

  const routePath = bestDynamicNeighbor.routePath?.length
    ? bestDynamicNeighbor.routePath.join(" -> ")
    : bestDynamicNeighbor.podId;
  const logSignature = `${bestDynamicNeighbor.podId}|${bestDynamicNeighbor.hopsToCloud}|${routePath}`;
  const now = Date.now();

  if (
    logSignature !== lastMeshRelayLogSignature ||
    now - lastMeshRelayLogAt >= MESH_RELAY_LOG_INTERVAL_MS
  ) {
    lastMeshRelayLogSignature = logSignature;
    lastMeshRelayLogAt = now;
    console.log(
      `[connectivity] ${podInfo.podId} selected configured neighbor ${bestDynamicNeighbor.podId} as optimal mesh relay (${bestDynamicNeighbor.hopsToCloud} hops to cloud)`
    );
  }

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

  // Predictive-failover tail: a DEGRADED link (loss >= 25%, e.g. rain fade)
  // ranks below any healthy link — traffic moved away above — but a degraded
  // link that still works always beats mesh relay and island mode.
  if (networkState.satelliteEnabled && satelliteStatus === "degraded") {
    return {
      ...base,
      mode: "cloud",
      activePath: "satellite",
      degradedLink: true,
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
    const degradedTower = towerStatuses.find((tower) => tower.status === "degraded");
    if (degradedTower) {
      return {
        ...base,
        mode: "cloud",
        activePath: "cellular",
        degradedLink: true,
        activeLink: {
          name: degradedTower.name,
          type: "cellular",
          url: degradedTower.url
        },
        activeCellTower: degradedTower.name,
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

// Hazard alerts and security events are not "local only" anymore: they are
// enqueued as special request categories and ride the SAME store-and-forward
// ladder as citizen SOS (satellite -> cellular -> mesh -> island queue).
// When an EARLY-WARNING reaches the cloud, the cloud answers with an
// Ed25519-signed broadcast to every pod.
function enqueueSystemEvent(category, fields) {
  const identity = getPodIdentity();
  const event = {
    id: crypto.randomUUID(),
    podId: identity.podId,
    podName: identity.podName,
    region: identity.region,
    name: category === "SECURITY" ? "POD-SHIELD" : "HAZARD-SENSOR",
    category,
    location: identity.podName,
    language: { code: "en", name: "English", nativeName: "English", speechLocale: "en-IN" },
    syncStatus: "pending",
    createdAt: new Date().toISOString(),
    ...fields
  };
  localQueue.enqueue(event);
  console.log(`[connectivity] ${podInfo.podId} queued ${category} event ${event.id} for cloud sync`);
  return { success: true, queued: true, id: event.id };
}

async function sendPodAlert(alert) {
  return enqueueSystemEvent("EARLY-WARNING", {
    hazard: alert.hazard,
    message: alert.message,
    triage: {
      severity: alert.severity || 9,
      priority: "critical",
      reason: alert.trigger || "hazard pack triggered"
    }
  });
}

async function sendSecurityEvent(event) {
  return enqueueSystemEvent("SECURITY", {
    message: event.detail,
    triage: { severity: event.severity || 9, priority: "critical", reason: "Shield: rejected at pod" }
  });
}

// ---- SANJEEVANI-Shield enrollment: fetch the cloud's alert-signing public
// key THROUGH a link-node (pods never talk to the cloud directly), cache it
// forever, and verify every incoming alert locally — works even offline.
let cloudPublicKey = null;
let lastAlertSeq = 0;

function canonicalAlert(alert) {
  const keys = Object.keys(alert).filter((key) => key !== "signature").sort();
  const ordered = {};
  for (const key of keys) {
    ordered[key] = alert[key];
  }
  return Buffer.from(JSON.stringify(ordered));
}

async function fetchPubkeyOnce() {
  const sources = [podInfo.satelliteUrl, ...podInfo.cellTowers.map((tower) => tower.url)];
  for (const source of sources) {
    if (!source) continue;
    try {
      const response = await axios.get(`${source}/api/pubkey`, { timeout: 2000 });
      const hex = response.data?.data?.pubkeyDerHex;
      if (hex) {
        cloudPublicKey = crypto.createPublicKey({
          key: Buffer.from(hex, "hex"),
          format: "der",
          type: "spki"
        });
        console.log(`[connectivity] ${podInfo.podId} enrolled: alert trust anchor cached via ${source}`);
        return true;
      }
    } catch (error) {
      // try the next link
    }
  }
  return false;
}

function startEnrollment() {
  const attempt = () => {
    if (cloudPublicKey) return;
    fetchPubkeyOnce().then((done) => {
      if (!done) setTimeout(attempt, 5000);
    });
  };
  attempt();
}

function verifyAlert(alert) {
  if (!cloudPublicKey) {
    return { ok: false, code: 503, reason: "no trust anchor yet — alert refused" };
  }
  const signatureHex = alert?.signature;
  if (!signatureHex) {
    return { ok: false, code: 401, reason: "unsigned alert rejected" };
  }
  let valid = false;
  try {
    valid = crypto.verify(null, canonicalAlert(alert), cloudPublicKey, Buffer.from(signatureHex, "hex"));
  } catch (error) {
    valid = false;
  }
  if (!valid) {
    return { ok: false, code: 401, reason: "invalid signature — alert rejected" };
  }
  if (Number(alert.seq || 0) <= lastAlertSeq) {
    return { ok: false, code: 401, reason: "stale sequence — replay rejected" };
  }
  const scope = alert.scope || "all";
  if (scope !== "all" && !String(scope).includes(podInfo.podId)) {
    return { ok: false, code: 401, reason: "scope mismatch — alert rejected" };
  }
  lastAlertSeq = Number(alert.seq);
  return { ok: true };
}

async function forwardBatchViaRoute(route, requestsForSync) {
  if (!route.activeLink?.url) {
    throw new Error("No active link is available for batch forwarding.");
  }
  const response = await axios.post(
    `${route.activeLink.url}/api/forward-batch`,
    { requests: requestsForSync },
    { timeout: 8000 }
  );
  return response.data;
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
  forwardBatchViaRoute,
  getPodIdentity,
  getHealthSnapshot,
  podInfo,
  pollHealthOnce,
  proxyInfra,
  readInfraStatus,
  sendPodAlert,
  sendSecurityEvent,
  sendToRelay,
  startEnrollment,
  startHealthPolling,
  verifyAlert,
  setPodName: podSettings.setPodName
};
