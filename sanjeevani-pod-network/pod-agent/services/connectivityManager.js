const axios = require("axios");
const localQueue = require("./localQueue");
const podSettings = require("./podSettings");

const podInfo = {
  podId: process.env.POD_ID || "POD-LOCAL",
  podName: process.env.POD_NAME || "Local SANJEEVANI Pod",
  region: process.env.POD_REGION || "Region-Local",
  cloudUrl: normalizeUrl(process.env.CLOUD_URL || "http://localhost:9000"),
  neighbors: parseNeighbors(process.env.NEIGHBORS || "")
};

const ciscoSimulation = {
  wifi: "Meraki MR46 - Citizen Wi-Fi / Captive Portal",
  edgeCompute: "Cisco Catalyst IR1800 with IOx - Local API + Cache",
  sdwan: "Meraki MX67C - Failover / QoS",
  cellular: "Meraki MG51 - LTE/5G Backup",
  mesh: "Cisco URWB IW9167E - Pod-to-Pod Mesh",
  sensors: "Meraki MT Sensors - Flood / Panic / Environment"
};

function getPodIdentity() {
  const settings = podSettings.getPodSettings();

  return {
    podId: podInfo.podId,
    podName: settings.podName || podInfo.podName,
    region: podInfo.region
  };
}

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, "");
}

function parseNeighbors(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeUrl);
}

function directCloudRoute(networkState) {
  if (networkState.satellite === "up") {
    return {
      mode: "cloud",
      activePath: "satellite",
      relayPod: null,
      networkState
    };
  }

  if (networkState.cellular === "up") {
    return {
      mode: "cloud",
      activePath: "cellular",
      relayPod: null,
      networkState
    };
  }

  return null;
}

function islandRoute(networkState) {
  return {
    mode: "island",
    activePath: "none",
    relayPod: null,
    networkState
  };
}

async function calculateMode(options = {}) {
  const allowMeshRelay = options.allowMeshRelay !== false;
  const networkState = localQueue.getNetworkState();
  const directRoute = directCloudRoute(networkState);

  if (directRoute) {
    return directRoute;
  }

  if (!allowMeshRelay || networkState.mesh !== "up" || podInfo.neighbors.length === 0) {
    return islandRoute(networkState);
  }

  for (const neighborUrl of podInfo.neighbors) {
    try {
      const response = await axios.get(`${neighborUrl}/api/pod/status`, {
        timeout: 1500,
        headers: {
          "x-sanjeevani-probe": "direct"
        }
      });

      const neighbor = response.data && response.data.data;
      if (neighbor && neighbor.mode === "cloud") {
        return {
          mode: "mesh-relay",
          activePath: "mesh",
          relayPod: {
            url: neighborUrl,
            podId: neighbor.podId,
            podName: neighbor.podName,
            region: neighbor.region,
            cloudPath: neighbor.activePath
          },
          networkState
        };
      }
    } catch (error) {
      console.warn(
        `[connectivity] ${podInfo.podId} could not inspect neighbor ${neighborUrl}: ${error.message}`
      );
    }
  }

  return islandRoute(networkState);
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
    relayPod: route.relayPod,
    networkState: route.networkState,
    queuedRequests: localQueue.getQueueCount(),
    ciscoSimulation
  };
}

async function sendToCloud(request) {
  const response = await axios.post(`${podInfo.cloudUrl}/api/requests`, request, {
    timeout: 3000
  });
  return response.data;
}

async function sendToRelay(relayUrl, request) {
  const response = await axios.post(`${normalizeUrl(relayUrl)}/api/relay`, request, {
    timeout: 3000
  });
  return response.data;
}

module.exports = {
  buildPodStatus,
  calculateMode,
  ciscoSimulation,
  directCloudRoute,
  getPodIdentity,
  podInfo,
  sendToCloud,
  sendToRelay,
  setPodName: podSettings.setPodName
};
