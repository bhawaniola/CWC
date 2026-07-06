const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const connectivity = require("./services/connectivityManager");
const localQueue = require("./services/localQueue");
const hazardPacks = require("./services/hazardPackService");
const { startSyncWorker } = require("./services/syncWorker");
const { triageRequest } = require("./services/triageService");

const app = express();
const PORT = process.env.PORT || 8000;
const MANAGER_API_KEY = process.env.MANAGER_API_KEY || "sanjeevani-manager-demo-key";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const reactBuildPath = path.join(__dirname, "dist");
const legacyPublicPath = path.join(__dirname, "public");
const staticPath = fs.existsSync(path.join(reactBuildPath, "index.html"))
  ? reactBuildPath
  : legacyPublicPath;

app.use(express.static(staticPath));

const syncWorker = startSyncWorker({
  calculateMode: connectivity.calculateMode,
  forwardViaRoute: connectivity.forwardViaRoute,
  sendToRelay: connectivity.sendToRelay,
  podInfo: connectivity.podInfo
});

connectivity.startHealthPolling();

function requireManagerAccess(req, res, next) {
  if (req.header("x-manager-token") === MANAGER_API_KEY) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Manager access required."
  });
}

function normalizeRequestLanguage(language) {
  if (language && typeof language === "object") {
    return {
      code: language.code || "unknown",
      name: language.name || language.nativeName || "Unknown",
      nativeName: language.nativeName || language.name || "Unknown",
      speechLocale: language.speechLocale || ""
    };
  }

  if (typeof language === "string" && language.trim()) {
    return {
      code: language.trim(),
      name: language.trim(),
      nativeName: language.trim(),
      speechLocale: ""
    };
  }

  return {
    code: "en",
    name: "English",
    nativeName: "English",
    speechLocale: "en-IN"
  };
}

function createRequest(body, route) {
  const identity = connectivity.getPodIdentity();
  const triage = triageRequest({
    category: body.category || "Other",
    message: body.message || ""
  });

  return {
    id: crypto.randomUUID(),
    podId: identity.podId,
    podName: identity.podName,
    region: identity.region,
    name: body.name || "Unknown",
    age: body.age ? Number(body.age) : null,
    phone: body.phone || "",
    category: triage.category,
    message: body.message || "",
    language: normalizeRequestLanguage(body.language),
    location: body.location || "",
    triage: {
      severity: triage.severity,
      priority: triage.priority,
      reason: triage.reason
    },
    network: {
      mode: route.mode,
      activePath: route.activePath,
      activeCellTower: route.activeCellTower,
      relayPod: route.relayPod,
      satelliteStatus: route.satelliteStatus,
      cellularStatus: route.cellularStatus,
      cellTowerStatuses: route.cellTowerStatuses,
      healthLastCheckedAt: route.healthLastCheckedAt,
      healthPollIntervalMs: route.healthPollIntervalMs,
      networkState: route.networkState
    },
    syncStatus: "pending",
    createdAt: new Date().toISOString()
  };
}

function validateRequestBody(body) {
  if (!body || typeof body !== "object") {
    return "Request body is required.";
  }

  if (!body.message || !String(body.message).trim()) {
    return "Message is required for triage.";
  }

  return null;
}

function queueLocal(request, syncStatus) {
  const queuedRequest = {
    ...request,
    syncStatus,
    queuedAt: new Date().toISOString()
  };

  localQueue.enqueue(queuedRequest);
  console.log(`[pod-agent] ${connectivity.podInfo.podId} cached ${request.id} locally`);
  return queuedRequest;
}

function responseForRequest(message, request, route) {
  return {
    success: true,
    message,
    data: {
      request,
      mode: route.mode,
      activePath: route.activePath,
      activeCellTower: route.activeCellTower,
      relayPod: route.relayPod
    }
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

app.get("/api/pod/status", async (req, res) => {
  const directProbe =
    req.header("x-sanjeevani-probe") === "direct" || req.query.scope === "direct";
  const status = await connectivity.buildPodStatus({
    allowMeshRelay: !directProbe
  });
  const alerts = hazardPacks.getAlerts();
  const triggered = hazardPacks.getTriggeredPacks();

  res.json({
    success: true,
    data: {
      ...status,
      hazardAlertCount: alerts.length,
      triggeredHazards: Object.keys(triggered)
    }
  });
});

app.post("/api/pod/name", async (req, res) => {
  try {
    connectivity.setPodName(req.body && req.body.podName);
    const status = await connectivity.buildPodStatus();

    console.log(`[pod-agent] ${status.podId} renamed to ${status.podName}`);

    res.json({
      success: true,
      message: "Pod name updated.",
      data: status
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/network/status", async (req, res) => {
  const status = await connectivity.buildPodStatus();
  res.json({
    success: true,
    data: {
      podId: status.podId,
      mode: status.mode,
      activePath: status.activePath,
      activeCellTower: status.activeCellTower,
      relayPod: status.relayPod,
      satelliteStatus: status.satelliteStatus,
      cellularStatus: status.cellularStatus,
      cellTowerStatuses: status.cellTowerStatuses,
      networkState: status.networkState,
      queuedRequests: status.queuedRequests
    }
  });
});

app.get("/api/hazards", (req, res) => {
  res.json({
    success: true,
    data: {
      packs: hazardPacks.HAZARD_PACKS,
      sensors: hazardPacks.getSensorReadings(),
      triggered: hazardPacks.getTriggeredPacks(),
      alerts: hazardPacks.getAlerts()
    }
  });
});

app.get("/api/alerts", (req, res) => {
  const alerts = hazardPacks.getAlerts();
  res.json({
    success: true,
    count: alerts.length,
    data: alerts
  });
});

app.post("/api/alerts", (req, res) => {
  if (req.body && req.body.signature && req.body.verified !== true) {
    return res.status(401).json({
      success: false,
      message: "Unsigned or untrusted alert rejected by pod shield."
    });
  }

  const alert = hazardPacks.storeAlert({
    ...req.body,
    source: req.body && req.body.source ? req.body.source : "cloud-api",
    receivedAt: new Date().toISOString()
  });

  res.status(201).json({
    success: true,
    message: "Alert stored at pod.",
    data: alert
  });
});

app.post("/api/sensors", async (req, res) => {
  try {
    const identity = connectivity.getPodIdentity();
    const result = hazardPacks.recordSensorReading(identity, req.body || {});

    for (const alert of result.fired) {
      try {
        await connectivity.sendPodAlert({
          ...alert,
          podId: identity.podId,
          podName: identity.podName,
          region: identity.region
        });
      } catch (error) {
        console.warn(
          `[pod-agent] ${identity.podId} could not report hazard ${alert.hazard}: ${error.message}`
        );
      }
    }

    res.status(result.fired.length > 0 ? 201 : 200).json({
      success: true,
      message:
        result.fired.length > 0
          ? `${result.fired.length} hazard alert(s) fired.`
          : "Sensor reading stored.",
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post("/sensor", async (req, res) => {
  req.url = "/api/sensors";
  app.handle(req, res);
});

app.post("/api/requests", async (req, res) => {
  const validationError = validateRequestBody(req.body);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError
    });
  }

  const route = await connectivity.calculateMode();
  let request = createRequest(req.body, route);

  console.log(
    `[pod-agent] ${connectivity.podInfo.podId} received ${request.id} in mode ${route.mode}`
  );

  if (route.mode === "cloud") {
    try {
      request = {
        ...request,
        syncStatus:
          route.activePath === "cellular" ? "synced-via-cellular" : "synced-via-satellite",
        syncedAt: new Date().toISOString()
      };
      await connectivity.forwardViaRoute(route, request);
      console.log(
        `[pod-agent] ${connectivity.podInfo.podId} sent ${request.id} to cloud using ${route.activePath}`
      );
      return res
        .status(201)
        .json(responseForRequest(`Request synced to cloud using ${route.activePath}.`, request, route));
    } catch (error) {
      const queuedRequest = queueLocal(request, "queued-after-cloud-failure");
      return res
        .status(202)
        .json(
          responseForRequest(
            "Request cached locally because cloud sync failed.",
            queuedRequest,
            route
          )
        );
    }
  }

  if (route.mode === "mesh-relay" && route.relayPod) {
    try {
      const relayRequest = {
        ...request,
        syncStatus: "relayed-via-mesh",
        relayedAt: new Date().toISOString()
      };
      const relayResponse = await connectivity.sendToRelay(route.relayPod.url, relayRequest);
      console.log(
        `[pod-agent] ${connectivity.podInfo.podId} relayed ${request.id} through ${route.relayPod.podId}`
      );
      return res.status(201).json({
        ...responseForRequest("Request relayed through neighboring pod.", relayRequest, route),
        relayResponse
      });
    } catch (error) {
      const queuedRequest = queueLocal(request, "queued-after-relay-failure");
      return res
        .status(202)
        .json(
          responseForRequest(
            "Request cached locally because mesh relay failed.",
            queuedRequest,
            route
          )
        );
    }
  }

  const queuedRequest = queueLocal(request, "queued-island");
  return res
    .status(202)
    .json(responseForRequest("Request cached locally in island mode.", queuedRequest, route));
});

app.post("/api/relay", async (req, res) => {
  const incoming = req.body || {};

  if (!incoming.id) {
    return res.status(400).json({
      success: false,
      message: "Relayed request must include an id."
    });
  }

  const directRoute = await connectivity.calculateMode({ allowMeshRelay: false });
  const identity = connectivity.getPodIdentity();
  const relayedRequest = {
    ...incoming,
    relayedBy: {
      podId: identity.podId,
      podName: identity.podName,
      region: identity.region,
      receivedAt: new Date().toISOString()
    },
    network: {
      ...(incoming.network || {}),
      relayHandledBy: identity.podId,
      relayCloudPath: directRoute.activePath,
      relayActiveCellTower: directRoute.activeCellTower,
      relaySatelliteStatus: directRoute.satelliteStatus,
      relayCellularStatus: directRoute.cellularStatus,
      relayNetworkState: directRoute.networkState
    }
  };

  console.log(
    `[pod-agent] ${connectivity.podInfo.podId} received relay ${incoming.id} from ${
      incoming.podId || "unknown-pod"
    }`
  );

  if (directRoute.mode === "cloud") {
    try {
      const syncedRequest = {
        ...relayedRequest,
        syncStatus:
          directRoute.activePath === "cellular"
            ? "synced-via-relay-cellular"
            : "synced-via-relay-satellite",
        syncedAt: new Date().toISOString()
      };
      await connectivity.forwardViaRoute(directRoute, syncedRequest);
      console.log(
        `[pod-agent] ${connectivity.podInfo.podId} forwarded relay ${incoming.id} to cloud`
      );
      return res.status(201).json({
        success: true,
        message: `Relay pod forwarded request to cloud using ${directRoute.activePath}.`,
        data: syncedRequest
      });
    } catch (error) {
      const queuedAtRelay = queueLocal(relayedRequest, "queued-at-relay");
      return res.status(202).json({
        success: true,
        message: "Relay pod cached request because cloud forwarding failed.",
        data: queuedAtRelay
      });
    }
  }

  const queuedAtRelay = queueLocal(relayedRequest, "queued-at-relay");
  return res.status(202).json({
    success: true,
    message: "Relay pod has no direct cloud path, so the request is queued at relay.",
    data: queuedAtRelay
  });
});

app.get("/api/queue", (req, res) => {
  const queue = localQueue.getQueue();
  res.json({
    success: true,
    count: queue.length,
    data: queue
  });
});

app.post("/api/sync", async (req, res) => {
  const result = await syncWorker.syncOnce("manual");
  res.json(result);
});

app.post("/api/hazards/reset", requireManagerAccess, (req, res) => {
  hazardPacks.resetHazards();
  res.json({
    success: true,
    message: "Local hazard state reset."
  });
});

app.post("/api/security/forged-alert", requireManagerAccess, async (req, res) => {
  const identity = connectivity.getPodIdentity();
  const attemptedAlert = {
    id: req.body?.id || `forged-${Date.now()}`,
    hazard: req.body?.hazard || "evacuation",
    message:
      req.body?.message ||
      "URGENT: Shelter compromised. Move immediately without official confirmation.",
    signature: req.body?.signature || "invalid-demo-signature",
    attemptedAt: new Date().toISOString()
  };

  const securityEvent = {
    source: "pod-shield",
    podId: identity.podId,
    podName: identity.podName,
    region: identity.region,
    severity: 9,
    detail: `Rejected forged ${attemptedAlert.hazard} alert: ${attemptedAlert.message}`,
    raw: attemptedAlert
  };

  try {
    await connectivity.sendSecurityEvent(securityEvent);
  } catch (error) {
    console.warn(
      `[pod-agent] ${identity.podId} could not report forged alert drill: ${error.message}`
    );
  }

  res.status(202).json({
    success: true,
    message: "Forged alert rejected and security event recorded.",
    data: securityEvent
  });
});

app.post("/api/network/:path/:state", async (req, res) => {
  try {
    const networkState = localQueue.setNetworkPath(req.params.path, req.params.state);
    const status = await connectivity.buildPodStatus();

    console.log(
      `[pod-agent] ${connectivity.podInfo.podId} network changed: ${req.params.path}=${req.params.state}`
    );

    res.json({
      success: true,
      message: `${req.params.path} ${req.params.state} applied locally.`,
      data: {
        networkState,
        mode: status.mode,
        activePath: status.activePath,
        activeCellTower: status.activeCellTower,
        relayPod: status.relayPod,
        queuedRequests: status.queuedRequests
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/infra/status", async (req, res) => {
  try {
    const data = await connectivity.proxyInfra("/api/infra/status");
    res.json(data);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: "Simulation controller is unreachable.",
      detail: error.message
    });
  }
});

app.use((error, req, res, next) => {
  console.error(`[pod-agent] unhandled error: ${error.stack || error.message}`);
  res.status(500).json({
    success: false,
    message: "Internal pod error."
  });
});

app.listen(PORT, () => {
  const identity = connectivity.getPodIdentity();
  console.log(
    `[pod-agent] ${identity.podId} (${identity.podName}) listening on ${PORT}`
  );
  console.log(`[pod-agent] neighbors: ${connectivity.podInfo.neighbors.join(", ") || "none"}`);
});
