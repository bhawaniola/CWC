const axios = require("axios");

const MAX_HOPS = 12; // The absolute maximum size of our network to kill ghost loops
const PEER_TTL_MS = 1500;
const GOSSIP_LOG_MODE = String(process.env.GOSSIP_LOG_MODE || "changes").toLowerCase();
const SWEEP_LOG_INTERVAL_MS = Number(process.env.GOSSIP_LOG_INTERVAL_MS || 60000);

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function podIdFromNeighborUrl(neighborUrl) {
  try {
    const host = new URL(neighborUrl).hostname;
    const match = host.match(/pod[-_]?(\d+)/i);
    if (match) {
      return `POD-${match[1].padStart(2, "0")}`;
    }
    return host.toUpperCase();
  } catch (error) {
    return neighborUrl;
  }
}

class GossipRouter {
  constructor(myPodId, neighborUrls = []) {
    this.myPodId = myPodId;
    this.neighborUrls = neighborUrls.map(normalizeUrl).filter(Boolean);
    this.activePeers = new Map();
    this.hopsToCloud = 999;
    this.bestRelay = null;
    this.routePath = [myPodId];
    this.isSweeping = false; // overlap guard
    this.neighborSignature = "";
    this.lastRouteLogSignature = "";
    this.lastSweepLogAt = 0;
  }

  setNeighborUrls(neighborUrls = []) {
    const nextUrls = neighborUrls.map(normalizeUrl).filter(Boolean);
    const allowed = new Set(nextUrls);
    const nextSignature = nextUrls.join(",");

    this.neighborUrls = nextUrls;
    for (const peerUrl of this.activePeers.keys()) {
      if (!allowed.has(peerUrl)) {
        this.activePeers.delete(peerUrl);
      }
    }

    if (nextSignature !== this.neighborSignature) {
      this.neighborSignature = nextSignature;
      if (GOSSIP_LOG_MODE !== "off" && GOSSIP_LOG_MODE !== "silent") {
        console.log(
          `[gossip] ${this.myPodId} range neighbors configured: ${nextUrls
            .map(podIdFromNeighborUrl)
            .join(", ") || "none"}`
        );
      }
    }
  }

  async sweepNetwork(neighborUrls = this.neighborUrls) {
    if (this.isSweeping) return; // previous sweep still running
    this.isSweeping = true;

    try {
      const targets = neighborUrls
        .map(normalizeUrl)
        .filter(Boolean)
        .filter(
          (neighborUrl, index, list) =>
            list.indexOf(neighborUrl) === index &&
            podIdFromNeighborUrl(neighborUrl).toUpperCase() !== this.myPodId.toUpperCase()
        );

      if (targets.length === 0) {
        this.activePeers.clear();
        this.bestRelay = null;
        this.logSweepSummary(targets, null);
        return null;
      }

      // Ping only configured range-based neighbors, then choose the best next hop.
      await Promise.allSettled(
        targets.map(async (targetUrl) => {
          try {
            const response = await axios.get(`${targetUrl}/api/gossip`, { timeout: 300 });
            if (response.data && response.data.success) {
              this.activePeers.set(targetUrl, {
                url: targetUrl,
                podId: response.data.podId,
                hopsToCloud: response.data.hopsToCloud,
                routePath: response.data.routePath || [],
                lastSeen: Date.now()
              });
            }
          } catch (error) {
            this.activePeers.delete(targetUrl);
          }
        })
      );

      // Clean up dead peers that missed heartbeats
      const now = Date.now();
      for (const [peerUrl, data] of this.activePeers.entries()) {
        if (now - data.lastSeen > PEER_TTL_MS) this.activePeers.delete(peerUrl);
      }

      const bestCandidate = this.recalculateShortestPath();
      this.logSweepSummary(targets, bestCandidate);
      return bestCandidate;
    } finally {
      this.isSweeping = false;
    }
  }

  logSweepSummary(targets, bestCandidate) {
    if (GOSSIP_LOG_MODE === "off" || GOSSIP_LOG_MODE === "silent") {
      return;
    }

    const now = Date.now();
    const targetLabels = targets.map(podIdFromNeighborUrl);
    const aliveLabels = Array.from(this.activePeers.values()).map((peer) => {
      const hops = peer.hopsToCloud >= 999 ? "no-cloud" : `${peer.hopsToCloud}h`;
      return `${peer.podId}(${hops})`;
    });
    const bestPath = bestCandidate?.routePath?.length
      ? bestCandidate.routePath.join(" -> ")
      : bestCandidate?.podId || "";
    const routeSignature = [
      bestCandidate?.podId || "none",
      bestCandidate?.hopsToCloud ?? "inf",
      bestPath
    ].join("|");
    const routeChanged = routeSignature !== this.lastRouteLogSignature;
    const periodicSummaryEnabled = GOSSIP_LOG_MODE === "summary" || GOSSIP_LOG_MODE === "debug";
    const periodicSummaryDue = now - this.lastSweepLogAt >= SWEEP_LOG_INTERVAL_MS;

    if (!routeChanged && !(periodicSummaryEnabled && periodicSummaryDue)) {
      return;
    }

    this.lastRouteLogSignature = routeSignature;
    this.lastSweepLogAt = now;

    const bestLabel = bestCandidate
      ? `${bestCandidate.podId} (${bestCandidate.hopsToCloud} hops, path ${bestPath})`
      : "none";

    if (GOSSIP_LOG_MODE === "debug" || GOSSIP_LOG_MODE === "summary") {
      console.log(
        `[gossip] ${this.myPodId} neighbors=${targetLabels.join(", ") || "none"} alive=${
          aliveLabels.join(", ") || "none"
        } bestNextHop=${bestLabel}`
      );
      return;
    }

    console.log(`[gossip] ${this.myPodId} bestNextHop=${bestLabel}`);
  }

  recalculateShortestPath() {
    let shortestHops = MAX_HOPS; 
    let bestCandidate = null;

    for (const data of this.activePeers.values()) {
      // BGP Path Vector: Reject if we are already in their route history
      if (data.routePath && data.routePath.includes(this.myPodId)) {
          continue; 
      }

      // ONLY accept routes that are strictly less than MAX_HOPS (12)
      if (data.hopsToCloud < shortestHops) {
        shortestHops = data.hopsToCloud;
        bestCandidate = data;
      }
    }

    this.bestRelay = bestCandidate;
    return bestCandidate;
  }

  getBestDynamicNeighbor() {
    // Force a fresh calculation before handing the route to the sync worker
    return this.recalculateShortestPath();
  }

  getMyGossipData(directCloudStatus) {
    if (directCloudStatus === "cloud") {
      this.hopsToCloud = 0;
      this.routePath = [this.myPodId];
    } else if (this.bestRelay && this.bestRelay.hopsToCloud < MAX_HOPS) { 
      this.hopsToCloud = this.bestRelay.hopsToCloud + 1;
      this.routePath = [this.myPodId, ...this.bestRelay.routePath];
    } else {
      // If we hit the max hops, snap directly to offline mode
      this.hopsToCloud = 999;
      this.bestRelay = null;
      this.routePath = [this.myPodId];
    }

    return {
      success: true,
      podId: this.myPodId,
      hopsToCloud: this.hopsToCloud,
      routePath: this.routePath
    };
  }
}

module.exports = new GossipRouter(
  process.env.POD_ID || "UNKNOWN-POD",
  parseList(process.env.NEIGHBORS || "")
);
