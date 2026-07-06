const localQueue = require("./localQueue");

function relayVisitedPods(request, currentPodId) {
  const visited = new Set([currentPodId]);

  if (request.podId) {
    visited.add(request.podId);
  }

  if (request.relayedBy?.podId) {
    visited.add(request.relayedBy.podId);
  }

  if (Array.isArray(request.relayTrail)) {
    for (const hop of request.relayTrail) {
      if (hop?.podId) {
        visited.add(hop.podId);
      }
    }
  }

  return visited;
}

function meshTargetsFor(route, request, currentPodId) {
  const targets = route.relayPods && route.relayPods.length > 0 ? route.relayPods : [route.relayPod];
  const visited = relayVisitedPods(request, currentPodId);

  return targets.filter((target) => target?.url && !visited.has(target.podId));
}

function startSyncWorker({ calculateMode, forwardViaRoute, sendToRelay, podInfo }) {
  let activeSync = null;

  async function runSync(trigger = "auto") {
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

    console.log(
      `[syncWorker] ${podInfo.podId} checking ${queuedRequests.length} queued request(s) from ${trigger}: satellite -> cellular -> mesh`
    );

    const route = await calculateMode();

    if (route.mode === "island") {
      console.log(
        `[syncWorker] ${podInfo.podId} retained ${queuedRequests.length} queued request(s): no satellite/cellular/mesh route available`
      );

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

    console.log(
      `[syncWorker] ${podInfo.podId} selected ${route.activePath} for queue sync (mode=${route.mode}, tower=${route.activeCellTower || "none"}, relay=${route.relayPod?.podId || "none"})`
    );

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
          console.log(
            `[syncWorker] ${podInfo.podId} sending ${queuedRequest.id} to ${route.activePath} link-node`
          );

          await forwardViaRoute(route, {
            ...requestForSync,
            syncStatus:
              route.activePath === "cellular"
                ? "synced-after-reconnect-via-cellular"
                : "synced-after-reconnect-via-satellite",
            syncedAt: new Date().toISOString()
          });
        } else if (route.mode === "mesh-relay" && route.relayPod) {
          const meshTargets = meshTargetsFor(route, queuedRequest, podInfo.podId);

          if (meshTargets.length === 0) {
            throw new Error("No unvisited mesh neighbor is available for this request.");
          }

          let acceptedBy = 0;
          for (const target of meshTargets) {
            try {
              console.log(
                `[syncWorker] ${podInfo.podId} sending ${queuedRequest.id} directly over pod-mesh link to ${target.podId}`
              );

              await sendToRelay(target.url, {
                ...requestForSync,
                syncStatus: "relayed-over-direct-pod-mesh",
                meshLink: {
                  fromPodId: podInfo.podId,
                  toPodId: target.podId,
                  sentAt: new Date().toISOString()
                },
                relayedAt: new Date().toISOString()
              });
              acceptedBy += 1;
            } catch (error) {
              console.warn(
                `[syncWorker] ${podInfo.podId} mesh link to ${target.podId} failed for ${queuedRequest.id}: ${error.message}`
              );
            }
          }

          if (acceptedBy === 0) {
            throw new Error("No mesh neighbor accepted the request.");
          }
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

  async function syncOnce(trigger = "auto") {
    if (activeSync) {
      console.log(`[syncWorker] ${podInfo.podId} ${trigger} sync joined active queue sync`);
      return activeSync;
    }

    activeSync = runSync(trigger).finally(() => {
      activeSync = null;
    });

    return activeSync;
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
