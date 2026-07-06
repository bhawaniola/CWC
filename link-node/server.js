const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 9100;
const LINK_ID = process.env.LINK_ID || "satellite";
const LINK_TYPE = process.env.LINK_TYPE || "satellite";
const CLOUD_URL = normalizeUrl(process.env.CLOUD_URL || "http://cloud-api:9000");

// Link physics (merged from the Python relay): every transmission pays the
// path's latency and rolls dice against its loss. loss >= DEGRADED_LOSS makes
// /health report "degraded", which pods treat as a predictive-failover signal
// (the ThousandEyes idea with one rule). Simulate rain fade with:
//   curl "http://localhost:9100/set?loss=0.4"
const DEGRADED_LOSS = Number(process.env.DEGRADED_LOSS || 0.25);
const linkState = {
  loss: Number(process.env.LOSS || 0),
  latencyMs: Number(process.env.LATENCY_MS || (LINK_TYPE === "satellite" ? 80 : 30))
};

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, "");
}

function linkStatus() {
  return linkState.loss >= DEGRADED_LOSS ? "degraded" : "up";
}

function statusPayload(success = true) {
  return {
    success,
    linkId: LINK_ID,
    linkType: LINK_TYPE,
    status: linkStatus(),
    loss: linkState.loss,
    latencyMs: linkState.latencyMs
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function packetLost() {
  return Math.random() < linkState.loss;
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
    route: request.network?.syncPath || request.network?.activePath || LINK_TYPE,
    relayTrail: Array.isArray(request.relayTrail)
      ? request.relayTrail.map((item) => item.podId).filter(Boolean)
      : [],
    createdAt: request.createdAt || ""
  };
}

app.get("/health", (req, res) => {
  return res.json(statusPayload(true));
});

app.get("/api/link/status", (req, res) => {
  res.json(statusPayload(true));
});

app.all("/set", (req, res) => {
  const loss = req.query.loss ?? req.body?.loss;
  const latencyMs = req.query.latencyMs ?? req.body?.latencyMs;

  if (loss !== undefined) {
    linkState.loss = Math.max(0, Math.min(1, Number(loss) || 0));
  }
  if (latencyMs !== undefined) {
    linkState.latencyMs = Math.max(0, Number(latencyMs) || 0);
  }

  console.log(
    `[link-node] ${LINK_ID} conditions set: loss=${linkState.loss}, latencyMs=${linkState.latencyMs} (status=${linkStatus()})`
  );
  res.json(statusPayload(true));
});

// Enrollment passthrough: pods never talk to the cloud directly, so even the
// one-time public-key fetch travels through a link-node.
app.get("/api/pubkey", async (req, res) => {
  try {
    const response = await axios.get(`${CLOUD_URL}/api/pubkey`, { timeout: 2000 });
    res.json(response.data);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: `${LINK_ID} could not reach cloud API for pubkey.`,
      detail: error.message
    });
  }
});

app.post("/api/forward", async (req, res) => {
  await sleep(linkState.latencyMs);

  if (packetLost()) {
    console.log(`[link-node] ${LINK_ID} DROPPED ${req.body?.id || "unknown-request"} (loss=${linkState.loss})`);
    return res.status(503).json({
      success: false,
      message: `${LINK_ID}: packet lost on a degraded link.`
    });
  }

  const forwardedRequest = {
    ...req.body,
    forwardedBy: LINK_ID,
    linkType: LINK_TYPE,
    forwardedAt: new Date().toISOString()
  };

  console.log(
    `[link-node] ${LINK_ID} received ${forwardedRequest.id || "unknown-request"} from ${
      forwardedRequest.podId || "unknown-pod"
    }`
  );
  console.log(`[link-node] ${LINK_ID} payload ${JSON.stringify(requestSnapshot(forwardedRequest))}`);

  try {
    const response = await axios.post(`${CLOUD_URL}/api/requests`, forwardedRequest, {
      timeout: 2000
    });
    console.log(
      `[link-node] ${LINK_ID} forwarded ${forwardedRequest.id || "unknown-request"} from ${
        forwardedRequest.podId || "unknown-pod"
      }`
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: `${LINK_ID} could not reach cloud API.`,
      detail: error.message
    });
  }
});

// Batch forwarding: one transmission window for many queued SOS items —
// the bandwidth answer for surge scenarios on thin links.
app.post("/api/forward-batch", async (req, res) => {
  const items = Array.isArray(req.body?.requests) ? req.body.requests : [];
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "requests array required" });
  }

  await sleep(linkState.latencyMs);

  const forwarded = [];
  const failed = [];

  for (const item of items) {
    if (packetLost()) {
      failed.push(item.id);
      continue;
    }
    try {
      await axios.post(
        `${CLOUD_URL}/api/requests`,
        { ...item, forwardedBy: LINK_ID, linkType: LINK_TYPE, forwardedAt: new Date().toISOString() },
        { timeout: 2000 }
      );
      forwarded.push(item.id);
    } catch (error) {
      failed.push(item.id);
    }
  }

  console.log(
    `[link-node] ${LINK_ID} batch: forwarded ${forwarded.length}/${items.length} queued request(s)`
  );
  res.json({ success: failed.length === 0, forwarded, failed });
});

app.listen(PORT, () => {
  console.log(
    `[link-node] ${LINK_ID} (${LINK_TYPE}) listening on ${PORT} (latency=${linkState.latencyMs}ms, loss=${linkState.loss})`
  );
});
