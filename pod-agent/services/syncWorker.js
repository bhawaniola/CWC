const localQueue = require("./localQueue");

function startSyncWorker({ calculateMode, forwardViaRoute, sendToRelay, podInfo }) {
  async function syncOnce(trigger = "auto") {
    const queuedRequests = localQueue.getQueue();

    if (queuedRequests.length === 0) {
      return {
        success: true,
        trigger,
        message: "Queue is empty.",
        synced: 0,
        failed: 0,
        remaining: 0
      };
    }

    const route = await calculateMode();

    if (route.mode === "island") {
      return {
        success: true,
        trigger,
        message: "Island mode active. Queue retained locally.",
        mode: route.mode,
        activePath: route.activePath,
        synced: 0,
        failed: 0,
        remaining: queuedRequests.length
      };
    }

    let synced = 0;
    let failed = 0;

    for (const queuedRequest of queuedRequests) {
      const syncAttemptAt = new Date().toISOString();
      const requestForSync = {
        ...queuedRequest,
        syncAttemptAt,
        network: {
          ...(queuedRequest.network || {}),
          syncMode: route.mode,
          syncPath: route.activePath,
          syncCellTower: route.activeCellTower || null,
          syncRelayPod: route.relayPod || null
        }
      };

      try {
        if (route.mode === "cloud") {
          await forwardViaRoute(route, {
            ...requestForSync,
            syncStatus:
              route.activePath === "cellular"
                ? "synced-after-reconnect-via-cellular"
                : "synced-after-reconnect-via-satellite",
            syncedAt: new Date().toISOString()
          });
        } else if (route.mode === "mesh-relay" && route.relayPod) {
          await sendToRelay(route.relayPod.url, {
            ...requestForSync,
            syncStatus: "relayed-after-reconnect",
            relayedAt: new Date().toISOString()
          });
        }

        localQueue.removeFromQueue(queuedRequest.id);
        synced += 1;
        console.log(
          `[syncWorker] ${podInfo.podId} synced ${queuedRequest.id} through ${route.activePath}`
        );
      } catch (error) {
        failed += 1;
        console.warn(
          `[syncWorker] ${podInfo.podId} kept ${queuedRequest.id} in queue: ${error.message}`
        );
      }
    }

    return {
      success: failed === 0,
      trigger,
      message:
        synced > 0
          ? `Synced ${synced} queued request(s) through ${route.activePath}.`
          : "No queued requests could be synced.",
      mode: route.mode,
      activePath: route.activePath,
      relayPod: route.relayPod,
      synced,
      failed,
      remaining: localQueue.getQueueCount()
    };
  }

  setInterval(() => {
    syncOnce("auto").catch((error) => {
      console.warn(`[syncWorker] auto sync failed: ${error.message}`);
    });
  }, 5000);

  return {
    syncOnce
  };
}

module.exports = {
  startSyncWorker
};
