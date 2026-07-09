const crypto = require("crypto");
const http = require("http");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const aiTriage = require("./services/aiTriage");
const webex = require("./services/webexNotifier");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});
const PORT = process.env.PORT || 9000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://mongodb:27017/sanjeevani-command-center";
const DELIVERY_RETRY_INTERVAL_MS = Number(process.env.DELIVERY_RETRY_INTERVAL_MS || 5000);
const requests = [];
const coordinatorEvents = [];
const coordinatorMessages = [];
const coordinatorDeliveries = [];
const sensorReadings = [];

// SANJEEVANI-Shield: the cloud is the only holder of the alert-signing
// private key. Pods fetch the public key once (through a link-node) and
// verify every alert locally with real Ed25519 — a forged or replayed
// alert is rejected at the pod even when it is fully offline.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubkeyDerHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
let alertSeq = 0;
const alertsSent = [];
let mongoConnected = false;

const looseSchemaOptions = {
  strict: false,
  timestamps: true,
  versionKey: false
};
const CloudRequest = mongoose.model("CloudRequest", new mongoose.Schema({}, looseSchemaOptions));
const CoordinatorEvent = mongoose.model("CoordinatorEvent", new mongoose.Schema({}, looseSchemaOptions));
const CoordinatorMessage = mongoose.model("CoordinatorMessage", new mongoose.Schema({}, looseSchemaOptions));
const CoordinatorDelivery = mongoose.model("CoordinatorDelivery", new mongoose.Schema({}, looseSchemaOptions));
const CloudAlert = mongoose.model("CloudAlert", new mongoose.Schema({}, looseSchemaOptions));
const SensorReading = mongoose.model("SensorReading", new mongoose.Schema({}, looseSchemaOptions));

const POD_URLS = String(process.env.POD_URLS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes("="))
  .map((entry) => {
    const [podId, url] = entry.split("=", 2);
    return { podId, url: url.replace(/\/+$/, "") };
  });

const DEFAULT_COORDINATORS = [
  {
    id: "FIRE-01",
    name: "FireDept",
    role: "fire",
    url: "http://fire-coordinator:8000",
    towers: ["CELLTOWER-1"]
  },
  {
    id: "HOSPITAL-01",
    name: "Hospital1",
    role: "hospital",
    url: "http://hospital-1-coordinator:8000",
    towers: ["CELLTOWER-1"]
  },
  {
    id: "HOSPITAL-02",
    name: "Hospital2",
    role: "hospital",
    url: "http://hospital-2-coordinator:8000",
    towers: []
  },
  {
    id: "SHELTER-A",
    name: "ShelterCampA",
    role: "shelter",
    url: "http://shelter-a-coordinator:8000",
    towers: []
  },
  {
    id: "SHELTER-B",
    name: "ShelterCampB",
    role: "shelter",
    url: "http://shelter-b-coordinator:8000",
    towers: ["CELLTOWER-1"]
  },
  {
    id: "SHELTER-C",
    name: "ShelterCamp2",
    role: "shelter",
    url: "http://shelter-c-coordinator:8000",
    towers: ["CELLTOWER-2"]
  },
  {
    id: "WORKFORCE-01",
    name: "WorkForceCamp1",
    role: "workforce",
    url: "http://workforce-1-coordinator:8000",
    towers: ["CELLTOWER-2"]
  },
  {
    id: "WORKFORCE-02",
    name: "WorkForceCamp2",
    role: "workforce",
    url: "http://workforce-2-coordinator:8000",
    towers: ["CELLTOWER-2"]
  },
  {
    id: "FLOOD-01",
    name: "FloodRescueDept",
    role: "flood",
    url: "http://flood-coordinator-1:8000",
    towers: []
  }
];

const ROUTING_RULES = {
  hospital: {
    label: "Hospital",
    categoryTerms: ["medical", "medicine", "health", "doctor", "hospital", "ambulance"],
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
      "unconscious"
    ]
  },
  flood: {
    label: "Flood Rescue",
    categoryTerms: ["flood"],
    keywords: [
      "boat",
      "current",
      "drowning",
      "flood",
      "flooded",
      "flooding",
      "life jacket",
      "marooned",
      "river",
      "roof",
      "stranded",
      "waterlogged"
    ]
  },
  shelter: {
    label: "Shelter",
    categoryTerms: ["shelter", "food", "water", "ration"],
    keywords: [
      "blanket",
      "camp",
      "drinking",
      "food",
      "meal",
      "packet",
      "ration",
      "relief camp",
      "shelter",
      "shortage",
      "stay",
      "tent",
      "water"
    ]
  },
  workforce: {
    label: "Workforce",
    categoryTerms: ["workforce", "volunteer"],
    keywords: [
      "carry",
      "crew",
      "delivery",
      "dispatch",
      "driver",
      "evacuate",
      "evacuation",
      "help move",
      "labour",
      "loading",
      "rescue team",
      "send people",
      "shift",
      "staff",
      "stretcher",
      "team",
      "transport",
      "volunteer",
      "worker"
    ]
  },
  fire: {
    label: "Fire Dept",
    categoryTerms: ["fire"],
    keywords: [
      "burn",
      "burning",
      "fire",
      "flame",
      "hotspot",
      "smoke",
      "sprinkler",
      "wildfire"
    ]
  }
};

const COORDINATORS = parseCoordinatorRegistry(process.env.COORDINATOR_URLS);
const CELL_TOWER_URLS = parseNamedUrls(
  process.env.CELL_TOWER_URLS ||
    "CELLTOWER-1=http://celltower-1:9201,CELLTOWER-2=http://celltower-2:9202"
);
const SATELLITE_URL = normalizeUrl(process.env.SATELLITE_URL || "http://satellite:9100");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

io.on("connection", (socket) => {
  socket.emit("cloud:hello", {
    service: "sanjeevani-cloud-api",
    mongoConnected,
    connectedAt: nowIso()
  });
  socket.emit("cloud:snapshot", realtimeSnapshot());
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNamedUrls(value) {
  return parseCsv(value)
    .filter((entry) => entry.includes("="))
    .map((entry) => {
      const [name, url] = entry.split("=", 2);
      return {
        name: String(name || "").trim().toUpperCase(),
        url: normalizeUrl(url)
      };
    })
    .filter((entry) => entry.name && entry.url);
}

function parseCoordinatorRegistry(value) {
  const entries = String(value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const parsed = entries
    .map((entry) => {
      const [id, name, role, url, towerList] = entry.split("|").map((part) => part.trim());
      if (!id || !role || !url) {
        return null;
      }

      return {
        id,
        name: name || id,
        role: String(role).toLowerCase(),
        url: normalizeUrl(url),
        towers: parseCsv(towerList).map((tower) => tower.toUpperCase())
      };
    })
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_COORDINATORS.map((item) => ({ ...item }));
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestTextForRouting(request) {
  return normalizeForMatch(
    [
      request.category,
      request.type,
      request.hazard,
      request.message,
      request.detail,
      request.details,
      request.description,
      request.emergency,
      request.emergencyText,
      request.emergencyDetails,
      request.tellMore,
      request.tellUsMore,
      request.notes,
      request.location,
      request.locationName,
      request.address,
      request.triage?.reason
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function hasTerm(text, term) {
  return text.includes(normalizeForMatch(term));
}

function severityNumber(request) {
  const raw = request.triage?.severity ?? request.severity ?? request.priority;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const word = String(raw || request.triage?.priority || "").toLowerCase();
  if (word === "critical") return 9;
  if (word === "high") return 7;
  if (word === "medium") return 5;
  if (word === "low") return 2;
  return 0;
}

function classifyCriticality(request) {
  const text = requestTextForRouting(request);
  const severity = severityNumber(request);
  const criticalTerms = [
    "bleeding",
    "blood loss",
    "breathing",
    "cardiac",
    "critical",
    "drowning",
    "heart",
    "icu",
    "life threatening",
    "pregnant",
    "severe",
    "stroke",
    "trapped",
    "unconscious"
  ];
  const matchedTerm = criticalTerms.find((term) => hasTerm(text, term));
  const explicitCritical = String(request.criticality || request.priority || "").toLowerCase() === "critical";
  const isCritical = request.isCritical === true || explicitCritical || severity >= 8 || Boolean(matchedTerm);

  return {
    isCritical,
    criticality: isCritical ? "critical" : "non-critical",
    criticalReason: isCritical
      ? severity >= 8
        ? `severity ${severity}`
        : `matched "${matchedTerm || "critical"}"`
      : "no critical indicators",
    severity: isCritical && severity < 8 ? 8 : severity
  };
}

function addRole(matchMap, role, evidence) {
  if (!matchMap.has(role)) {
    matchMap.set(role, {
      role,
      label: ROUTING_RULES[role]?.label || role,
      evidence: []
    });
  }

  if (evidence) {
    matchMap.get(role).evidence.push(evidence);
  }
}

function classifyRequest(request) {
  const categoryText = normalizeForMatch(request.category || request.type || "");
  const allText = requestTextForRouting(request);
  const matches = new Map();

  for (const [role, rule] of Object.entries(ROUTING_RULES)) {
    const categoryHit = rule.categoryTerms.find((term) => hasTerm(categoryText, term));
    if (categoryHit) {
      addRole(matches, role, `category matched "${categoryHit}"`);
    }

    const keywordHits = rule.keywords.filter((term) => hasTerm(allText, term)).slice(0, 4);
    for (const keyword of keywordHits) {
      addRole(matches, role, `emergency text matched "${keyword}"`);
    }
  }

  const severity = severityNumber(request);
  const needsFieldTeam =
    severity >= 7 &&
    ["evacuate", "evacuation", "rescue", "stranded", "trapped", "transport", "carry"].some((term) =>
      hasTerm(allText, term)
    );

  if (matches.has("flood") && (needsFieldTeam || hasTerm(allText, "boat") || hasTerm(allText, "stranded"))) {
    addRole(matches, "workforce", "flood rescue needs deployable field workers");
  }

  if (matches.has("fire") && (needsFieldTeam || hasTerm(allText, "evacuation"))) {
    addRole(matches, "workforce", "fire response needs evacuation/support crew");
  }

  if (matches.has("shelter") && ["delivery", "transport", "send", "distribute"].some((term) => hasTerm(allText, term))) {
    addRole(matches, "workforce", "supply/shelter request needs worker dispatch");
  }

  if (matches.size === 0) {
    addRole(matches, "shelter", "fallback: no specialist keywords found");
  }

  const roles = Array.from(matches.keys());
  const departments = Array.from(matches.values());

  return {
    roles,
    departments,
    summary: departments.map((item) => item.label).join(", "),
    severity,
    ...classifyCriticality(request)
  };
}

function coordinatorTargetsForClassification(classification) {
  return COORDINATORS.filter((coordinator) => classification.roles.includes(coordinator.role));
}

function toPlain(doc) {
  if (!doc) {
    return doc;
  }
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const { _id, createdAt, updatedAt, ...rest } = plain;
  return rest;
}

function defaultSensorReadings() {
  const stampedAt = nowIso();
  return [
    {
      id: "sensor-water-budameru-01",
      sensorId: "WL-01",
      label: "Budameru River Gauge",
      type: "water-level",
      value: 6.24,
      unit: "m",
      delta: 0.38,
      deltaLabel: "+0.38 m past 1h",
      status: "critical",
      risk: "high",
      zone: "Zone 1",
      locationName: "Budameru River Bridge",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [4.82, 4.95, 5.18, 5.31, 5.55, 5.72, 5.98, 6.08, 6.24]
    },
    {
      id: "sensor-risk-budameru-01",
      sensorId: "FR-01",
      label: "Flood Risk Index",
      type: "flood-risk",
      value: 0.82,
      unit: "score",
      delta: 0.07,
      deltaLabel: "+0.07 past 1h",
      status: "critical",
      risk: "high",
      zone: "Zone 1",
      locationName: "Varuna Hills Zone 1",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [0.48, 0.52, 0.57, 0.61, 0.66, 0.72, 0.78, 0.8, 0.82]
    },
    {
      id: "sensor-rainfall-zone-1",
      sensorId: "RF-04",
      label: "Rainfall Intensity",
      type: "rainfall",
      value: 42,
      unit: "mm/hr",
      delta: 11,
      deltaLabel: "+11 mm/hr past 1h",
      status: "warning",
      risk: "medium",
      zone: "Zone 1",
      locationName: "Varuna Hills Ridge",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [18, 21, 24, 28, 31, 35, 38, 40, 42]
    },
    {
      id: "sensor-soil-varuna-02",
      sensorId: "SM-02",
      label: "Soil Saturation",
      type: "soil-moisture",
      value: 82,
      unit: "%",
      delta: 6,
      deltaLabel: "+6% past 1h",
      status: "warning",
      risk: "medium",
      zone: "Zone 1",
      locationName: "Varuna Hills Slope",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [63, 65, 68, 70, 73, 76, 78, 80, 82]
    },
    {
      id: "sensor-flow-subiya-01",
      sensorId: "FL-03",
      label: "River Flow Velocity",
      type: "river-flow",
      value: 1380,
      unit: "m3/s",
      delta: 180,
      deltaLabel: "+180 m3/s past 1h",
      status: "critical",
      risk: "high",
      zone: "Zone 2",
      locationName: "Subiya River East Bridge",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [860, 910, 980, 1040, 1110, 1190, 1260, 1320, 1380]
    },
    {
      id: "sensor-wind-hills-01",
      sensorId: "WD-05",
      label: "Wind Gust",
      type: "wind",
      value: 36,
      unit: "km/h",
      delta: 4,
      deltaLabel: "+4 km/h past 1h",
      status: "stable",
      risk: "low",
      zone: "Zone 3",
      locationName: "Kothapalli Tower",
      source: "mongodb-dummy-seed",
      lastReadingAt: stampedAt,
      history: [24, 26, 29, 31, 30, 32, 34, 35, 36]
    }
  ];
}

function sensorTimeMs(sensor) {
  const value = sensor?.lastReadingAt || sensor?.sampledAt || sensor?.timestamp;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function latestSensorOfType(readings, type) {
  return readings
    .filter((reading) => reading.type === type)
    .sort((left, right) => sensorTimeMs(right) - sensorTimeMs(left))[0];
}

function sensorSummaryFrom(readings) {
  const sorted = [...readings].sort((left, right) => sensorTimeMs(right) - sensorTimeMs(left));
  const waterLevel = latestSensorOfType(sorted, "water-level");
  const rainfall = latestSensorOfType(sorted, "rainfall");
  const soil = latestSensorOfType(sorted, "soil-moisture");
  const riskSignal = latestSensorOfType(sorted, "flood-risk");
  const computedRisk = Math.min(
    1,
    Math.max(
      0,
      (Number(waterLevel?.value || 0) / 7.6) * 0.5 +
        (Number(rainfall?.value || 0) / 80) * 0.3 +
        (Number(soil?.value || 0) / 100) * 0.2
    )
  );
  const riskScore = Number(
    Number.isFinite(Number(riskSignal?.value)) ? Number(riskSignal.value).toFixed(2) : computedRisk.toFixed(2)
  );
  const riskLabel = riskScore >= 0.75 ? "HIGH" : riskScore >= 0.5 ? "ELEVATED" : "NORMAL";

  return {
    source: mongoConnected ? "mongodb" : "memory",
    reportingSensors: readings.length,
    criticalCount: readings.filter((reading) => ["critical", "danger"].includes(String(reading.status).toLowerCase())).length,
    warningCount: readings.filter((reading) => String(reading.status).toLowerCase() === "warning").length,
    riskScore,
    riskLabel,
    waterLevel,
    rainfall,
    lastReadingAt: sorted[0]?.lastReadingAt || nowIso()
  };
}

async function seedSensorReadings() {
  if (sensorReadings.length > 0) {
    return;
  }

  const seeded = defaultSensorReadings();
  sensorReadings.splice(0, sensorReadings.length, ...seeded);

  if (mongoConnected) {
    await Promise.all(
      seeded.map((reading) => persistDocument(SensorReading, { id: reading.id }, reading))
    );
  }

  console.log(
    `[cloud-api][sensors] seeded ${seeded.length} dummy sensor reading(s) into ${
      mongoConnected ? "MongoDB" : "memory fallback"
    }`
  );
}

function realtimeSnapshot() {
  return {
    requests,
    coordinatorEvents,
    coordinatorMessages,
    coordinatorDeliveries,
    sensorReadings,
    alerts: alertsSent,
    generatedAt: nowIso()
  };
}

function emitRealtime(type, payload) {
  const event = {
    type,
    payload,
    generatedAt: nowIso()
  };
  io.emit("cloud:update", event);
  io.emit(type, event);

  if (payload?.id) {
    console.log(`[cloud-api][socket][${payload.id}] emitted ${type} to command-center frontend`);
  }
}

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 5000)
    });
    mongoConnected = true;
    console.log(`[cloud-api] connected to MongoDB at ${MONGODB_URI}`);
  } catch (error) {
    mongoConnected = false;
    console.warn(`[cloud-api] MongoDB unavailable, using memory only: ${error.message}`);
  }
}

async function loadPersistedState() {
  if (!mongoConnected) {
    return;
  }

  const [storedRequests, storedEvents, storedMessages, storedDeliveries, storedAlerts, storedSensors] = await Promise.all([
    CloudRequest.find({}).sort({ cloudReceivedAt: -1, createdAt: -1 }).limit(300).lean(),
    CoordinatorEvent.find({}).sort({ cloudReceivedAt: -1, createdAt: -1 }).limit(300).lean(),
    CoordinatorMessage.find({}).sort({ cloudReceivedAt: -1, createdAt: -1 }).limit(300).lean(),
    CoordinatorDelivery.find({}).sort({ updatedAt: -1, queuedAt: -1 }).limit(600).lean(),
    CloudAlert.find({}).sort({ seq: -1, issuedAt: -1 }).limit(50).lean(),
    SensorReading.find({}).sort({ lastReadingAt: -1, createdAt: -1 }).limit(100).lean()
  ]);

  requests.splice(0, requests.length, ...storedRequests.map(toPlain));
  coordinatorEvents.splice(0, coordinatorEvents.length, ...storedEvents.map(toPlain));
  coordinatorMessages.splice(0, coordinatorMessages.length, ...storedMessages.map(toPlain));
  coordinatorDeliveries.splice(0, coordinatorDeliveries.length, ...storedDeliveries.map(toPlain));
  alertsSent.splice(0, alertsSent.length, ...storedAlerts.map(toPlain));
  sensorReadings.splice(0, sensorReadings.length, ...storedSensors.map(toPlain));
  alertSeq = alertsSent.reduce((max, alert) => Math.max(max, Number(alert.seq) || 0), alertSeq);
}

async function persistDocument(Model, filter, document) {
  if (!mongoConnected) {
    return false;
  }

  try {
    await Model.findOneAndUpdate(filter, { $set: document }, { upsert: true, new: true });
    return true;
  } catch (error) {
    console.warn(`[cloud-api] MongoDB write failed: ${error.message}`);
    return false;
  }
}

async function deleteDocuments(Model, filter) {
  if (!mongoConnected) {
    return false;
  }

  try {
    await Model.deleteMany(filter);
    return true;
  } catch (error) {
    console.warn(`[cloud-api] MongoDB delete failed: ${error.message}`);
    return false;
  }
}

async function readLinkHealth(url) {
  if (!url) {
    return "down";
  }

  try {
    const response = await axios.get(`${normalizeUrl(url)}/health`, { timeout: 1000 });
    return response.data?.status === "up" ? "up" : "down";
  } catch (error) {
    return "down";
  }
}

// Link health is cached briefly so a burst of requests (batch sync, crowd
// surge) doesn't trigger one satellite/tower health probe per SOS — a batch
// of 100 used to mean 300 sequential HTTP checks before any delivery.
const LINK_HEALTH_CACHE_MS = Number(process.env.LINK_HEALTH_CACHE_MS || 2500);
let deliveryLinksCache = { at: 0, value: null };

async function readDeliveryLinks() {
  if (deliveryLinksCache.value && Date.now() - deliveryLinksCache.at < LINK_HEALTH_CACHE_MS) {
    return deliveryLinksCache.value;
  }

  const [satelliteStatus, towerStatuses] = await Promise.all([
    readLinkHealth(SATELLITE_URL),
    Promise.all(
      CELL_TOWER_URLS.map(async (tower) => ({
        ...tower,
        status: await readLinkHealth(tower.url)
      }))
    )
  ]);

  const links = {
    satellite: {
      name: "satellite",
      type: "satellite",
      url: SATELLITE_URL,
      status: satelliteStatus
    },
    towers: towerStatuses
  };
  deliveryLinksCache = { at: Date.now(), value: links };
  return links;
}

function upsertDeliveryInMemory(delivery) {
  const existingIndex = coordinatorDeliveries.findIndex((item) => item.id === delivery.id);

  if (existingIndex >= 0) {
    coordinatorDeliveries[existingIndex] = {
      ...coordinatorDeliveries[existingIndex],
      ...delivery,
      updatedAt: nowIso()
    };
    return coordinatorDeliveries[existingIndex];
  }

  coordinatorDeliveries.unshift(delivery);
  coordinatorDeliveries.splice(600);
  return delivery;
}

async function persistDelivery(delivery, emit = true) {
  const stored = upsertDeliveryInMemory(delivery);
  await persistDocument(CoordinatorDelivery, { id: stored.id }, stored);

  if (emit) {
    emitRealtime("coordinator-delivery:updated", stored);
  }

  return stored;
}

function buildCoordinatorPayload(delivery, route) {
  return {
    ...delivery.payload,
    targetCoordinatorId: delivery.targetCoordinatorId,
    targetCoordinatorName: delivery.targetCoordinatorName,
    targetRole: delivery.targetRole,
    source: "cloud-command-center",
    transport: route.transport,
    deliveryRoute: {
      trigger: route.trigger,
      transport: route.transport,
      linkName: route.linkName,
      sentAt: nowIso()
    },
    routing: {
      ...(delivery.payload.routing || {}),
      deliveryId: delivery.id,
      classification: delivery.classification,
      targetCoordinator: {
        id: delivery.targetCoordinatorId,
        name: delivery.targetCoordinatorName,
        role: delivery.targetRole
      }
    }
  };
}

async function postToCoordinator(delivery, route) {
  const payload = buildCoordinatorPayload(delivery, route);
  const response = await axios.post(`${delivery.targetUrl}/api/coordinator/inbox`, payload, {
    timeout: 2800
  });

  return {
    status: response.status,
    accepted: response.data?.accepted !== false,
    message: response.data?.message || "delivered"
  };
}

function towerForTarget(target, links) {
  return target.towers
    .map((towerName) => links.towers.find((tower) => tower.name === towerName && tower.status === "up"))
    .find(Boolean);
}

async function attemptCoordinatorDelivery(delivery, links, trigger = "auto") {
  if (["delivered", "resolved", "rejected"].includes(delivery.status)) {
    return delivery;
  }

  const attempts = Array.isArray(delivery.attempts) ? delivery.attempts : [];
  const target = COORDINATORS.find((item) => item.id === delivery.targetCoordinatorId) || {
    id: delivery.targetCoordinatorId,
    name: delivery.targetCoordinatorName,
    role: delivery.targetRole,
    url: delivery.targetUrl,
    towers: delivery.targetTowers || []
  };

  const routeCandidates = [];
  if (links.satellite.status === "up") {
    routeCandidates.push({
      trigger,
      transport: "satellite",
      linkName: "satellite"
    });
  }

  const activeTower = towerForTarget(target, links);
  if (activeTower) {
    routeCandidates.push({
      trigger,
      transport: "cellular",
      linkName: activeTower.name
    });
  }

  if (routeCandidates.length === 0) {
    const queued = {
      ...delivery,
      status: "queued",
      lastReason: "No satellite path or matching cell tower path is currently online.",
      attempts: attempts.slice(-9),
      updatedAt: nowIso()
    };
    await persistDelivery(queued);
    return queued;
  }

  for (const route of routeCandidates) {
    try {
      const result = await postToCoordinator(delivery, route);

      // The coordinator's HTTP reply is the receipt. A 2xx with
      // accepted:false means it answered but refused the request (role
      // mismatch) — that is a permanent "rejected", never "delivered".
      if (!result.accepted) {
        const rejected = {
          ...delivery,
          status: "rejected",
          rejectedAt: nowIso(),
          lastReason: result.message || "Coordinator declined: request does not match its role.",
          attempts: [
            ...attempts,
            {
              at: nowIso(),
              trigger,
              status: "rejected",
              transport: route.transport,
              linkName: route.linkName,
              httpStatus: result.status
            }
          ].slice(-10),
          updatedAt: nowIso()
        };
        await persistDelivery(rejected);
        console.log(
          `[cloud-api][delivery][${delivery.requestId}] REJECTED by ${delivery.targetCoordinatorName}: ${rejected.lastReason}`
        );
        return rejected;
      }

      const delivered = {
        ...delivery,
        status: "delivered",
        deliveredAt: nowIso(),
        deliveredVia: route.transport,
        deliveredLink: route.linkName,
        lastReason: result.message,
        attempts: [
          ...attempts,
          {
            at: nowIso(),
            trigger,
            status: "delivered",
            transport: route.transport,
            linkName: route.linkName,
            httpStatus: result.status
          }
        ].slice(-10),
        updatedAt: nowIso()
      };

      await persistDelivery(delivered);
      console.log(
        `[cloud-api][delivery][${delivery.requestId}] sent to ${delivery.targetCoordinatorName} via ${route.transport}${
          route.linkName ? `/${route.linkName}` : ""
        }`
      );
      return delivered;
    } catch (error) {
      attempts.push({
        at: nowIso(),
        trigger,
        status: "failed",
        transport: route.transport,
        linkName: route.linkName,
        reason: error.response?.data?.message || error.message
      });
    }
  }

  const failed = {
    ...delivery,
    status: "queued",
    lastReason: attempts.at(-1)?.reason || "All delivery paths failed.",
    attempts: attempts.slice(-10),
    updatedAt: nowIso()
  };
  await persistDelivery(failed);
  return failed;
}

function buildDelivery(request, target, classification) {
  return {
    id: `${request.id}:${target.id}`,
    requestId: request.id,
    targetCoordinatorId: target.id,
    targetCoordinatorName: target.name,
    targetRole: target.role,
    targetUrl: target.url,
    targetTowers: target.towers,
    classification,
    status: "queued",
    queuedAt: nowIso(),
    updatedAt: nowIso(),
    attempts: [],
    payload: {
      ...request,
      routing: {
        ...(request.routing || {}),
        classification
      }
    }
  };
}

// Latest shortage level per coordinator field (from coordinator-resource-
// shortage events). Used to steer new deliveries away from out-of-stock
// teams while a same-role alternative still has capacity.
const coordinatorShortageLevels = new Map(); // coordinatorId -> Map(fieldId -> level)

function recordCoordinatorShortage(coordinatorId, fieldId, level) {
  const fields = coordinatorShortageLevels.get(coordinatorId) || new Map();
  if (level) {
    fields.set(fieldId, level);
  } else {
    fields.delete(fieldId);
  }
  coordinatorShortageLevels.set(coordinatorId, fields);
}

function coordinatorIsOutOfStock(coordinatorId) {
  const fields = coordinatorShortageLevels.get(coordinatorId);
  if (!fields) {
    return false;
  }
  return Array.from(fields.values()).includes("out-of-stock");
}

function targetsWithStock(targets, roles) {
  const finalTargets = [];

  for (const role of roles) {
    const roleTargets = targets.filter((target) => target.role === role);
    const stocked = roleTargets.filter((target) => !coordinatorIsOutOfStock(target.id));

    for (const skipped of roleTargets.filter((target) => !stocked.includes(target))) {
      console.log(
        `[cloud-api][routing] skipping ${skipped.name}: reported out-of-stock${
          stocked.length ? `; ${stocked.map((target) => target.name).join(", ")} covers ${role}` : ""
        }`
      );
    }

    // If every coordinator of this role is out of stock, deliver anyway —
    // a struggling responder is still better than silence.
    finalTargets.push(...(stocked.length ? stocked : roleTargets));
  }

  return finalTargets;
}

async function routeRequestToCoordinators(request, duplicate = false) {
  // EARLY-WARNING hazards are broadcast to every pod elsewhere, but the
  // responder coordinators (fire dept for wildfire smoke, flood rescue for
  // rising water, ...) still need a delivery, so they are routed here too.
  if (isCoordinatorEvent(request) || request.category === "SECURITY") {
    return [];
  }

  const classification = classifyRequest(request);

  // Hazard packs name their responder roles explicitly; trust that over
  // keyword guessing (earthquake/heatwave alert texts match no keywords,
  // which would otherwise fall back to shelter).
  const declaredRoles = Array.isArray(request.roles)
    ? request.roles.filter((role) => ROUTING_RULES[role])
    : [];
  if (declaredRoles.length > 0) {
    classification.roles = declaredRoles;
    classification.departments = declaredRoles.map((role) => ({
      role,
      label: ROUTING_RULES[role].label,
      evidence: [`hazard pack "${request.hazard || "hazard"}" names this responder role`]
    }));
    classification.summary = classification.departments.map((item) => item.label).join(", ");
  }

  // AI triage may have identified responder roles the keywords missed
  // ("chest feels heavy" -> hospital). Union them in: AI adds targets, it
  // never removes what the rules already matched — and it never overrides
  // a hazard pack's declared roles.
  const aiRoles =
    declaredRoles.length === 0 && Array.isArray(request.aiTriage?.roles)
      ? request.aiTriage.roles.filter(
          (role) => ROUTING_RULES[role] && !classification.roles.includes(role)
        )
      : [];
  if (aiRoles.length > 0) {
    classification.roles = [...classification.roles, ...aiRoles];
    classification.departments = [
      ...classification.departments,
      ...aiRoles.map((role) => ({
        role,
        label: ROUTING_RULES[role].label,
        evidence: [`AI triage: ${request.aiTriage.reason || "identified this responder role"}`]
      }))
    ];
    classification.summary = classification.departments.map((item) => item.label).join(", ");
  }
  const targets = targetsWithStock(
    coordinatorTargetsForClassification(classification),
    classification.roles
  );
  const targetSummary = targets.map((target) => ({
    id: target.id,
    name: target.name,
    role: target.role,
    towers: target.towers
  }));
  const routedRequest = {
    ...request,
    requestTypes: classification.departments.map((item) => item.label),
    routing: {
      ...(request.routing || {}),
      classification,
      targets: targetSummary,
      targetCount: targetSummary.length,
      plannedAt: nowIso()
    }
  };

  const requestIndex = requests.findIndex((item) => item.id === request.id);
  if (requestIndex >= 0) {
    requests[requestIndex] = routedRequest;
  }
  await persistDocument(CloudRequest, { id: routedRequest.id }, routedRequest);

  console.log(
    `[cloud-api][routing][${request.id}] identified as ${classification.summary}; targets=${targetSummary
      .map((target) => target.name)
      .join(", ") || "none"}`
  );

  if (targets.length === 0) {
    return [];
  }

  const links = await readDeliveryLinks();
  const deliveries = [];

  for (const target of targets) {
    const existingDelivery = coordinatorDeliveries.find(
      (delivery) => delivery.id === `${request.id}:${target.id}`
    );
    const baseDelivery =
      existingDelivery && duplicate
        ? {
            ...existingDelivery,
            payload: {
              ...routedRequest,
              routing: routedRequest.routing
            },
            classification,
            targetTowers: target.towers,
            targetUrl: target.url,
            updatedAt: nowIso()
          }
        : existingDelivery || buildDelivery(routedRequest, target, classification);

    const storedDelivery = await persistDelivery(baseDelivery, false);
    deliveries.push(await attemptCoordinatorDelivery(storedDelivery, links, duplicate ? "request-update" : "request-created"));
  }

  emitRealtime(duplicate ? "request:updated" : "request:routed", requests[requestIndex] || routedRequest);
  return deliveries;
}

// ---- AI triage (enhancer, never gatekeeper) --------------------------------
// The local LLM re-reads every citizen SOS AFTER it is stored, routed, and
// delivered. It can only confirm or UPGRADE severity — never downgrade — and
// it can add responder roles the keywords missed. If the model is slow, dead,
// or wrong, the keyword triage already did its job and nothing is blocked.

const aiTriageInFlight = new Set();
const AI_RETRY_SWEEP_MS = Number(process.env.AI_RETRY_SWEEP_MS || 60000);

function aiTriageEligible(request) {
  return (
    aiTriage.AI_ENABLED &&
    !isCoordinatorEvent(request) &&
    !["EARLY-WARNING", "SECURITY"].includes(request.category)
  );
}

async function applyAiTriage(request) {
  if (
    !request?.id ||
    !aiTriageEligible(request) ||
    request.aiTriage?.status === "complete" ||
    aiTriageInFlight.has(request.id)
  ) {
    return;
  }

  aiTriageInFlight.add(request.id);
  try {
    const verdict = await aiTriage.triageRequest(request);
    const index = requests.findIndex((item) => item.id === request.id);
    if (index < 0) {
      return; // request was deleted while the model was thinking
    }

    const current = requests[index];
    const ruleSeverity = severityNumber(current);
    const mergedSeverity = Math.max(ruleSeverity, verdict.severity);
    const upgraded = verdict.severity > ruleSeverity;
    const nowCritical = current.isCritical || mergedSeverity >= 8;

    requests[index] = {
      ...current,
      triage: {
        ...(current.triage || {}),
        severity: mergedSeverity,
        ...(upgraded ? { reason: verdict.reason || current.triage?.reason } : {})
      },
      isCritical: nowCritical,
      criticality: nowCritical ? "critical" : current.criticality,
      criticalReason: upgraded && nowCritical ? `AI triage: ${verdict.reason}` : current.criticalReason,
      aiTriage: {
        ...verdict,
        status: "complete",
        previousSeverity: ruleSeverity,
        upgraded
      },
      cloudUpdatedAt: nowIso()
    };

    await persistDocument(CloudRequest, { id: request.id }, requests[index]);
    emitRealtime("request:updated", requests[index]);
    console.log(
      `[cloud-api][ai][${request.id}] ${
        upgraded ? `UPGRADED severity ${ruleSeverity} -> ${verdict.severity}` : `confirmed severity ${ruleSeverity}`
      } (${verdict.model}, ${verdict.tookMs}ms): ${verdict.reason}`
    );

    // Re-route so responder roles the AI identified get a delivery and the
    // refreshed payload (with the AI severity) reaches coordinator queues.
    // Already-delivered coordinators are skipped by the delivery guard and
    // pick the upgrade up through their normal cloud pull.
    await routeRequestToCoordinators(requests[index], true);

    // The AI just turned a quiet request into a critical one — buzz the
    // responders' Webex space. (Dedup by id keeps requests that already
    // alerted at ingest silent here.)
    if (upgraded && nowCritical) {
      const refreshed = requests.find((item) => item.id === request.id);
      if (refreshed) {
        webex.notifyCriticalRequest(refreshed, { aiUpgraded: true });
      }
    }
  } catch (error) {
    const index = requests.findIndex((item) => item.id === request.id);
    if (index >= 0 && requests[index].aiTriage?.status !== "complete") {
      requests[index] = {
        ...requests[index],
        aiTriage: {
          status: "unavailable",
          model: aiTriage.AI_MODEL,
          error: String(error.message || error).slice(0, 200),
          evaluatedAt: nowIso()
        }
      };
      await persistDocument(CloudRequest, { id: request.id }, requests[index]);
      emitRealtime("request:updated", requests[index]);
    }
    console.warn(`[cloud-api][ai][${request.id}] triage unavailable, keeping rule-based verdict: ${error.message}`);
  } finally {
    aiTriageInFlight.delete(request.id);
  }
}

// Requests that arrived while the model was still loading (or Ollama was
// down) get retried here, a few per sweep so a backlog never floods the CPU.
async function retryPendingAiTriage() {
  const pending = requests
    .filter(
      (request) =>
        aiTriageEligible(request) &&
        request.aiTriage?.status !== "complete" &&
        !aiTriageInFlight.has(request.id)
    )
    .slice(0, 3);

  for (const request of pending) {
    await applyAiTriage(request);
  }
}

// ---- SITREP: AI situation report for the EOC operator ----------------------

let lastSitrep = null;

function isResolvedCloudRequest(request) {
  return (Array.isArray(request.resolutions) ? request.resolutions : []).some(
    (item) => item.status === "resolved"
  );
}

async function buildSitrepSnapshot() {
  const openCitizen = requests.filter(
    (request) => aiTriageEligible(request) && !isResolvedCloudRequest(request)
  );
  const shortages = [];
  for (const [coordinatorId, fields] of coordinatorShortageLevels.entries()) {
    for (const [fieldId, level] of fields.entries()) {
      const coordinator = COORDINATORS.find((item) => item.id === coordinatorId);
      shortages.push({
        coordinator: coordinator?.name || coordinatorId,
        role: coordinator?.role || "",
        resource: fieldId,
        level
      });
    }
  }
  const links = await readDeliveryLinks();

  return {
    generatedAt: nowIso(),
    network: {
      satellite: links.satellite.status,
      cellTowers: links.towers.map((tower) => ({ name: tower.name, status: tower.status }))
    },
    openRequests: openCitizen.slice(0, 15).map((request) => ({
      severity: severityNumber(request),
      critical: Boolean(request.isCritical),
      category: request.category || "",
      message: String(request.message || "").slice(0, 140),
      location: request.locationName || request.location || "",
      pod: request.podId || "",
      aiReason: request.aiTriage?.reason || ""
    })),
    counts: {
      open: openCitizen.length,
      critical: openCitizen.filter((request) => request.isCritical).length,
      queuedDeliveries: coordinatorDeliveries.filter(
        (delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status)
      ).length
    },
    shortages,
    recentAlerts: alertsSent.slice(0, 5).map((alert) => ({
      hazard: alert.hazard,
      message: String(alert.message || "").slice(0, 120),
      issuedAt: alert.issuedAt
    }))
  };
}

let activeDeliveryRetry = null;

async function retryQueuedDeliveries(trigger = "auto") {
  if (activeDeliveryRetry) {
    return activeDeliveryRetry;
  }

  activeDeliveryRetry = (async () => {
    const queued = coordinatorDeliveries.filter((delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status));
    if (queued.length === 0) {
      return { success: true, retried: 0, delivered: 0, remaining: 0 };
    }

    const links = await readDeliveryLinks();
    let delivered = 0;

    for (const delivery of queued) {
      const result = await attemptCoordinatorDelivery(delivery, links, trigger);
      if (result.status === "delivered") {
        delivered += 1;
      }
    }

    return {
      success: true,
      retried: queued.length,
      delivered,
      remaining: coordinatorDeliveries.filter((delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status)).length
    };
  })().finally(() => {
    activeDeliveryRetry = null;
  });

  return activeDeliveryRetry;
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
  alertsSent.splice(50);
  await persistDocument(CloudAlert, { id: record.id }, record);
  emitRealtime("alert:created", record);
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

async function upsertCoordinatorEvent(event, emit = true) {
  const storedEvent = {
    ...event,
    id: event.id || `coordinator-event-${Date.now()}-${crypto.randomUUID()}`,
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
    await persistDocument(CoordinatorEvent, { id: storedEvent.id }, coordinatorEvents[existingIndex]);
    if (emit) {
      emitRealtime("coordinator-event:updated", coordinatorEvents[existingIndex]);
    }
    return coordinatorEvents[existingIndex];
  }

  coordinatorEvents.unshift(storedEvent);
  await persistDocument(CoordinatorEvent, { id: storedEvent.id }, storedEvent);
  if (emit) {
    emitRealtime("coordinator-event:created", storedEvent);
  }
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

async function storeRequest(body) {
  const criticality = classifyCriticality(body || {});
  const request = {
    ...body,
    id: body.id || `cloud-request-${Date.now()}-${crypto.randomUUID()}`,
    cloudReceivedAt: nowIso(),
    triage: {
      ...(body.triage || {}),
      severity: criticality.severity || body.triage?.severity || body.severity || 0
    },
    isCritical: criticality.isCritical,
    criticality: criticality.criticality,
    criticalReason: criticality.criticalReason
  };
  console.log(
    `[cloud-api][backend][${request.id}] request reached backend from ${request.podId || "unknown-pod"}`
  );

  const existingIndex = requests.findIndex((item) => item.id && item.id === request.id);
  const duplicate = existingIndex >= 0;

  if (duplicate) {
    const existingSeverity = severityNumber(requests[existingIndex]);
    const incomingSeverity = severityNumber(request);
    requests[existingIndex] = {
      ...requests[existingIndex],
      ...request,
      // The same request arriving again (mesh re-delivery, pod re-sync)
      // must NOT reset when the cloud first received it, or every entry
      // shows "just now" and resolutions/routing already stored are lost.
      cloudReceivedAt: requests[existingIndex].cloudReceivedAt || request.cloudReceivedAt,
      resolutions: requests[existingIndex].resolutions || request.resolutions,
      routing: requests[existingIndex].routing || request.routing,
      // A re-arrival still carries the origin pod's keyword severity — it
      // must never downgrade a severity the AI (or a rule) already raised.
      triage: {
        ...(requests[existingIndex].triage || {}),
        ...(request.triage || {}),
        severity: Math.max(existingSeverity, incomingSeverity)
      },
      isCritical: requests[existingIndex].isCritical || request.isCritical,
      criticality:
        requests[existingIndex].criticality === "critical" ? "critical" : request.criticality,
      cloudUpdatedAt: nowIso()
    };
  } else {
    requests.unshift(request);
  }

  const storedRequest = duplicate ? requests[existingIndex] : request;
  const savedToMongo = await persistDocument(CloudRequest, { id: storedRequest.id }, storedRequest);
  console.log(
    `[cloud-api][mongodb][${storedRequest.id}] ${
      savedToMongo ? "saved request to MongoDB" : "request not saved to MongoDB; memory fallback active"
    }`
  );
  emitRealtime(duplicate ? "request:updated" : "request:created", storedRequest);

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
  // to every pod, and buzz the responders' Webex space.
  if (!duplicate && request.category === "EARLY-WARNING") {
    broadcastAlert({
      hazard: request.hazard || "hazard",
      message: request.message,
      scope: "all"
    }).catch((error) => console.warn(`[cloud-api] broadcast failed: ${error.message}`));
    webex.notifyEarlyWarning(storedRequest);
  }


  if (!duplicate && request.category === "SECURITY") {
    console.log(`[cloud-api] SECURITY EVENT from ${request.podId}: ${request.message}`);
  }

  if (isCoordinatorEvent(request)) {
    const storedEvent = await upsertCoordinatorEvent(request);
    console.log(
      `[cloud-api] coordinator event ${storedEvent.id || "unknown-event"} from ${
        storedEvent.coordinatorId || storedEvent.podId || "unknown-coordinator"
      }`
    );

    // A coordinator ran out of (or recovered) a resource — surface it as its
    // own realtime signal so the Command Center can flag the coordinator and
    // operators can reroute new requests to a team that still has stock.
    // A coordinator acknowledged/resolved a request in the field — reflect it
    // on the delivery board and the request record so operators see closure.
    if (request.requestKind === "coordinator-request-resolution" && request.requestId) {
      const resolutionAt = request.createdAt || nowIso();
      const deliveryId = `${request.requestId}:${request.coordinatorId}`;
      const delivery = coordinatorDeliveries.find((item) => item.id === deliveryId);
      if (delivery) {
        await persistDelivery({
          ...delivery,
          status: request.resolutionStatus === "resolved" ? "resolved" : delivery.status,
          resolutionStatus: request.resolutionStatus,
          resolutionAt,
          lastReason: request.message,
          updatedAt: nowIso()
        });
      }

      const requestIndex = requests.findIndex((item) => item.id === request.requestId);
      if (requestIndex >= 0) {
        const resolutions = Array.isArray(requests[requestIndex].resolutions)
          ? requests[requestIndex].resolutions.filter(
              (item) => item.coordinatorId !== request.coordinatorId
            )
          : [];
        resolutions.push({
          coordinatorId: request.coordinatorId,
          coordinatorName: request.coordinatorName,
          status: request.resolutionStatus,
          at: resolutionAt
        });
        requests[requestIndex] = {
          ...requests[requestIndex],
          resolutions,
          resolutionSummary: resolutions
            .map((item) => `${item.coordinatorName || item.coordinatorId}: ${item.status}`)
            .join("; "),
          cloudUpdatedAt: nowIso()
        };
        await persistDocument(CloudRequest, { id: request.requestId }, requests[requestIndex]);
        emitRealtime("request:updated", requests[requestIndex]);
      }

      console.log(
        `[cloud-api] ${request.coordinatorName || request.coordinatorId} ${request.resolutionStatus} request ${request.requestId}`
      );
    }

    if (request.requestKind === "coordinator-resource-shortage") {
      const shortageCoordinatorId = request.coordinatorId || request.podId;
      if (shortageCoordinatorId && request.field?.id) {
        recordCoordinatorShortage(shortageCoordinatorId, request.field.id, request.shortageLevel || null);
      }
      if (request.shortageLevel) {
        console.warn(
          `[cloud-api] RESOURCE ${request.shortageLevel.toUpperCase()} at ${
            request.coordinatorName || request.coordinatorId
          }: ${request.message}`
        );
      }
      emitRealtime("coordinator-shortage:updated", storedEvent);
    }
  }

  await routeRequestToCoordinators(storedRequest, duplicate);
  const routedRequest = requests.find((item) => item.id === storedRequest.id) || storedRequest;

  // A citizen SOS that is critical at ingest buzzes the responders' Webex
  // space right away (after routing, so the alert can name the targets); one
  // the AI upgrades later alerts from the triage worker instead.
  if (!duplicate && !isCoordinatorEvent(request) && !["EARLY-WARNING", "SECURITY"].includes(request.category) && routedRequest.isCritical) {
    webex.notifyCriticalRequest(routedRequest);
  }

  // Fire-and-forget: the SOS is already stored, queued, and delivered before
  // the model ever sees it. A slow or dead model can never block an SOS.
  applyAiTriage(routedRequest).catch(
    (error) => console.warn(`[cloud-api][ai] background triage failed: ${error.message}`)
  );

  return {
    request: requests.find((item) => item.id === storedRequest.id) || storedRequest,
    duplicate
  };
}

function defaultUserRequests() {
  const now = Date.now();
  return [
    {
      id: "demo-medical-001",
      podId: "POD-03",
      podName: "Pod 3",
      category: "Medical",
      name: "Pregnant woman needs ambulance",
      message: "Pregnant woman is in labor with breathing difficulty. Need ambulance, doctor and hospital support immediately.",
      locationName: "Kothapalli, Zone 3",
      location: "Kothapalli Relief Street",
      cloudReceivedAt: new Date(now - 6 * 60 * 1000).toISOString(),
      triage: { severity: 9, reason: "Labor pain and breathing issue" },
      source: "mongodb-demo-seed"
    },
    {
      id: "demo-rescue-001",
      podId: "POD-06",
      podName: "Pod 6",
      category: "Rescue",
      name: "Family stranded on roof",
      message: "Flood water is rising near the river. Four people are stranded on a roof and need boat rescue with field workers.",
      locationName: "Subiya River Bank, Zone 1",
      location: "Subiya River eastern bridge",
      cloudReceivedAt: new Date(now - 14 * 60 * 1000).toISOString(),
      triage: { severity: 8, reason: "Stranded in flood water" },
      source: "mongodb-demo-seed"
    },
    {
      id: "demo-supplies-001",
      podId: "POD-05",
      podName: "Pod 5",
      category: "Supplies",
      name: "Water and food packets required",
      message: "Relief camp has a shortage of drinking water, food packets and blankets. Please dispatch volunteer workers for delivery.",
      locationName: "Shelter Camp B, Zone 2",
      location: "Shelter Camp B",
      cloudReceivedAt: new Date(now - 27 * 60 * 1000).toISOString(),
      triage: { severity: 6, reason: "Relief supplies shortage" },
      source: "mongodb-demo-seed"
    },
    {
      id: "demo-shelter-001",
      podId: "POD-08",
      podName: "Pod 8",
      category: "Shelter",
      name: "Elderly people need shelter transfer",
      message: "Eight elderly people need safe stay at a shelter camp. Send workers for evacuation and transport.",
      locationName: "Varuna Hills, Zone 1",
      location: "Varuna Hills residential block",
      cloudReceivedAt: new Date(now - 42 * 60 * 1000).toISOString(),
      triage: { severity: 7, reason: "Shelter and evacuation required" },
      source: "mongodb-demo-seed"
    }
  ];
}

async function seedDemoUserRequests() {
  const demoRequests = defaultUserRequests();
  const missing = demoRequests.filter((request) => !requests.some((item) => item.id === request.id));

  if (missing.length === 0) {
    return;
  }

  for (const request of missing) {
    await storeRequest(request);
  }

  console.log(`[cloud-api][requests] seeded ${missing.length} demo user request(s) into MongoDB`);
}

async function upsertSensorReading(body, emit = true) {
  const reading = {
    ...body,
    id: body.id || `sensor-reading-${Date.now()}-${crypto.randomUUID()}`,
    sensorId: body.sensorId || body.id || `SEN-${Date.now()}`,
    source: body.source || "api",
    lastReadingAt: body.lastReadingAt || nowIso()
  };
  const existingIndex = sensorReadings.findIndex((item) => item.id === reading.id);

  if (existingIndex >= 0) {
    sensorReadings[existingIndex] = {
      ...sensorReadings[existingIndex],
      ...reading
    };
  } else {
    sensorReadings.unshift(reading);
  }

  sensorReadings.sort((left, right) => sensorTimeMs(right) - sensorTimeMs(left));
  sensorReadings.splice(100);

  const storedReading = sensorReadings.find((item) => item.id === reading.id) || reading;
  const savedToMongo = await persistDocument(SensorReading, { id: storedReading.id }, storedReading);
  console.log(
    `[cloud-api][sensors][${storedReading.id}] ${
      savedToMongo ? "saved sensor reading to MongoDB" : "sensor reading stored in memory fallback"
    }`
  );

  if (emit) {
    emitRealtime("sensor:updated", {
      ...storedReading,
      summary: sensorSummaryFrom(sensorReadings)
    });
  }

  return storedReading;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: {
      service: "sanjeevani-cloud-api",
      status: "up",
      database: mongoConnected ? "mongodb" : "memory",
      receivedRequests: requests.length,
      coordinatorEvents: coordinatorEvents.length,
      coordinatorMessages: coordinatorMessages.length,
      coordinatorDeliveries: coordinatorDeliveries.length,
      queuedCoordinatorDeliveries: coordinatorDeliveries.filter((delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status)).length,
      sensorReadings: sensorReadings.length,
      alertsSent: alertsSent.length,
      checkedAt: nowIso()
    }
  });
});

app.get("/api/ai/health", async (req, res) => {
  res.json({ success: true, data: await aiTriage.aiHealth() });
});

app.get("/api/webex/health", async (req, res) => {
  res.json({ success: true, data: await webex.webexHealth() });
});

// Demo-rehearsal helper: posts a harmless test alert into the bot's spaces.
app.post("/api/webex/test", async (req, res) => {
  try {
    const result = await webex.sendTestAlert();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(503).json({ success: false, message: error.message });
  }
});

// AI situation report: the operator presses one button and gets a 30-second
// plain-English SITREP built only from facts already in the cloud store.
app.post("/api/sitrep", async (req, res) => {
  try {
    const snapshot = await buildSitrepSnapshot();
    const sitrep = await aiTriage.generateSitrep(snapshot);
    lastSitrep = { ...sitrep, facts: snapshot.counts };
    console.log(`[cloud-api][ai] SITREP generated in ${sitrep.tookMs}ms (${snapshot.counts.open} open requests)`);
    res.json({ success: true, data: lastSitrep });
  } catch (error) {
    console.warn(`[cloud-api][ai] SITREP failed: ${error.message}`);
    res.status(503).json({
      success: false,
      message: `AI situation report unavailable: ${error.message}`
    });
  }
});

app.get("/api/sitrep", (req, res) => {
  res.json({ success: true, data: lastSitrep });
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

app.get("/api/sensors", (req, res) => {
  const data = [...sensorReadings].sort((left, right) => sensorTimeMs(right) - sensorTimeMs(left));
  res.json({
    success: true,
    count: data.length,
    data: {
      readings: data,
      summary: sensorSummaryFrom(data)
    }
  });
});

app.post("/api/sensors", async (req, res) => {
  const reading = await upsertSensorReading(req.body || {});
  res.status(201).json({
    success: true,
    message: "Sensor reading stored in cloud API.",
    data: {
      reading,
      summary: sensorSummaryFrom(sensorReadings)
    },
    count: sensorReadings.length
  });
});

app.post("/api/requests", async (req, res) => {
  const { request, duplicate } = await storeRequest(req.body || {});
  res.status(duplicate ? 200 : 201).json({
    success: true,
    message: duplicate ? "Request already existed; cloud API updated it." : "Request stored in cloud API.",
    data: request,
    count: requests.length
  });
});

app.post("/api/requests/batch", async (req, res) => {
  const items = Array.isArray(req.body?.requests) ? req.body.requests : [];
  const stored = [];
  for (const item of items) {
    const result = await storeRequest(item);
    stored.push(result.request.id);
  }
  res.status(201).json({ success: true, stored, count: requests.length });
});

app.get("/api/requests", (req, res) => {
  res.json({
    success: true,
    count: requests.length,
    data: requests
  });
});

app.delete("/api/requests/:id", async (req, res) => {
  const requestId = req.params.id;
  const existingIndex = requests.findIndex((request) => request.id === requestId);

  if (existingIndex < 0) {
    return res.status(404).json({
      success: false,
      message: "Request not found."
    });
  }

  const [removed] = requests.splice(existingIndex, 1);
  const beforeDeliveryCount = coordinatorDeliveries.length;
  for (let index = coordinatorDeliveries.length - 1; index >= 0; index -= 1) {
    if (coordinatorDeliveries[index].requestId === requestId) {
      coordinatorDeliveries.splice(index, 1);
    }
  }

  const requestDeleted = await deleteDocuments(CloudRequest, { id: requestId });
  const deliveriesDeleted = await deleteDocuments(CoordinatorDelivery, { requestId });

  console.log(
    `[cloud-api][delete][${requestId}] removed request and ${
      beforeDeliveryCount - coordinatorDeliveries.length
    } coordinator delivery record(s)`
  );
  emitRealtime("request:deleted", {
    id: requestId,
    removed,
    requestDeleted,
    deliveriesDeleted,
    removedDeliveryCount: beforeDeliveryCount - coordinatorDeliveries.length
  });

  res.json({
    success: true,
    message: "Request removed from cloud API and MongoDB.",
    data: {
      id: requestId,
      removedDeliveryCount: beforeDeliveryCount - coordinatorDeliveries.length
    }
  });
});

app.get("/api/coordinator-deliveries", (req, res) => {
  const requestId = String(req.query.requestId || "");
  const status = String(req.query.status || "");
  const filtered = coordinatorDeliveries.filter((delivery) => {
    if (requestId && delivery.requestId !== requestId) {
      return false;
    }

    if (status && delivery.status !== status) {
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

app.post("/api/coordinator-deliveries/retry", async (req, res) => {
  const result = await retryQueuedDeliveries("manual");
  res.json({
    success: true,
    data: result
  });
});

app.post("/api/coordinator-events", async (req, res) => {
  const storedEvent = await upsertCoordinatorEvent({
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

app.post("/api/coordinator-messages", async (req, res) => {
  const message = {
    ...req.body,
    id: req.body?.id || `cloud-message-${Date.now()}-${crypto.randomUUID()}`,
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

  const storedMessage = existingIndex >= 0 ? coordinatorMessages[existingIndex] : message;
  await persistDocument(CoordinatorMessage, { id: storedMessage.id }, storedMessage);
  emitRealtime(existingIndex >= 0 ? "coordinator-message:updated" : "coordinator-message:created", storedMessage);

  res.status(existingIndex >= 0 ? 200 : 201).json({
    success: true,
    message:
      existingIndex >= 0
        ? "Coordinator message updated in cloud API."
        : "Coordinator message stored in cloud API.",
    data: storedMessage,
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

async function start() {
  await connectMongo();
  await loadPersistedState();
  await seedSensorReadings();
  await seedDemoUserRequests();

  server.listen(PORT, () => {
    console.log(
      `[cloud-api] listening on ${PORT} (alert signing: ed25519, ${POD_URLS.length} pods registered)`
    );
    console.log(
      `[cloud-api] coordinator routing ready: ${COORDINATORS.length} coordinators, satellite=${SATELLITE_URL}, towers=${CELL_TOWER_URLS.map((tower) => tower.name).join(", ")}`
    );
  });

  setInterval(() => {
    retryQueuedDeliveries("auto").catch((error) => {
      console.warn(`[cloud-api] coordinator delivery retry failed: ${error.message}`);
    });
  }, DELIVERY_RETRY_INTERVAL_MS);

  if (aiTriage.AI_ENABLED) {
    aiTriage.aiHealth().then((health) => {
      console.log(`[cloud-api][ai] model=${health.model} status=${health.status} at ${health.url}`);
    });
    setInterval(() => {
      retryPendingAiTriage().catch((error) => {
        console.warn(`[cloud-api][ai] retry sweep failed: ${error.message}`);
      });
    }, AI_RETRY_SWEEP_MS);
  }
}

start().catch((error) => {
  console.error(`[cloud-api] failed to start: ${error.stack || error.message}`);
  process.exit(1);
});
