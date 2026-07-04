const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "pod-settings.json");
const DEFAULT_POD_NAME = process.env.POD_NAME || "Local SANJEEVANI Pod";

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeSettings(settings) {
  ensureDataDir();
  const tmpPath = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpPath, SETTINGS_FILE);
}

function getPodSettings() {
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaults = { podName: DEFAULT_POD_NAME };
    writeSettings(defaults);
    return defaults;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return {
      podName: sanitizePodName(settings.podName || DEFAULT_POD_NAME)
    };
  } catch (error) {
    const defaults = { podName: DEFAULT_POD_NAME };
    writeSettings(defaults);
    return defaults;
  }
}

function sanitizePodName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function setPodName(podName) {
  const sanitized = sanitizePodName(podName);

  if (sanitized.length < 3) {
    throw new Error("Pod name must be at least 3 characters.");
  }

  const settings = {
    ...getPodSettings(),
    podName: sanitized,
    updatedAt: new Date().toISOString()
  };

  writeSettings(settings);
  return settings;
}

module.exports = {
  getPodSettings,
  setPodName
};
