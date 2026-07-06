const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 9000;
const requests = [];

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function nowIso() {
  return new Date().toISOString();
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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-cloud-api",
      status: "up",
      receivedRequests: requests.length,
      checkedAt: nowIso()
    }
  });
});

app.post("/api/requests", (req, res) => {
  const request = {
    ...req.body,
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

  res.status(duplicate ? 200 : 201).json({
    success: true,
    message: duplicate ? "Request already existed; cloud API updated it." : "Request stored in cloud API.",
    data: duplicate ? requests[existingIndex] : request,
    count: requests.length
  });
});

app.get("/api/requests", (req, res) => {
  res.json({
    success: true,
    count: requests.length,
    data: requests
  });
});

app.listen(PORT, () => {
  console.log(`[cloud-api] listening on ${PORT}`);
});
