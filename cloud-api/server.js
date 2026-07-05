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

  requests.unshift(request);
  console.log(
    `[cloud-api] received ${request.id || "unknown-request"} from ${request.podId || "unknown-pod"} via ${
      request.forwardedBy || request.network?.activePath || "unknown"
    }`
  );

  res.status(201).json({
    success: true,
    message: "Request stored in cloud API.",
    data: request,
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
