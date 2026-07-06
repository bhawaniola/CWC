const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 9100;
const LINK_ID = process.env.LINK_ID || "satellite";
const LINK_TYPE = process.env.LINK_TYPE || "satellite";
const CLOUD_URL = normalizeUrl(process.env.CLOUD_URL || "http://cloud-api:9000");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, "");
}

function statusPayload(success = true) {
  return {
    success,
    linkId: LINK_ID,
    linkType: LINK_TYPE,
    status: "up"
  };
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

app.post("/api/forward", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`[link-node] ${LINK_ID} (${LINK_TYPE}) listening on ${PORT}`);
});
