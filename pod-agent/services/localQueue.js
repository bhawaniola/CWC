const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const NETWORK_FILE = path.join(DATA_DIR, "network-state.json");

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

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
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
    console.warn(`[localQueue] resetting invalid JSON file ${filePath}: ${error.message}`);
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

function normalizeNetworkState(candidate) {
  return {
    satelliteEnabled: stateValueToBoolean(
      candidate?.satelliteEnabled ?? candidate?.satellite,
      DEFAULT_NETWORK_STATE.satelliteEnabled
    ),
    cellularEnabled: stateValueToBoolean(
      candidate?.cellularEnabled ?? candidate?.cellular,
      DEFAULT_NETWORK_STATE.cellularEnabled
    ),
    meshEnabled: stateValueToBoolean(
      candidate?.meshEnabled ?? candidate?.mesh,
      DEFAULT_NETWORK_STATE.meshEnabled
    )
  };
}

function getQueue() {
  const queue = readJson(QUEUE_FILE, []);
  return Array.isArray(queue) ? queue : [];
}

function replaceQueue(queue) {
  writeJson(QUEUE_FILE, Array.isArray(queue) ? queue : []);
}

function enqueue(request) {
  const queue = getQueue();
  const existingIndex = queue.findIndex((item) => item.id === request.id);

  if (existingIndex >= 0) {
    queue[existingIndex] = {
      ...queue[existingIndex],
      ...request,
      queueUpdatedAt: new Date().toISOString()
    };
  } else {
    queue.push({
      ...request,
      queuedAt: request.queuedAt || new Date().toISOString()
    });
  }

  replaceQueue(queue);
  return request;
}

function removeFromQueue(id) {
  const before = getQueue();
  const after = before.filter((item) => item.id !== id);
  replaceQueue(after);
  return before.length - after.length;
}

function getQueueCount() {
  return getQueue().length;
}

function getNetworkState() {
  const normalized = normalizeNetworkState(readJson(NETWORK_FILE, DEFAULT_NETWORK_STATE));
  writeJson(NETWORK_FILE, normalized);
  return normalized;
}

function actionToBoolean(action) {
  if (action === "enable" || action === "up" || action === "restore") {
    return true;
  }

  if (action === "disable" || action === "down" || action === "fail") {
    return false;
  }

  throw new Error(`Unsupported network action: ${action}`);
}

function setNetworkPath(pathName, action) {
  const key = PATH_TO_KEY[pathName];
  if (!key) {
    throw new Error(`Unsupported network path: ${pathName}`);
  }

  const nextState = {
    ...getNetworkState(),
    [key]: actionToBoolean(action)
  };

  writeJson(NETWORK_FILE, nextState);
  return nextState;
}

module.exports = {
  DEFAULT_NETWORK_STATE,
  enqueue,
  getNetworkState,
  getQueue,
  getQueueCount,
  removeFromQueue,
  replaceQueue,
  setNetworkPath
};
