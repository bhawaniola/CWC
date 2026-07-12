const axios = require("axios");
const cors = require("cors");
const express = require("express");

const { MockDroneProvider } = require("./providers/mockDroneProvider");
const { FlytBaseProvider } = require("./providers/flytBaseProvider");

const app = express();
const PORT = Number(process.env.PORT || 9600);
const DRONE_MODE = String(process.env.DRONE_MODE || "mock").toLowerCase();
const CONTROL_KEY = String(process.env.DRONE_CONTROL_KEY || "sanjeevani-drone-demo-key");
const EVENT_CALLBACK_URL = String(process.env.DRONE_EVENT_CALLBACK_URL || "").trim();
const EVENT_CALLBACK_KEY = String(process.env.DRONE_EVENT_CALLBACK_KEY || CONTROL_KEY);
const CLOUD_URL = String(process.env.CLOUD_URL || "http://cloud-api:9000").replace(/\/+$/, "");

const provider = DRONE_MODE === "flytbase"
  ? new FlytBaseProvider()
  : new MockDroneProvider({ publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}` });

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireControl(req, res, next) {
  if (req.get("x-drone-control-token") !== CONTROL_KEY) {
    return res.status(403).json({ success: false, message: "Drone control authorization failed." });
  }
  next();
}

function requireRelay(req, res, next) {
  if (req.get("x-drone-relay-token") !== CONTROL_KEY) {
    return res.status(403).json({ success: false, message: "Drone relay authorization failed." });
  }
  next();
}

function sendData(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

async function forwardEvent(event) {
  if (!EVENT_CALLBACK_URL) return;
  try {
    await axios.post(EVENT_CALLBACK_URL, event, {
      timeout: 2500,
      headers: { "x-drone-event-token": EVENT_CALLBACK_KEY }
    });
  } catch (error) {
    console.warn(`[drone-service] event callback failed: ${error.response?.status || error.message}`);
  }
}

provider.on?.("event", (event) => {
  const id = event.mission?.id || "unknown";
  if (event.eventType !== "mission:telemetry") {
    console.log(`[drone-service][${id}] ${event.eventType}`);
  }
  forwardEvent(event).catch(() => {});
});

app.get("/health", (req, res) => {
  sendData(res, { service: "sanjeevani-drone-service", status: "up", mode: DRONE_MODE, checkedAt: new Date().toISOString() });
});

app.get("/api/drones", asyncRoute(async (req, res) => sendData(res, await provider.listDrones())));
app.get("/api/drones/:id", asyncRoute(async (req, res) => {
  const drone = await provider.getDrone(req.params.id);
  if (!drone) return res.status(404).json({ success: false, message: "Drone not found." });
  sendData(res, drone);
}));
app.get("/api/drones/:id/telemetry", asyncRoute(async (req, res) => {
  const drone = await provider.getDrone(req.params.id);
  if (!drone) return res.status(404).json({ success: false, message: "Drone not found." });
  sendData(res, drone);
}));
app.get("/api/drones/:id/video", asyncRoute(async (req, res) => {
  const drone = await provider.getDrone(req.params.id);
  if (!drone) return res.status(404).json({ success: false, message: "Drone not found." });
  sendData(res, { droneId: drone.id, status: drone.status, videoUrl: drone.videoUrl || null });
}));

app.get("/api/missions", asyncRoute(async (req, res) => sendData(res, await provider.listMissions())));

// Aerial network relay: expose the same forwarding contract as satellite and
// cellular link-nodes, while recording that the packet used a drone path.
app.post("/api/forward", requireRelay, asyncRoute(async (req, res) => {
  const request = {
    ...(req.body || {}),
    network: { ...(req.body?.network || {}), syncPath: "drone-relay", relayTransport: "aerial" }
  };
  const response = await axios.post(`${CLOUD_URL}/api/requests`, request, { timeout: 5000 });
  res.status(response.status).json(response.data);
}));
app.post("/api/forward-batch", requireRelay, asyncRoute(async (req, res) => {
  const requests = (Array.isArray(req.body?.requests) ? req.body.requests : []).map((request) => ({
    ...request,
    network: { ...(request.network || {}), syncPath: "drone-relay", relayTransport: "aerial" }
  }));
  const response = await axios.post(`${CLOUD_URL}/api/requests/batch`, { requests }, { timeout: 10000 });
  const forwarded = response.data?.stored || requests.map((request) => request.id).filter(Boolean);
  res.status(response.status).json({ success: true, forwarded, failed: [] });
}));
app.get("/api/missions/:id", asyncRoute(async (req, res) => {
  const mission = await provider.getMission(req.params.id);
  if (!mission) return res.status(404).json({ success: false, message: "Mission not found." });
  sendData(res, mission);
}));
app.post("/api/missions", requireControl, asyncRoute(async (req, res) => sendData(res, await provider.createMission(req.body || {}), 201)));
app.post("/api/missions/:id/approve", requireControl, asyncRoute(async (req, res) => sendData(res, await provider.approveMission(req.params.id))));
app.post("/api/missions/:id/launch", requireControl, asyncRoute(async (req, res) => sendData(res, await provider.launchMission(req.params.id, req.body?.droneId))));
app.post("/api/missions/:id/:action", requireControl, asyncRoute(async (req, res) => {
  sendData(res, await provider.action(req.params.id, req.params.action, req.body || {}));
}));

app.get("/video/:id", asyncRoute(async (req, res) => {
  const drone = await provider.getDrone(req.params.id);
  if (!drone) return res.status(404).send("Drone not found");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body{height:100%;margin:0;background:#061827;color:#e8f7ff;font-family:system-ui;overflow:hidden}.feed{position:relative;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 50% 55%,#176260 0,#0b3547 32%,#061827 72%)}.grid{position:absolute;inset:0;background-image:linear-gradient(#5ce1d41d 1px,transparent 1px),linear-gradient(90deg,#5ce1d41d 1px,transparent 1px);background-size:34px 34px;animation:move 6s linear infinite}.target{width:92px;height:92px;border:2px solid #65f3dc;border-radius:50%;box-shadow:0 0 28px #3fd2d077;position:relative}.target:before,.target:after{content:"";position:absolute;background:#65f3dc}.target:before{height:2px;width:136px;left:-24px;top:44px}.target:after{width:2px;height:136px;top:-24px;left:44px}.hud{position:absolute;inset:18px;display:flex;justify-content:space-between;align-items:flex-start;font-size:12px;text-transform:uppercase;letter-spacing:.1em}.live{color:#ff7184}.bottom{position:absolute;left:18px;right:18px;bottom:16px;display:flex;justify-content:space-between;font-size:12px}.scan{position:absolute;left:0;right:0;height:2px;background:#65f3dc88;box-shadow:0 0 20px #65f3dc;animation:scan 3s ease-in-out infinite}@keyframes scan{0%,100%{top:12%}50%{top:88%}}@keyframes move{to{background-position:34px 34px}}</style><script>setInterval(async()=>{try{const r=await fetch('/api/drones/${encodeURIComponent(drone.id)}');const j=await r.json();const d=j.data;document.querySelector('#state').textContent=d.status;document.querySelector('#telemetry').textContent='BAT '+Math.round(d.battery)+'%  ALT '+Math.round(d.altitude)+'m  SPD '+Math.round(d.speed)+'m/s';}catch{}},2000)</script></head><body><div class="feed"><div class="grid"></div><div class="scan"></div><div class="target"></div><div class="hud"><b>${drone.id} / EO-IR SIMULATION</b><b class="live">● LIVE</b></div><div class="bottom"><span id="state">${drone.status}</span><span id="telemetry">BAT ${Math.round(drone.battery)}% ALT ${Math.round(drone.altitude)}m SPD ${Math.round(drone.speed)}m/s</span></div></div></body></html>`);
}));

app.use((error, req, res, next) => {
  console.error(`[drone-service] ${error.stack || error.message}`);
  res.status(error.status || error.response?.status || 500).json({
    success: false,
    message: error.response?.data?.message || error.message || "Drone service error."
  });
});

app.listen(PORT, () => {
  console.log(`[drone-service] listening on ${PORT} mode=${DRONE_MODE}`);
});
