const axios = require("axios");

let activePeers = new Map();
const POTENTIAL_PODS = Array.from({ length: 10 }, (_, i) => `pod-${String(i + 1).padStart(2, "0")}`);
const MAX_HOPS = 12; // The absolute maximum size of our network to kill ghost loops

class GossipRouter {
  constructor(myPodId) {
    this.myPodId = myPodId;
    this.hopsToCloud = 999;
    this.bestRelay = null;
    this.routePath = [myPodId];
    this.isSweeping = false; // overlap guard
  }

  async sweepNetwork() {
    if (this.isSweeping) return; // previous sweep still running
    this.isSweeping = true;

    try {
      const targets = POTENTIAL_PODS.filter(
        (p) => p.toUpperCase() !== this.myPodId.toUpperCase()
      );

      // Ping all pods concurrently to speed up the sweep
      await Promise.allSettled(
        targets.map(async (targetPod) => {
          const targetUrl = `http://${targetPod}:8000`;
          try {
            const response = await axios.get(`${targetUrl}/api/gossip`, { timeout: 300 });
            if (response.data && response.data.success) {
              activePeers.set(targetPod, {
                url: targetUrl,
                podId: response.data.podId,
                hopsToCloud: response.data.hopsToCloud,
                routePath: response.data.routePath || [],
                lastSeen: Date.now()
              });
            }
          } catch (error) {
            activePeers.delete(targetPod);
          }
        })
      );

      // Clean up dead peers that missed heartbeats
      const now = Date.now();
      for (const [podName, data] of activePeers.entries()) {
        if (now - data.lastSeen > 1500) activePeers.delete(podName);
      }

      this.recalculateShortestPath();
    } finally {
      this.isSweeping = false;
    }
  }

  recalculateShortestPath() {
    let shortestHops = MAX_HOPS; 
    let bestCandidate = null;

    for (const [podName, data] of activePeers.entries()) {
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

module.exports = new GossipRouter(process.env.POD_ID || "UNKNOWN-POD");
