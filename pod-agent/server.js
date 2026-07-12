const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const connectivity = require("./services/connectivityManager");
const localQueue = require("./services/localQueue");
const hazardPacks = require("./services/hazardPackService");
const gossipRouter = require("./services/gossipRouter");
const { startSyncWorker } = require("./services/syncWorker");
const { triageRequest } = require("./services/triageService");

const app = express();
const PORT = process.env.PORT || 8000;
const MANAGER_API_KEY = process.env.MANAGER_API_KEY || "sanjeevani-manager-demo-key";
const GOSSIP_SWEEP_INTERVAL_MS = Number(process.env.GOSSIP_SWEEP_INTERVAL_MS || 2000);
const COORDINATOR_ROUTES = parseCoordinatorRoutes(
  process.env.COORDINATOR_INBOXES || process.env.COORDINATOR_ROUTES || ""
);

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
  forwardBatchViaRoute: connectivity.forwardBatchViaRoute,
  sendToRelay: connectivity.sendToRelay,
  podInfo: connectivity.podInfo
});

function triggerQueueSync(trigger) {
  setTimeout(() => {
    syncWorker.syncOnce(trigger).catch((error) => {
      console.warn(`[pod-agent] ${connectivity.podInfo.podId} sync trigger failed: ${error.message}`);
    });
  }, 250);
}

connectivity.startHealthPolling({
  onChange: (snapshot) => {
    console.log(
      `[pod-agent] ${connectivity.podInfo.podId} health changed; waking queue sync (satellite=${snapshot.satelliteStatus}, cellular=${snapshot.cellularStatus})`
    );
    triggerQueueSync("health-change");
  }
});

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

function normalizeCoordinatorUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function parseCoordinatorRoutes(value) {
  return String(value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [rawRole, rawUrls] = entry.includes("=") ? entry.split("=", 2) : ["all", entry];
      const role = String(rawRole || "all").trim().toLowerCase();
      return String(rawUrls || "")
        .split(",")
        .map((url) => normalizeCoordinatorUrl(url))
        .filter(Boolean)
        .map((url) => ({ role, url }));
    });
}

const COORDINATOR_ROLE_MATCHERS = {
  hospital: {
    categories: ["medical", "medical/rescue"],
    keywords: [
      "ambulance",
      "blood",
      "breathe",
      "breathing",
      "chest pain",
      "doctor",
      "fracture",
      "heart",
      "hospital",
      "icu",
      "injury",
      "injured",
      "insulin",
      "medicine",
      "oxygen",
      "patient",
      "pregnant",
      "stroke",
      "triage",
      "unconscious"
    ]
  },
  shelter: {
    categories: ["shelter", "food", "water"],
    keywords: [
      "blanket",
      "camp",
      "drinking",
      "food",
      "meal",
      "packet",
      "shelter",
      "shortage",
      "tent",
      "water"
    ]
  },
  workforce: {
    categories: ["workforce", "volunteer"],
    keywords: [
      "assignment",
      "crew",
      "delivery",
      "driver",
      "shift",
      "staff",
      "team",
      "transport",
      "volunteer",
      "worker"
    ]
  },
  fire: {
    categories: ["fire"],
    keywords: [
      "burn",
      "evacuation",
      "fire",
      "flame",
      "hotspot",
      "smoke",
      "sprinkler",
      "wildfire"
    ]
  },
  flood: {
    categories: ["flood"],
    keywords: [
      "boat",
      "current",
      "flood",
      "life jacket",
      "marooned",
      "river",
      "roof",
      "stranded",
      "trapped",
      "waterlogged"
    ]
  }
};

function requestMatchesCoordinatorRole(role, request) {
  if (role === "all") {
    return true;
  }

  // Hazard-pack alerts carry their responder roles explicitly (flood ->
  // flood+shelter, earthquake -> hospital+workforce, ...), so they route
  // even when the alert text contains no role keyword.
  if (Array.isArray(request.roles) && request.roles.includes(role)) {
    return true;
  }

  const matcher = COORDINATOR_ROLE_MATCHERS[role];
  if (!matcher) {
    return false;
  }

  const category = String(request.category || "").toLowerCase();
  if (matcher.categories.includes(category)) {
    return true;
  }

  const text = [
    request.category,
    request.message,
    request.location,
    request.triage?.reason,
    request.name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return matcher.keywords.some((keyword) => text.includes(keyword));
}

function coordinatorTargetsForRequest(request) {
  const seen = new Set();

  return COORDINATOR_ROUTES.filter((route) => requestMatchesCoordinatorRole(route.role, request)).filter(
    (route) => {
      const signature = `${route.role}|${route.url}`;
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    }
  );
}

async function postCoordinatorInbox(target, request, route, trigger) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  const identity = connectivity.getPodIdentity();

  try {
    const response = await fetch(`${target.url}/api/coordinator/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...request,
        source: "nearby-pod-mesh",
        transport: "direct-pod-mesh",
        targetRole: target.role,
        sourcePodId: identity.podId,
        meshLink: {
          fromPodId: identity.podId,
          fromPodName: identity.podName,
          toCoordinatorUrl: target.url,
          trigger,
          sentAt: new Date().toISOString()
        },
        network: {
          ...(request.network || {}),
          coordinatorNotifyPath: "direct-pod-mesh",
          coordinatorNotifyRole: target.role,
          podRouteAtNotify: route?.activePath || "queued"
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    console.log(
      `[pod-agent] ${identity.podId} notified ${target.role} coordinator at ${target.url} for ${request.id}`
    );
  } catch (error) {
    console.warn(
      `[pod-agent] ${identity.podId} could not notify ${target.role} coordinator ${target.url}: ${error.message}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function notifyMatchingCoordinators(request, route, trigger) {
  const targets = coordinatorTargetsForRequest(request);
  if (targets.length === 0) {
    return;
  }

  for (const target of targets) {
    postCoordinatorInbox(target, request, route, trigger);
  }
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
      relayPods: route.relayPods || [],
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

function hasMeshHopVisitedPod(incoming, podId) {
  if (incoming.podId === podId || incoming.relayedBy?.podId === podId) {
    return true;
  }

  if (!Array.isArray(incoming.relayTrail)) {
    return false;
  }

  return incoming.relayTrail.some((hop) => hop?.podId === podId);
}

function buildMeshInboxRequest(incoming) {
  const identity = connectivity.getPodIdentity();
  const receivedAt = new Date().toISOString();
  const existingTrail = Array.isArray(incoming.relayTrail) ? incoming.relayTrail : [];

  return {
    ...incoming,
    relayTrail: [
      ...existingTrail,
      {
        podId: identity.podId,
        podName: identity.podName,
        region: identity.region,
        receivedAt
      }
    ],
    relayedBy: {
      podId: identity.podId,
      podName: identity.podName,
      region: identity.region,
      receivedAt
    },
    network: {
      ...(incoming.network || {}),
      meshInboxPod: identity.podId,
      meshInboxPodName: identity.podName,
      meshInboxReceivedAt: receivedAt,
      meshLinkFrom: incoming.meshLink?.fromPodId || incoming.podId || "unknown-pod"
    }
  };
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
      relayPod: route.relayPod,
      relayPods: route.relayPods || []
    }
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

app.get("/api/pod/relay-candidate", async (req, res) => {
  const candidate = await connectivity.buildRelayCandidate();

  console.log(
    `[pod-agent] ${candidate.podId} relay candidate check: ${candidate.mode}/${candidate.activePath}, cellular=${candidate.cellularStatus}, tower=${candidate.activeCellTower || "none"}`
  );

  res.json({
    success: true,
    data: candidate
  });
});



// Dynamic Gossip Protocol Endpoint
app.get("/api/gossip", async (req, res) => {
  const status = await connectivity.buildPodStatus({
    allowMeshRelay: false,
    forceRefresh: false,
    maxAgeMs: 5000
  });
  const gossipData = gossipRouter.getMyGossipData(status.mode);
  res.json(gossipData);
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

app.post("/api/alerts", async (req, res) => {
  // SANJEEVANI-Shield: real Ed25519 verification with the cloud's public key
  // (cached at enrollment), sequence freshness (anti-replay), and scope check.
  // A forged or replayed alert is rejected AND reported as a security event
  // that rides the normal queue ladder up to the cloud.
  const verdict = connectivity.verifyAlert(req.body || {});

  if (!verdict.ok) {
    const identity = connectivity.getPodIdentity();
    console.warn(
      `[pod-agent] ${identity.podId} SHIELD rejected alert: ${verdict.reason} — "${String(
        req.body?.message || ""
      ).slice(0, 60)}"`
    );
    if (verdict.code === 401) {
      try {
        await connectivity.sendSecurityEvent({
          severity: 9,
          detail: `Rejected alert (${verdict.reason}): ${String(req.body?.message || "").slice(0, 80)}`
        });
        triggerQueueSync("security-event");
      } catch (error) {
        console.warn(`[pod-agent] could not queue security event: ${error.message}`);
      }
    }
    return res.status(verdict.code).json({ success: false, message: verdict.reason });
  }

  const alert = hazardPacks.storeAlert({
    ...req.body,
    verified: true,
    source: req.body && req.body.source ? req.body.source : "cloud-api",
    receivedAt: new Date().toISOString()
  });

  res.status(201).json({
    success: true,
    message: "Signed alert verified and stored at pod.",
    data: alert
  });
});

app.post("/api/sensors", async (req, res) => {
  try {
    const identity = connectivity.getPodIdentity();
    const result = hazardPacks.recordSensorReading(identity, req.body || {});

    for (const packName of result.rearmed || []) {
      console.log(
        `[pod-agent] ${identity.podId} hazard pack "${packName}" re-armed: ${result.reading.sensor} back at safe level ${result.reading.value}`
      );
    }

    // Live telemetry for the Command Center and coordinators: queue the pod's
    // full sensor snapshot up the same satellite -> cellular -> mesh ladder as
    // SOS traffic. Stable id per pod, so the offline queue holds at most one
    // pending snapshot and the background 5s sync carries the latest reading —
    // telemetry never jumps the queue ahead of an SOS.
    localQueue.enqueue({
      id: `sensor-state-${identity.podId}`,
      requestKind: "pod-sensor-update",
      podId: identity.podId,
      podName: identity.podName,
      region: identity.region,
      readings: hazardPacks.buildSensorTelemetry(identity),
      createdAt: new Date().toISOString()
    });

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

    // A fired hazard also goes straight to relief teams in URWB radio range
    // (same shortcut citizen SOS uses), so the local fire/flood camp reacts
    // even when every uplink to the cloud is down.
    if (result.fired.length > 0) {
      const route = await connectivity.calculateMode();
      for (const alert of result.fired) {
        notifyMatchingCoordinators(
          {
            ...alert,
            podId: identity.podId,
            podName: identity.podName,
            region: identity.region,
            category: "EARLY-WARNING",
            location: identity.podName,
            triage: {
              severity: alert.severity,
              priority: alert.severity >= 8 ? "critical" : "high",
              reason: `Hazard pack "${alert.hazard}" fired at ${identity.podName}`
            }
          },
          route,
          "hazard-alert"
        );
      }
    }


    // A hazard just got queued for satellite/cellular/mesh sync above - wake the
    // sync worker immediately instead of waiting for its 5s auto-interval, same
    // as citizen SOS submissions do.
    if (result.fired.length > 0) {
      triggerQueueSync("hazard-alert");
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


// Per-device rate limiting (token bucket): protects the shared uplink from a
// stuck retry loop or a hostile flood without ever blocking a first SOS.
// Keyed by the x-device-id header (each citizen device/browser) with IP as
// the fallback. Tune with RATE_LIMIT_BURST / RATE_LIMIT_REFILL_MS.
const RATE_LIMIT_BURST = Number(process.env.RATE_LIMIT_BURST || 6);
const RATE_LIMIT_REFILL_MS = Number(process.env.RATE_LIMIT_REFILL_MS || 2000);
const rateBuckets = new Map();

function rateLimitRequests(req, res, next) {
  const key = req.header("x-device-id") || req.ip || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { tokens: RATE_LIMIT_BURST, lastRefill: now };

  const refill = Math.floor((now - bucket.lastRefill) / RATE_LIMIT_REFILL_MS);
  if (refill > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_BURST, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    rateBuckets.set(key, bucket);
    return res.status(429).json({
      success: false,
      message:
        "Too many requests from this device. Your earlier SOS is already queued — volunteers will reach you."
    });
  }

  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  return next();
}

// Meraki MT30-style smart automation button. A physical press at a camp doesn't
// carry sensor thresholds - it's an unambiguous "someone needs help now" signal,
// so it skips hazardPackService entirely and drops straight into the same SOS
// request pipeline (queue -> satellite/cellular/mesh -> cloud, or cache if none
// are reachable) that the citizen-facing form uses.
app.post("/api/sensors/button", async (req, res) => {
  try {
    const route = await connectivity.calculateMode();
    const body = {
      name: req.body?.name || "Meraki MT30 Smart Button",
      category: "Rescue",
      message:
        req.body?.message ||
        "Meraki MT30 automation button pressed at this pod. Immediate on-site assistance requested.",
      location: req.body?.location || "",
      language: req.body?.language
    };

    const request = createRequest(body, route);

    // A pressed button is inherently urgent regardless of message wording,
    // so it always gets top priority rather than depending on keyword triage.
    request.category = "Medical/Rescue";
    request.triage = {
      severity: 9,
      priority: "critical",
      reason: "Meraki MT30 smart automation button pressed on-site."
    };

    const queuedRequest = queueLocal(request, "queued-at-origin-pod");
    triggerQueueSync("mt30-button");

    console.log(
      `[pod-agent] ${connectivity.podInfo.podId} MT30 button press queued as ${request.id}`
    );

    return res.status(202).json(
      responseForRequest(
        "MT30 button press queued at this pod. Sync worker will try satellite, cellular, then pod mesh.",
        queuedRequest,
        route
      )
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post("/api/requests", rateLimitRequests, async (req, res) => {
  const validationError = validateRequestBody(req.body);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError
    });
  }

  const route = await connectivity.calculateMode();
  const request = createRequest(req.body, route);

  console.log(
    `[pod-agent] ${connectivity.podInfo.podId} received ${request.id}; queued locally before sync`
  );

  const queuedRequest = queueLocal(request, "queued-at-origin-pod");
  notifyMatchingCoordinators(queuedRequest, route, "origin-submission");
  triggerQueueSync("submission");

  return res.status(202).json(
    responseForRequest(
      "Request queued at this pod. Sync worker will try satellite, cellular, then pod mesh.",
      queuedRequest,
      route
    )
  );
});

function acceptMeshInbox(req, res) {
  const incoming = req.body || {};

  if (!incoming.id) {
    return res.status(400).json({
      success: false,
      message: "Mesh request must include an id."
    });
  }

  const identity = connectivity.getPodIdentity();
  const sourcePod = incoming.meshLink?.fromPodId || incoming.podId || "unknown-pod";

  if (hasMeshHopVisitedPod(incoming, identity.podId)) {
    console.log(
      `[pod-agent] ${identity.podId} ignored mesh ${incoming.id} from ${sourcePod}; pod already visited`
    );

    return res.status(202).json({
      success: true,
      message: "Mesh inbox skipped request because this pod already saw it.",
      data: {
        id: incoming.id,
        skipped: true,
        podId: identity.podId
      }
    });
  }

  const relayedRequest = buildMeshInboxRequest(incoming);

  console.log(
    `[pod-agent] ${identity.podId} mesh inbox accepted ${incoming.id} directly from ${sourcePod}`
  );

  const queuedAtRelay = queueLocal(relayedRequest, "queued-at-mesh-inbox");
  // Telemetry snapshots only hop toward the cloud — they are not SOS cards
  // and must never land in a coordinator's inbox.
  if (relayedRequest.requestKind !== "pod-sensor-update") {
    notifyMatchingCoordinators(queuedAtRelay, relayedRequest.network, "mesh-inbox");
  }

  res.status(202).json({
    success: true,
    message: "Mesh inbox accepted request and queued it for local sync.",
    data: queuedAtRelay
  });

  triggerQueueSync("mesh-inbox");
}

app.post("/api/mesh/inbox", acceptMeshInbox);
app.post("/api/relay", acceptMeshInbox);

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

app.post("/api/drone-relay/:state", async (req, res) => {
  const expectedToken = String(process.env.DRONE_CONTROL_KEY || "sanjeevani-drone-demo-key");
  if (req.get("x-drone-relay-token") !== expectedToken) {
    return res.status(403).json({ success: false, message: "Drone relay authorization failed." });
  }
  const enabled = req.params.state === "enable";
  if (!enabled && req.params.state !== "disable") {
    return res.status(400).json({ success: false, message: "Relay state must be enable or disable." });
  }
  const relay = connectivity.setDroneRelay({
    enabled,
    url: req.body?.url,
    missionId: req.body?.missionId,
    droneId: req.body?.droneId,
    activatedAt: req.body?.activatedAt
  });
  const status = await connectivity.buildPodStatus();
  console.log(
    `[pod-agent] ${status.podId} aerial relay ${enabled ? "enabled" : "disabled"}: ${relay.droneId || "none"}`
  );
  res.json({ success: true, data: { relay, status } });
  if (enabled) triggerQueueSync("drone-relay-enabled");
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

gossipRouter.setNeighborUrls(connectivity.podInfo.neighbors);

// Start the range-bounded dynamic background sweeper.
setInterval(() => {
  gossipRouter.sweepNetwork();
}, GOSSIP_SWEEP_INTERVAL_MS);

// SANJEEVANI-Shield enrollment: fetch the cloud's alert-signing public key
// through a link-node (retries every 5s until any link is reachable).
connectivity.startEnrollment();
