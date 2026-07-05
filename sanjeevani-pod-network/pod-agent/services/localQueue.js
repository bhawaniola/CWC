const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const NETWORK_FILE = path.join(DATA_DIR, "network-state.json");

const DEFAULT_NETWORK_STATE = {
  satellite: "up",
  cellular: "up",
  mesh: "up"
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

function normalizeNetworkState(candidate) {
  const normalized = { ...DEFAULT_NETWORK_STATE };

  for (const key of Object.keys(DEFAULT_NETWORK_STATE)) {
    if (candidate && (candidate[key] === "up" || candidate[key] === "down")) {
      normalized[key] = candidate[key];
    }
  }

  return normalized;
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
  return normalizeNetworkState(readJson(NETWORK_FILE, DEFAULT_NETWORK_STATE));
}

function setNetworkPath(pathName, state) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_NETWORK_STATE, pathName)) {
    throw new Error(`Unsupported network path: ${pathName}`);
  }

  if (state !== "up" && state !== "down") {
    throw new Error(`Unsupported network state: ${state}`);
  }

  const nextState = {
    ...getNetworkState(),
    [pathName]: state
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
