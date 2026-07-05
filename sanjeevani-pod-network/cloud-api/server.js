const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 9000;

let requests = [];

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-cloud-api",
      status: "up",
      receivedRequests: requests.length,
      checkedAt: new Date().toISOString()
    }
  });
});

app.post("/api/requests", (req, res) => {
  const incoming = req.body || {};

  if (!incoming.id) {
    return res.status(400).json({
      success: false,
      message: "Request id is required."
    });
  }

  const cloudRecord = {
    ...incoming,
    syncStatus: "synced",
    cloudReceivedAt: new Date().toISOString()
  };

  const existingIndex = requests.findIndex((item) => item.id === cloudRecord.id);
  if (existingIndex >= 0) {
    requests[existingIndex] = {
      ...requests[existingIndex],
      ...cloudRecord
    };
  } else {
    requests.push(cloudRecord);
  }

  console.log(
    `[cloud-api] received ${cloudRecord.id} from ${cloudRecord.podId || "unknown-pod"}`
  );

  res.status(existingIndex >= 0 ? 200 : 201).json({
    success: true,
    message: "Request stored in cloud.",
    data: cloudRecord,
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
  console.log(`[cloud-api] listening on port ${PORT}`);
});
