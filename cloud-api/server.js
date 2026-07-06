const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 9000;
const requests = [];
const coordinatorEvents = [];
const coordinatorMessages = [];

// SANJEEVANI-Shield: the cloud is the only holder of the alert-signing
// private key. Pods fetch the public key once (through a link-node) and
// verify every alert locally with real Ed25519 — a forged or replayed
// alert is rejected at the pod even when it is fully offline.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubkeyDerHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
let alertSeq = 0;
const alertsSent = [];

const POD_URLS = String(process.env.POD_URLS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes("="))
  .map((entry) => {
    const [podId, url] = entry.split("=", 2);
    return { podId, url: url.replace(/\/+$/, "") };
  });

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function nowIso() {
  return new Date().toISOString();
}

function canonicalAlert(alert) {
  const keys = Object.keys(alert).filter((key) => key !== "signature").sort();
  const ordered = {};
  for (const key of keys) {
    ordered[key] = alert[key];
  }
  return Buffer.from(JSON.stringify(ordered));
}

async function broadcastAlert({ hazard, message, scope }) {
  alertSeq += 1;
  const alert = {
    id: `alert-${alertSeq}`,
    seq: alertSeq,
    hazard: hazard || "manual",
    message: message || "Test alert from EOC.",
    scope: scope || "all",
    issuedAt: nowIso()
  };
  alert.signature = crypto.sign(null, canonicalAlert(alert), privateKey).toString("hex");

  const delivery = {};
  await Promise.all(
    POD_URLS.map(async ({ podId, url }) => {
      try {
        const response = await axios.post(`${url}/api/alerts`, alert, { timeout: 2500 });
        delivery[podId] = response.status;
      } catch (error) {
        delivery[podId] = error.response?.status || "unreachable";
      }
    })
  );

  const record = { ...alert, delivery };
  alertsSent.unshift(record);
  alertsSent.splice(10);
  console.log(
    `[cloud-api] broadcast signed alert #${alert.seq} (${alert.hazard}) to ${POD_URLS.length} pod(s)`
  );
  return record;
}

function requestSnapshot(request) {
  return {
    id: request.id || "unknown-request",
    podId: request.podId || "unknown-pod",
    podName: request.podName || "",
    category: request.category || "",
    location: request.location || "",
    language: request.language?.name || request.language?.code || "",
    syncStatus: request.syncStatus || "",
    forwardedBy: request.forwardedBy || "",
    linkType: request.linkType || request.network?.syncPath || request.network?.activePath || "",
    relayTrail: Array.isArray(request.relayTrail)
      ? request.relayTrail.map((item) => item.podId).filter(Boolean)
      : [],
    cloudReceivedAt: request.cloudReceivedAt || ""
  };
}

function isCoordinatorEvent(request) {
  return Boolean(
    request.requestKind?.startsWith("coordinator-") ||
      request.coordinatorId ||
      request.coordinatorRole
  );
}

function upsertCoordinatorEvent(event) {
  const storedEvent = {
    ...event,
    cloudReceivedAt: event.cloudReceivedAt || nowIso()
  };
  const existingIndex = coordinatorEvents.findIndex(
    (item) => item.id && storedEvent.id && item.id === storedEvent.id
  );

  if (existingIndex >= 0) {
    coordinatorEvents[existingIndex] = {
      ...coordinatorEvents[existingIndex],
      ...storedEvent,
      cloudUpdatedAt: nowIso()
    };
    return coordinatorEvents[existingIndex];
  }

  coordinatorEvents.unshift(storedEvent);
  return storedEvent;
}

function coordinatorMessageMatchesQuery(message, query) {
  const targetCoordinatorId = String(query.targetCoordinatorId || "").toLowerCase();
  const targetRole = String(query.targetRole || query.role || "").toLowerCase();

  if (!targetCoordinatorId && !targetRole) {
    return true;
  }

  const messageTargetId = String(message.targetCoordinatorId || message.coordinatorId || "").toLowerCase();
  const messageTargetRole = String(message.targetRole || message.role || message.coordinatorRole || "").toLowerCase();

  return (
    (targetCoordinatorId && messageTargetId === targetCoordinatorId) ||
    (targetRole && messageTargetRole === targetRole) ||
    messageTargetRole === "all" ||
    messageTargetId === "all"
  );
}

function storeRequest(body) {
  const request = {
    ...body,
    cloudReceivedAt: nowIso()
  };

  const existingIndex = requests.findIndex((item) => item.id && item.id === request.id);
  const duplicate = existingIndex >= 0;

  if (duplicate) {
    requests[existingIndex] = {
      ...requests[existingIndex],
      ...request,
      cloudUpdatedAt: nowIso()
    };
  } else {
    requests.unshift(request);
  }

  console.log(
    `[cloud-api] ${duplicate ? "updated duplicate" : "received"} ${
      request.id || "unknown-request"
    } from ${request.podId || "unknown-pod"} via ${
      request.forwardedBy || request.network?.activePath || "unknown"
    }`
  );
  console.log(`[cloud-api] payload ${JSON.stringify(requestSnapshot(request))}`);

  // A hazard pack fired at a pod and the early warning just reached the
  // cloud through whatever path survived — answer with a signed broadcast
  // to every pod (production: Webex Connect SMS blast + Webex EOC room).
  if (!duplicate && request.category === "EARLY-WARNING") {
    broadcastAlert({
      hazard: request.hazard || "hazard",
      message: request.message,
      scope: "all"
    }).catch((error) => console.warn(`[cloud-api] broadcast failed: ${error.message}`));
  }

  if (!duplicate && request.category === "SECURITY") {
    console.log(`[cloud-api] SECURITY EVENT from ${request.podId}: ${request.message}`);
  }

  if (isCoordinatorEvent(request)) {
    const storedEvent = upsertCoordinatorEvent(request);
    console.log(
      `[cloud-api] coordinator event ${storedEvent.id || "unknown-event"} from ${
        storedEvent.coordinatorId || storedEvent.podId || "unknown-coordinator"
      }`
    );
  }

  return { request: duplicate ? requests[existingIndex] : request, duplicate };
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-cloud-api",
      status: "up",
      receivedRequests: requests.length,
      coordinatorEvents: coordinatorEvents.length,
      coordinatorMessages: coordinatorMessages.length,
      alertsSent: alertsSent.length,
      checkedAt: nowIso()
    }
  });
});

app.get("/api/pubkey", (req, res) => {
  res.json({
    success: true,
    data: { algorithm: "ed25519", pubkeyDerHex }
  });
});

app.post("/api/alerts", async (req, res) => {
  try {
    const record = await broadcastAlert(req.body || {});
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/alerts", (req, res) => {
  res.json({ success: true, count: alertsSent.length, data: alertsSent });
});

app.post("/api/requests", (req, res) => {
  const { request, duplicate } = storeRequest(req.body || {});
  res.status(duplicate ? 200 : 201).json({
    success: true,
    message: duplicate ? "Request already existed; cloud API updated it." : "Request stored in cloud API.",
    data: request,
    count: requests.length
  });
});

app.post("/api/requests/batch", (req, res) => {
  const items = Array.isArray(req.body?.requests) ? req.body.requests : [];
  const stored = items.map((item) => storeRequest(item).request.id);
  res.status(201).json({ success: true, stored, count: requests.length });
});

app.get("/api/requests", (req, res) => {
  res.json({
    success: true,
    count: requests.length,
    data: requests
  });
});

app.post("/api/coordinator-events", (req, res) => {
  const storedEvent = upsertCoordinatorEvent({
    ...req.body,
    cloudReceivedAt: nowIso()
  });

  res.status(201).json({
    success: true,
    message: "Coordinator event stored in cloud API.",
    data: storedEvent,
    count: coordinatorEvents.length
  });
});

app.get("/api/coordinator-events", (req, res) => {
  const coordinatorId = String(req.query.coordinatorId || "").toLowerCase();
  const role = String(req.query.role || req.query.coordinatorRole || "").toLowerCase();
  const filtered = coordinatorEvents.filter((event) => {
    if (coordinatorId && String(event.coordinatorId || event.podId || "").toLowerCase() !== coordinatorId) {
      return false;
    }

    if (role && String(event.coordinatorRole || event.role || "").toLowerCase() !== role) {
      return false;
    }

    return true;
  });

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

app.post("/api/coordinator-messages", (req, res) => {
  const message = {
    ...req.body,
    id: req.body?.id || `cloud-message-${Date.now()}`,
    source: req.body?.source || "cloud-api",
    cloudReceivedAt: nowIso()
  };
  const existingIndex = coordinatorMessages.findIndex((item) => item.id === message.id);

  if (existingIndex >= 0) {
    coordinatorMessages[existingIndex] = {
      ...coordinatorMessages[existingIndex],
      ...message,
      cloudUpdatedAt: nowIso()
    };
  } else {
    coordinatorMessages.unshift(message);
  }

  res.status(existingIndex >= 0 ? 200 : 201).json({
    success: true,
    message:
      existingIndex >= 0
        ? "Coordinator message updated in cloud API."
        : "Coordinator message stored in cloud API.",
    data: existingIndex >= 0 ? coordinatorMessages[existingIndex] : message,
    count: coordinatorMessages.length
  });
});

app.get("/api/coordinator-messages", (req, res) => {
  const filtered = coordinatorMessages.filter((message) =>
    coordinatorMessageMatchesQuery(message, req.query)
  );

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

app.listen(PORT, () => {
  console.log(`[cloud-api] listening on ${PORT} (alert signing: ed25519, ${POD_URLS.length} pods registered)`);
});
