const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const axios = require("axios");
const cors = require("cors");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "coordinator-state.json");
const SYNC_QUEUE_FILE = path.join(DATA_DIR, "sync-queue.json");
const NETWORK_FILE = path.join(DATA_DIR, "network-state.json");
const HEALTH_POLL_TIMEOUT_MS = Number(process.env.HEALTH_POLL_TIMEOUT_MS || 1000);
const CLOUD_PULL_INTERVAL_MS = Number(process.env.CLOUD_PULL_INTERVAL_MS || 6000);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 5000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const staticPath = path.join(__dirname, "dist");
app.use(express.static(staticPath));

const ROLE_TEMPLATES = {
  hospital: {
    roleLabel: "Hospital Coordinator",
    dashboard: "hospital",
    accent: "blue",
    matchCategories: ["medical", "rescue"],
    matchKeywords: [
      "ambulance",
      "blood",
      "doctor",
      "hospital",
      "icu",
      "injury",
      "insulin",
      "medicine",
      "oxygen",
      "patient",
      "triage"
    ],
    fields: [
      numberField("bedsAvailable", "Beds available", 18, "beds", 0, 200),
      numberField("oxygenCylinders", "Oxygen cylinders", 42, "cyl", 0, 400),
      numberField("emergencyDoctors", "Emergency doctors", 8, "staff", 0, 80),
      numberField("ambulancesReady", "Ambulances ready", 3, "units", 0, 30),
      numberField("criticalPatients", "Critical patients", 7, "cases", 0, 120),
      numberField("medicineKits", "Medicine kits", 64, "kits", 0, 800)
    ],
    tasks: [
      task("Triage queue", "Sort incoming medical requests by severity", "active"),
      task("Ambulance dispatch", "Assign ambulances to high-priority pods", "pending"),
      task("Oxygen redistribution", "Move spare cylinders toward low-stock pods", "active")
    ],
    incidents: [
      incident("MED-214", "Insulin support needed near connected pod", "high", "assigned"),
      incident("MED-227", "Possible fracture case awaiting transport", "medium", "monitoring")
    ]
  },
  shelter: {
    roleLabel: "Shelter Camp Coordinator",
    dashboard: "shelter",
    accent: "green",
    matchCategories: ["shelter", "food", "water"],
    matchKeywords: [
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
    ],
    fields: [
      numberField("waterStockLitres", "Water stock", 4200, "litres", 0, 20000),
      numberField("foodPackets", "Food packets", 860, "packs", 0, 10000),
      numberField("occupancy", "People registered", 276, "people", 0, 5000),
      numberField("blankets", "Blankets available", 310, "items", 0, 8000),
      numberField("sanitationKits", "Sanitation kits", 138, "kits", 0, 5000),
      numberField("resourceShortageAlerts", "Shortage alerts", 2, "alerts", 0, 100)
    ],
    tasks: [
      task("Dry ration delivery", "Confirm food packet dispatch for nearby pods", "active"),
      task("Water refill route", "Schedule tanker refill and purification tablets", "pending"),
      task("Registration audit", "Update camp occupancy and family reunification list", "active")
    ],
    incidents: [
      incident("SHEL-108", "Water stock below evening buffer", "medium", "assigned"),
      incident("SHEL-116", "Temporary shelter requested for elderly group", "high", "monitoring")
    ]
  },
  workforce: {
    roleLabel: "Workforce Coordinator",
    dashboard: "workforce",
    accent: "purple",
    matchCategories: ["workforce", "volunteer", "food", "water", "shelter"],
    matchKeywords: [
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
    ],
    fields: [
      numberField("volunteersOnDuty", "Volunteers on duty", 34, "people", 0, 500),
      numberField("volunteersAvailable", "Volunteers available", 19, "people", 0, 500),
      numberField("pendingAssignments", "Pending assignments", 11, "jobs", 0, 250),
      numberField("shiftCoverage", "Shift coverage", 82, "%", 0, 100),
      numberField("skilledMedics", "Skilled medics", 6, "people", 0, 100),
      numberField("transportCrews", "Transport crews", 5, "crews", 0, 80)
    ],
    tasks: [
      task("Volunteer dispatch", "Assign available volunteers to open field tasks", "active"),
      task("Shift handover", "Prepare next 6-hour shift coverage", "pending"),
      task("Transport pairing", "Pair crews with supply and rescue vehicles", "active")
    ],
    incidents: [
      incident("WORK-041", "Four volunteers needed for supply loading", "medium", "assigned"),
      incident("WORK-052", "Night shift gap in outer coverage zone", "high", "monitoring")
    ]
  },
  fire: {
    roleLabel: "Fire Coordinator",
    dashboard: "fire",
    accent: "red",
    matchCategories: ["fire"],
    matchKeywords: [
      "burn",
      "electrical fire",
      "explosion",
      "fire",
      "flame",
      "hotspot",
      "smoke",
      "sprinkler",
      "wildfire"
    ],
    fields: [
      numberField("activeRescueAlerts", "Active fire/flood rescue alerts", 5, "alerts", 0, 100),
      numberField("blockedRoutes", "Blocked routes", 3, "routes", 0, 60),
      numberField("pumpsReady", "Rescue equipment ready", 14, "sets", 0, 100),
      numberField("criticalEvacuations", "Critical evacuations", 4, "zones", 0, 80),
      numberField("breathingKits", "Breathing kits", 22, "kits", 0, 200),
      numberField("waterTenderLevel", "Water tender level", 76, "%", 0, 100)
    ],
    tasks: [
      task("Evacuation lane", "Keep one safe exit lane open near smoke reports", "active"),
      task("Equipment check", "Validate breathing kits and pump readiness", "active"),
      task("Route block report", "Send blocked-route updates to rescue teams", "pending")
    ],
    incidents: [
      incident("FIRE-330", "Smoke sighted close to evacuation corridor", "critical", "assigned"),
      incident("FIRE-344", "Pump team requested for hotspot control", "high", "monitoring")
    ]
  },
  flood: {
    roleLabel: "Flood Rescue Coordinator",
    dashboard: "flood",
    accent: "teal",
    matchCategories: ["rescue", "flood"],
    matchKeywords: [
      "boat",
      "current",
      "flood",
      "life jacket",
      "marooned",
      "rescue",
      "river",
      "roof",
      "stranded",
      "trapped",
      "waterlogged"
    ],
    fields: [
      numberField("trappedPeopleCases", "Trapped people cases", 9, "cases", 0, 200),
      numberField("boatsAvailable", "Boats available", 6, "boats", 0, 80),
      numberField("rescueTeamsActive", "Rescue teams active", 5, "teams", 0, 100),
      numberField("completedRescues", "Completed rescues", 28, "people", 0, 1000),
      numberField("lifeJackets", "Life jackets", 74, "items", 0, 500),
      numberField("ropeKits", "Rope kits", 18, "kits", 0, 150)
    ],
    tasks: [
      task("Boat routing", "Assign boats to trapped people cases", "active"),
      task("Landing point", "Confirm safe landing points with nearby pods", "pending"),
      task("Rescue completion log", "Update completed rescues and unresolved cases", "active")
    ],
    incidents: [
      incident("FLOOD-501", "Two families reported stranded near high water", "critical", "assigned"),
      incident("FLOOD-518", "Boat access blocked by debris", "high", "monitoring")
    ]
  }
};

function numberField(id, label, value, unit, min, max) {
  return {
    id,
    label,
    value,
    unit,
    inputType: "number",
    min,
    max,
    updatedAt: new Date().toISOString()
  };
}

function task(title, detail, status) {
  return {
    id: crypto.randomUUID(),
    title,
    detail,
    status,
    updatedAt: new Date().toISOString()
  };
}

function incident(id, title, severity, status) {
  return {
    id,
    title,
    severity,
    status,
    updatedAt: new Date().toISOString()
  };
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCellTowers(cellTowerValue, connectedTowerValue) {
  const rawTowers = parseList(cellTowerValue);
  const names = parseList(connectedTowerValue);

  return rawTowers.map((entry, index) => {
    const [maybeName, maybeUrl] = entry.includes("=") ? entry.split("=", 2) : [names[index], entry];
    return {
      name: maybeName || `CELLTOWER-${index + 1}`,
      url: normalizeUrl(maybeUrl)
    };
  });
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (!["EACCES", "EPERM"].includes(error.code)) {
      throw error;
    }

    fs.copyFileSync(tmpPath, filePath);
    try {
      fs.unlinkSync(tmpPath);
    } catch (unlinkError) {
      // Best-effort cleanup. Some Windows workspaces deny unlinking immediately after copy.
    }
  }
}

function readJson(filePath, fallback) {
  ensureDataDir();

  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[coordinator] resetting invalid JSON file ${filePath}: ${error.message}`);
    writeJson(filePath, fallback);
    return fallback;
  }
}

function stateValueToBoolean(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "down" || value === "disabled" || value === "false") {
    return false;
  }

  if (value === "up" || value === "degraded" || value === "enabled" || value === "true") {
    return true;
  }

  return fallback;
}

const DEFAULT_NETWORK_STATE = {
  satelliteEnabled: true,
  cellularEnabled: true,
  meshEnabled: true
};

const PATH_TO_KEY = {
  satellite: "satelliteEnabled",
  cellular: "cellularEnabled",
  mesh: "meshEnabled"
};

const identity = {
  coordinatorId: process.env.COORDINATOR_ID || "COORDINATOR-LOCAL",
  coordinatorName: process.env.COORDINATOR_NAME || "Local Coordinator",
  role: String(process.env.COORDINATOR_ROLE || "shelter").toLowerCase(),
  region: process.env.COORDINATOR_REGION || "Region-Local",
  coverageNodes: parseList(process.env.COVERAGE_NODES || ""),
  satelliteUrl: normalizeUrl(process.env.SATELLITE_URL || "http://satellite:9100"),
  cellTowers: parseCellTowers(process.env.CELL_TOWERS || "", process.env.CONNECTED_TOWERS || ""),
  connectedTowers: parseList(process.env.CONNECTED_TOWERS || ""),
  neighbors: parseList(process.env.NEIGHBORS || "").map(normalizeUrl),
  simulationControllerUrl: normalizeUrl(
    process.env.SIMULATION_CONTROLLER_URL || "http://simulation-controller:9300"
  )
};

const roleTemplate = ROLE_TEMPLATES[identity.role] || ROLE_TEMPLATES.shelter;

function defaultState() {
  return {
    identity,
    fields: roleTemplate.fields,
    tasks: roleTemplate.tasks,
    incidents: roleTemplate.incidents,
    inbox: [],
    hazardUpdates: [
      {
        id: `${identity.coordinatorId}-weather-brief`,
        title: "Cloud weather bulletin",
        message: "Monitoring live cloud and mesh updates for role-matched hazards.",
        severity: "info",
        source: "cloud-api",
        transport: "pending",
        receivedAt: new Date().toISOString()
      }
    ],
    updatedAt: new Date().toISOString()
  };
}

function mergeState(saved) {
  const base = defaultState();
  const savedFields = Array.isArray(saved.fields) ? saved.fields : [];
  const savedFieldById = new Map(savedFields.map((field) => [field.id, field]));

  return {
    ...base,
    ...saved,
    identity,
    fields: base.fields.map((field) => ({
      ...field,
      ...(savedFieldById.get(field.id) || {})
    })),
    tasks: Array.isArray(saved.tasks) && saved.tasks.length ? saved.tasks : base.tasks,
    incidents: Array.isArray(saved.incidents) && saved.incidents.length ? saved.incidents : base.incidents,
    inbox: Array.isArray(saved.inbox) ? saved.inbox : [],
    hazardUpdates: Array.isArray(saved.hazardUpdates) ? saved.hazardUpdates : base.hazardUpdates
  };
}

function getState() {
  const state = mergeState(readJson(STATE_FILE, defaultState()));
  writeJson(STATE_FILE, state);
  return state;
}

function saveState(state) {
  const nextState = {
    ...state,
    identity,
    updatedAt: new Date().toISOString()
  };
  writeJson(STATE_FILE, nextState);
  return nextState;
}

function getNetworkState() {
  const raw = readJson(NETWORK_FILE, DEFAULT_NETWORK_STATE);
  const normalized = {
    satelliteEnabled: stateValueToBoolean(raw.satelliteEnabled ?? raw.satellite, true),
    cellularEnabled: stateValueToBoolean(raw.cellularEnabled ?? raw.cellular, true),
    meshEnabled: stateValueToBoolean(raw.meshEnabled ?? raw.mesh, true)
  };
  writeJson(NETWORK_FILE, normalized);
  return normalized;
}

function setNetworkPath(pathName, action) {
  const key = PATH_TO_KEY[pathName];
  if (!key) {
    throw new Error(`Unsupported network path: ${pathName}`);
  }

  const enabled = ["enable", "up", "restore"].includes(action)
    ? true
    : ["disable", "down", "fail"].includes(action)
      ? false
      : null;

  if (enabled === null) {
    throw new Error(`Unsupported network action: ${action}`);
  }

  const nextState = {
    ...getNetworkState(),
    [key]: enabled
  };
  writeJson(NETWORK_FILE, nextState);
  return nextState;
}

function getSyncQueue() {
  const queue = readJson(SYNC_QUEUE_FILE, []);
  return Array.isArray(queue) ? queue : [];
}

function replaceSyncQueue(queue) {
  writeJson(SYNC_QUEUE_FILE, Array.isArray(queue) ? queue : []);
}

function enqueueSyncEvent(event) {
  const queue = getSyncQueue();
  const existingIndex = queue.findIndex((item) => item.id === event.id);
  const queuedEvent = {
    ...event,
    queuedAt: event.queuedAt || new Date().toISOString()
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = {
      ...queue[existingIndex],
      ...queuedEvent,
      queueUpdatedAt: new Date().toISOString()
    };
  } else {
    queue.push(queuedEvent);
  }

  replaceSyncQueue(queue);
  return queuedEvent;
}

function removeSyncEvent(id) {
  const before = getSyncQueue();
  const after = before.filter((item) => item.id !== id);
  replaceSyncQueue(after);
  return before.length - after.length;
}

async function readLinkHealth(url) {
  try {
    const response = await axios.get(`${normalizeUrl(url)}/health`, {
      timeout: HEALTH_POLL_TIMEOUT_MS
    });
    return response.data?.status || "up";
  } catch (error) {
    if (error.response?.data?.status) {
      return error.response.data.status;
    }
    return "down";
  }
}

async function buildTowerStatuses() {
  return Promise.all(
    identity.cellTowers.map(async (tower) => ({
      name: tower.name,
      url: tower.url,
      status: await readLinkHealth(tower.url)
    }))
  );
}

function summarizeCellular(towerStatuses) {
  if (towerStatuses.length === 0) {
    return "not-configured";
  }

  const upCount = towerStatuses.filter((tower) => tower.status === "up").length;
  if (upCount === towerStatuses.length) {
    return "up";
  }
  if (upCount > 0) {
    return "degraded";
  }
  return "down";
}

function labelForNeighbor(neighborUrl) {
  try {
    return new URL(neighborUrl).hostname.toUpperCase();
  } catch (error) {
    return neighborUrl;
  }
}

async function inspectNeighborForRelay(neighborUrl) {
  const endpoints = ["/api/pod/relay-candidate", "/api/coordinator/relay-candidate"];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(`${neighborUrl}${endpoint}`, { timeout: 900 });
      const candidate = response.data?.data;
      if (candidate?.mode === "cloud") {
        return {
          url: neighborUrl,
          podId: candidate.podId || candidate.coordinatorId || labelForNeighbor(neighborUrl),
          podName: candidate.podName || candidate.coordinatorName || labelForNeighbor(neighborUrl),
          region: candidate.region || "neighbor",
          cloudPath: candidate.activePath || "cloud",
          activeCellTower: candidate.activeCellTower || null
        };
      }
    } catch (error) {
      // Try the next compatible endpoint.
    }
  }

  return null;
}

async function calculateMode() {
  const networkState = getNetworkState();
  const [satelliteStatus, towerStatuses] = await Promise.all([
    readLinkHealth(identity.satelliteUrl),
    buildTowerStatuses()
  ]);
  const cellularStatus = summarizeCellular(towerStatuses);
  const base = {
    satelliteStatus,
    cellularStatus,
    cellTowerStatuses: towerStatuses,
    healthLastCheckedAt: new Date().toISOString(),
    networkState
  };

  if (networkState.satelliteEnabled && satelliteStatus === "up") {
    return {
      ...base,
      mode: "cloud",
      activePath: "satellite",
      activeLink: {
        name: "satellite",
        type: "satellite",
        url: identity.satelliteUrl
      },
      activeCellTower: null,
      relayPod: null
    };
  }

  if (networkState.cellularEnabled) {
    const activeTower = towerStatuses.find((tower) => tower.status === "up");
    if (activeTower) {
      return {
        ...base,
        mode: "cloud",
        activePath: "cellular",
        activeLink: {
          name: activeTower.name,
          type: "cellular",
          url: activeTower.url
        },
        activeCellTower: activeTower.name,
        relayPod: null
      };
    }
  }

  if (networkState.meshEnabled) {
    for (const neighborUrl of identity.neighbors) {
      const relayPod = await inspectNeighborForRelay(neighborUrl);
      if (relayPod) {
        return {
          ...base,
          mode: "mesh-relay",
          activePath: "mesh",
          activeLink: null,
          activeCellTower: null,
          relayPod
        };
      }
    }
  }

  return {
    ...base,
    mode: "island",
    activePath: "none",
    activeLink: null,
    activeCellTower: null,
    relayPod: null
  };
}

function fieldValueForDisplay(field) {
  const unit = field.unit ? ` ${field.unit}` : "";
  return `${field.value}${unit}`;
}

function buildFieldUpdateEvent(field, state, route) {
  return {
    id: `coord-sync-${identity.coordinatorId}-${field.id}-${Date.now()}`,
    requestKind: "coordinator-field-update",
    podId: identity.coordinatorId,
    podName: identity.coordinatorName,
    coordinatorId: identity.coordinatorId,
    coordinatorName: identity.coordinatorName,
    coordinatorRole: identity.role,
    coordinatorRoleLabel: roleTemplate.roleLabel,
    category: roleTemplate.roleLabel,
    location: `${identity.region} | ${identity.coverageNodes.join(", ")}`,
    message: `${identity.coordinatorName} updated ${field.label} to ${fieldValueForDisplay(field)}.`,
    field: {
      id: field.id,
      label: field.label,
      value: field.value,
      unit: field.unit,
      updatedAt: field.updatedAt
    },
    state: {
      fields: state.fields.map((item) => ({
        id: item.id,
        label: item.label,
        value: item.value,
        unit: item.unit,
        updatedAt: item.updatedAt
      })),
      tasks: state.tasks,
      incidents: state.incidents
    },
    coverageNodes: identity.coverageNodes,
    network: {
      activePath: route?.activePath || "queued",
      mode: route?.mode || "queued"
    },
    createdAt: new Date().toISOString()
  };
}

function textForMatching(payload) {
  return [
    payload.category,
    payload.type,
    payload.hazard,
    payload.alertType,
    payload.title,
    payload.message,
    payload.detail,
    payload.location
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function routedTargets(payload) {
  const targets = [];
  if (Array.isArray(payload.routing?.targets)) {
    targets.push(...payload.routing.targets);
  }

  if (payload.routing?.targetCoordinator) {
    targets.push(payload.routing.targetCoordinator);
  }

  return targets
    .map((target) => ({
      id: String(target.id || target.targetCoordinatorId || target.coordinatorId || "").toLowerCase(),
      role: String(target.role || target.targetRole || "").toLowerCase()
    }))
    .filter((target) => target.id || target.role);
}

function targetMatchesIdentity(target) {
  if (target.id) {
    return target.id === identity.coordinatorId.toLowerCase();
  }

  return target.role === identity.role;
}

function matchesCoordinatorRole(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.targetCoordinatorId === identity.coordinatorId) {
    return true;
  }

  if (String(payload.targetRole || "").toLowerCase() === identity.role) {
    return true;
  }

  const explicitTargets = routedTargets(payload);
  if (explicitTargets.length) {
    return explicitTargets.some(targetMatchesIdentity);
  }

  const category = String(payload.category || payload.type || payload.hazard || "").toLowerCase();
  if (roleTemplate.matchCategories.includes(category)) {
    return true;
  }

  const text = textForMatching(payload);
  return roleTemplate.matchKeywords.some((keyword) => text.includes(keyword));
}

function normalizeSeverity(payload) {
  const raw = String(payload.severity || payload.triage?.severity || payload.priority || "").toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(raw)) {
    return raw;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric >= 8) return "critical";
    if (numeric >= 6) return "high";
    if (numeric >= 3) return "medium";
    return "low";
  }

  return payload.triage?.priority === "P1" ? "critical" : "medium";
}

function isHazardPayload(payload) {
  return Boolean(
    payload.hazard ||
      payload.alertType ||
      payload.requestKind === "hazard-update" ||
      payload.kind === "hazard" ||
      payload.type === "hazard"
  );
}

function storeIncoming(payload, meta = {}) {
  if (!matchesCoordinatorRole(payload)) {
    return {
      accepted: false,
      reason: "Request did not match this coordinator role."
    };
  }

  const state = getState();
  const receivedAt = new Date().toISOString();
  const routing = payload.routing || {};
  const route = payload.deliveryRoute || {};
  const classification = routing.classification || {};
  const targetCoordinator = routing.targetCoordinator || {};
  const departmentLabels = Array.isArray(classification.departments)
    ? classification.departments.map((department) => department.label || department.role).filter(Boolean)
    : Array.isArray(payload.requestTypes)
      ? payload.requestTypes
      : [];
  const item = {
    id: payload.id || `incoming-${crypto.randomUUID()}`,
    title:
      payload.title ||
      payload.hazard ||
      payload.category ||
      `${roleTemplate.roleLabel} request`,
    category: payload.category || payload.type || payload.hazard || roleTemplate.roleLabel,
    message: payload.message || payload.detail || "No message supplied.",
    location: payload.location || payload.region || "Unspecified location",
    severity: normalizeSeverity(payload),
    source: meta.source || payload.source || payload.forwardedBy || payload.podName || "pod-mesh",
    transport: meta.transport || payload.transport || payload.linkType || payload.network?.syncPath || "pod-mesh",
    sourcePodId: payload.podId || payload.sourcePodId || "",
    requester: payload.name || payload.requester || "",
    deliveryId: routing.deliveryId || payload.deliveryId || "",
    targetCoordinatorName: targetCoordinator.name || payload.targetCoordinatorName || identity.coordinatorName,
    targetRole: targetCoordinator.role || payload.targetRole || roleTemplate.dashboard,
    deliveryRoute: {
      transport: route.transport || meta.transport || payload.transport || "",
      linkName: route.linkName || payload.linkName || "",
      trigger: route.trigger || payload.trigger || "",
      sentAt: route.sentAt || payload.sentAt || ""
    },
    matchedDepartments: departmentLabels,
    routingSummary: classification.summary || departmentLabels.join(", ") || "",
    receivedAt,
    raw: payload
  };

  const existingItem = state.inbox.find((existing) => existing.id === item.id);
  const existingSeenVia = Array.isArray(existingItem?.seenVia)
    ? existingItem.seenVia
    : [existingItem?.transport].filter(Boolean);
  const shouldLogReceipt = !existingItem || !existingSeenVia.includes(item.transport);
  const mergedItem = existingItem
    ? {
        ...existingItem,
        ...item,
        source:
          existingItem.transport === "direct-pod-mesh" || existingItem.source === "nearby-pod-mesh"
            ? existingItem.source
            : item.source,
        transport:
          existingItem.transport === "direct-pod-mesh" ? existingItem.transport : item.transport,
        seenVia: Array.from(
          new Set([
            ...(Array.isArray(existingItem.seenVia) ? existingItem.seenVia : [existingItem.transport]),
            item.transport
          ].filter(Boolean))
        )
      }
    : {
        ...item,
        seenVia: [item.transport].filter(Boolean)
      };

  if (shouldLogReceipt) {
    console.log(
      `[coordinator][inbox][${identity.coordinatorId}][${item.id}] received ${item.category} request from ${
        item.sourcePodId || item.source || "cloud"
      } via ${item.transport}; target=${item.targetCoordinatorName}; route=${
        item.deliveryRoute.transport || item.transport
      }${item.deliveryRoute.linkName ? `/${item.deliveryRoute.linkName}` : ""}; title="${item.title}"`
    );
  }

  const inbox = state.inbox.filter((existing) => existing.id !== item.id);
  state.inbox = [mergedItem, ...inbox].slice(0, 80);

  if (isHazardPayload(payload)) {
    const hazardUpdates = state.hazardUpdates.filter((existing) => existing.id !== item.id);
    state.hazardUpdates = [mergedItem, ...hazardUpdates].slice(0, 40);
  }

  saveState(state);

  return {
    accepted: true,
    item: mergedItem
  };
}

async function forwardViaCloudLink(route, event) {
  if (!route.activeLink?.url) {
    throw new Error("No active cloud link is available.");
  }

  const response = await axios.post(`${route.activeLink.url}/api/forward`, event, {
    timeout: 2500
  });
  return response.data;
}

async function forwardViaMesh(route, event) {
  if (!route.relayPod?.url) {
    throw new Error("No mesh relay is available.");
  }

  const response = await axios.post(
    `${route.relayPod.url}/api/mesh/inbox`,
    {
      ...event,
      syncStatus: "relayed-over-direct-pod-mesh",
      meshLink: {
        fromPodId: identity.coordinatorId,
        toPodId: route.relayPod.podId,
        sentAt: new Date().toISOString()
      },
      relayedAt: new Date().toISOString()
    },
    { timeout: 4500 }
  );
  return response.data;
}

let activeSync = null;

async function runSync(trigger = "auto") {
  const queuedEvents = getSyncQueue();
  if (queuedEvents.length === 0) {
    return {
      success: true,
      trigger,
      synced: 0,
      failed: 0,
      remaining: 0,
      message: "Coordinator sync queue is empty."
    };
  }

  const route = await calculateMode();
  if (route.mode === "island") {
    return {
      success: true,
      trigger,
      mode: route.mode,
      activePath: route.activePath,
      synced: 0,
      failed: 0,
      remaining: queuedEvents.length,
      message: "Island mode active. Coordinator updates are retained locally."
    };
  }

  let synced = 0;
  let failed = 0;

  for (const event of queuedEvents) {
    try {
      const eventForSync = {
        ...event,
        syncAttemptAt: new Date().toISOString(),
        syncStatus:
          route.mode === "cloud"
            ? `synced-via-${route.activePath}`
            : "relayed-over-direct-pod-mesh",
        network: {
          ...(event.network || {}),
          syncMode: route.mode,
          syncPath: route.activePath,
          syncCellTower: route.activeCellTower || null,
          syncRelayPod: route.relayPod || null
        }
      };

      if (route.mode === "cloud") {
        await forwardViaCloudLink(route, eventForSync);
      } else if (route.mode === "mesh-relay") {
        await forwardViaMesh(route, eventForSync);
      }

      removeSyncEvent(event.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `[coordinator] ${identity.coordinatorId} kept ${event.id} in sync queue: ${error.message}`
      );
    }
  }

  return {
    success: failed === 0,
    trigger,
    mode: route.mode,
    activePath: route.activePath,
    synced,
    failed,
    remaining: getSyncQueue().length,
    message:
      synced > 0
        ? `Synced ${synced} coordinator update(s) through ${route.activePath}.`
        : "No coordinator updates could be synced."
  };
}

function syncOnce(trigger = "auto") {
  if (activeSync) {
    return activeSync;
  }

  activeSync = runSync(trigger).finally(() => {
    activeSync = null;
  });

  return activeSync;
}

async function pullCloudMessages(trigger = "auto") {
  const route = await calculateMode();
  if (route.mode !== "cloud" || !route.activeLink?.url) {
    return {
      success: true,
      trigger,
      pulled: 0,
      message: "No direct cloud path available for message pull."
    };
  }

  const query = new URLSearchParams({
    targetCoordinatorId: identity.coordinatorId,
    targetRole: identity.role,
    role: identity.role
  });
  let pulled = 0;

  try {
    const [messagesResponse, requestsResponse] = await Promise.all([
      axios.get(`${route.activeLink.url}/api/cloud/coordinator-messages?${query.toString()}`, {
        timeout: 2500
      }),
      axios.get(`${route.activeLink.url}/api/cloud/requests`, { timeout: 2500 })
    ]);

    for (const message of messagesResponse.data?.data || []) {
      const result = storeIncoming(message, {
        source: message.source || "cloud-api",
        transport: route.activePath
      });
      if (result.accepted) {
        pulled += 1;
      }
    }

    for (const request of requestsResponse.data?.data || []) {
      if (String(request.requestKind || "").startsWith("coordinator-")) {
        continue;
      }

      const result = storeIncoming(request, {
        source: "cloud-api",
        transport: request.linkType || route.activePath
      });
      if (result.accepted) {
        pulled += 1;
      }
    }

    return {
      success: true,
      trigger,
      pulled,
      activePath: route.activePath,
      message: `Pulled ${pulled} matching cloud message(s).`
    };
  } catch (error) {
    return {
      success: false,
      trigger,
      pulled,
      message: `Cloud message pull failed: ${error.message}`
    };
  }
}

function triggerSync(trigger) {
  setTimeout(() => {
    syncOnce(trigger).catch((error) => {
      console.warn(`[coordinator] ${identity.coordinatorId} sync trigger failed: ${error.message}`);
    });
  }, 150);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

app.get("/api/coordinator/status", async (req, res) => {
  const route = await calculateMode();
  const state = getState();

  res.json({
    success: true,
    data: {
      ...state,
      role: {
        id: identity.role,
        label: roleTemplate.roleLabel,
        dashboard: roleTemplate.dashboard,
        accent: roleTemplate.accent
      },
      network: {
        mode: route.mode,
        activePath: route.activePath,
        activeCellTower: route.activeCellTower,
        relayPod: route.relayPod,
        satelliteStatus: route.satelliteStatus,
        cellularStatus: route.cellularStatus,
        cellTowerStatuses: route.cellTowerStatuses,
        networkState: route.networkState
      },
      syncQueueCount: getSyncQueue().length,
      neighbors: identity.neighbors,
      coverageNodes: identity.coverageNodes,
      connectedTowers: identity.connectedTowers
    }
  });
});

app.get("/api/coordinator/relay-candidate", async (req, res) => {
  const route = await calculateMode();

  res.json({
    success: true,
    data: {
      coordinatorId: identity.coordinatorId,
      coordinatorName: identity.coordinatorName,
      podId: identity.coordinatorId,
      podName: identity.coordinatorName,
      region: identity.region,
      mode: route.mode === "cloud" ? "cloud" : route.mode,
      activePath: route.activePath,
      activeCellTower: route.activeCellTower,
      satelliteStatus: route.satelliteStatus,
      cellularStatus: route.cellularStatus,
      cellTowerStatuses: route.cellTowerStatuses,
      connectedTowers: identity.connectedTowers
    }
  });
});

app.get("/api/pod/relay-candidate", async (req, res) => {
  req.url = "/api/coordinator/relay-candidate";
  app.handle(req, res);
});

app.get("/api/gossip", async (req, res) => {
  const route = await calculateMode();
  const direct = route.mode === "cloud";

  res.json({
    success: true,
    podId: identity.coordinatorId,
    hopsToCloud: direct ? 0 : route.mode === "mesh-relay" ? 1 : 999,
    routePath: direct
      ? [identity.coordinatorId]
      : route.relayPod
        ? [identity.coordinatorId, route.relayPod.podId]
        : [identity.coordinatorId]
  });
});

app.patch("/api/coordinator/fields/:fieldId", async (req, res) => {
  const state = getState();
  const fieldIndex = state.fields.findIndex((field) => field.id === req.params.fieldId);

  if (fieldIndex < 0) {
    return res.status(404).json({
      success: false,
      message: "Unknown coordinator field."
    });
  }

  const field = state.fields[fieldIndex];
  const rawValue = req.body?.value;
  const nextValue =
    field.inputType === "number" && rawValue !== ""
      ? Number(rawValue)
      : String(rawValue ?? "").slice(0, 120);

  if (field.inputType === "number" && !Number.isFinite(nextValue)) {
    return res.status(400).json({
      success: false,
      message: "Numeric coordinator field requires a valid number."
    });
  }

  state.fields[fieldIndex] = {
    ...field,
    value: nextValue,
    updatedAt: new Date().toISOString()
  };

  const savedState = saveState(state);
  const route = await calculateMode();
  const event = enqueueSyncEvent(buildFieldUpdateEvent(savedState.fields[fieldIndex], savedState, route));
  triggerSync("field-update");

  res.json({
    success: true,
    message: "Field updated and queued for cloud sync.",
    data: {
      field: savedState.fields[fieldIndex],
      event,
      syncQueueCount: getSyncQueue().length
    }
  });
});

app.patch("/api/coordinator/tasks/:taskId", (req, res) => {
  const state = getState();
  const taskIndex = state.tasks.findIndex((taskItem) => taskItem.id === req.params.taskId);

  if (taskIndex < 0) {
    return res.status(404).json({
      success: false,
      message: "Unknown coordinator task."
    });
  }

  state.tasks[taskIndex] = {
    ...state.tasks[taskIndex],
    status: req.body?.status || state.tasks[taskIndex].status,
    updatedAt: new Date().toISOString()
  };

  const savedState = saveState(state);
  const event = enqueueSyncEvent({
    id: `coord-task-${identity.coordinatorId}-${req.params.taskId}-${Date.now()}`,
    requestKind: "coordinator-task-update",
    podId: identity.coordinatorId,
    podName: identity.coordinatorName,
    coordinatorId: identity.coordinatorId,
    coordinatorName: identity.coordinatorName,
    coordinatorRole: identity.role,
    category: roleTemplate.roleLabel,
    message: `${identity.coordinatorName} updated task ${state.tasks[taskIndex].title} to ${state.tasks[taskIndex].status}.`,
    task: state.tasks[taskIndex],
    createdAt: new Date().toISOString()
  });
  triggerSync("task-update");

  res.json({
    success: true,
    message: "Task updated and queued for cloud sync.",
    data: {
      task: savedState.tasks[taskIndex],
      event
    }
  });
});

function acceptCoordinatorInbox(req, res) {
  const payload = req.body || {};

  if (String(payload.requestKind || "").startsWith("coordinator-")) {
    enqueueSyncEvent({
      ...payload,
      id: payload.id || `coord-relay-${crypto.randomUUID()}`,
      relayedByCoordinator: identity.coordinatorId,
      relayedAt: new Date().toISOString()
    });
    triggerSync("mesh-coordinator-relay");

    return res.status(202).json({
      success: true,
      message: "Coordinator sync event accepted for mesh/cloud relay."
    });
  }

  const result = storeIncoming(payload, {
    source: payload.source || payload.podName || payload.forwardedBy || "nearby-pod",
    transport: payload.transport || payload.linkType || payload.network?.syncPath || "direct-pod-mesh"
  });

  if (!result.accepted) {
    console.log(
      `[coordinator][inbox][${identity.coordinatorId}] ignored ${payload.id || "unknown-request"}: ${result.reason}`
    );
    return res.status(202).json({
      success: true,
      accepted: false,
      message: result.reason
    });
  }

  res.status(202).json({
    success: true,
    accepted: true,
    message: "Role-matched request stored at coordinator.",
    data: result.item
  });
}

app.post("/api/coordinator/inbox", acceptCoordinatorInbox);
app.post("/api/mesh/inbox", acceptCoordinatorInbox);
app.post("/api/relay", acceptCoordinatorInbox);

app.get("/api/coordinator/inbox", (req, res) => {
  const state = getState();
  res.json({
    success: true,
    count: state.inbox.length,
    data: state.inbox
  });
});

app.post("/api/sync", async (req, res) => {
  const [syncResult, pullResult] = await Promise.all([
    syncOnce("manual"),
    pullCloudMessages("manual")
  ]);

  res.json({
    success: syncResult.success && pullResult.success,
    data: {
      sync: syncResult,
      cloudPull: pullResult
    }
  });
});

app.post("/api/network/:path/:state", async (req, res) => {
  try {
    const networkState = setNetworkPath(req.params.path, req.params.state);
    const route = await calculateMode();

    res.json({
      success: true,
      message: `${req.params.path} ${req.params.state} applied locally.`,
      data: {
        networkState,
        mode: route.mode,
        activePath: route.activePath,
        activeCellTower: route.activeCellTower,
        relayPod: route.relayPod
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.use((error, req, res, next) => {
  console.error(`[coordinator] unhandled error: ${error.stack || error.message}`);
  res.status(500).json({
    success: false,
    message: "Internal coordinator error."
  });
});

setInterval(() => {
  syncOnce("auto").catch((error) => {
    console.warn(`[coordinator] auto sync failed: ${error.message}`);
  });
}, SYNC_INTERVAL_MS);

setInterval(() => {
  pullCloudMessages("auto").catch((error) => {
    console.warn(`[coordinator] cloud pull failed: ${error.message}`);
  });
}, CLOUD_PULL_INTERVAL_MS);

app.listen(PORT, () => {
  getState();
  getNetworkState();
  console.log(
    `[coordinator] ${identity.coordinatorId} (${identity.coordinatorName}) listening on ${PORT}`
  );
  console.log(`[coordinator] role=${identity.role}, coverage=${identity.coverageNodes.join(", ")}`);
});
