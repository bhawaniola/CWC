const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SENSOR_FILE = path.join(DATA_DIR, "sensor-readings.json");
const ALERT_FILE = path.join(DATA_DIR, "alerts.json");
const TRIGGER_FILE = path.join(DATA_DIR, "hazard-triggers.json");

const HAZARD_PACKS = [
  {
    name: "flood",
    sensor: "water_level",
    threshold: 150,
    trendWindow: 5,
    trendMinRise: 25,
    severity: 9,
    alert:
      "FLOOD WARNING at {site}: water level {value} cm and rising. Move to elevated shelter now. Follow volunteer instructions."
  },
  {
    name: "earthquake",
    sensor: "shake_g",
    threshold: 0.4,
    severity: 10,
    alert:
      "EARTHQUAKE detected near {site} ({value} g). If safe, gather at the open assembly area. Report missing persons at the help desk or portal."
  },
  {
    name: "heatwave",
    sensor: "temperature",
    threshold: 45,
    severity: 7,
    alert:
      "HEATWAVE advisory at {site}: {value} C. Cooling center open. Check on elderly neighbours."
  },
  {
    // Meraki MT14 reports indoor air quality / PM2.5 (ug/m3). Wildfire smoke
    // pushes PM2.5 well past the "hazardous" AQI band (~250), and a fast rise
    // catches an approaching smoke plume before it maxes out. This is a real
    // MT14 metric, so no "seismic MT" style disclaimer is needed here.
    name: "wildfire",
    sensor: "air_quality",
    threshold: 250,
    trendWindow: 5,
    trendMinRise: 120,
    severity: 8,
    alert:
      "WILDFIRE SMOKE alert at {site}: air quality {value} ug/m3 PM2.5 (hazardous). Close windows, mask up, and move indoors or evacuate on volunteer advice."
  }
];

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    writeJson(filePath, fallback);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function formatAlert(template, values) {
  return template
    .replaceAll("{site}", values.site)
    .replaceAll("{value}", String(values.value));
}

function getSensorReadings() {
  return readJson(SENSOR_FILE, {});
}

function getAlerts() {
  return readJson(ALERT_FILE, []);
}

function getTriggeredPacks() {
  return readJson(TRIGGER_FILE, {});
}

function storeAlert(alert) {
  const alerts = getAlerts();
  const nextAlert = {
    id: alert.id || `alert-${Date.now()}`,
    receivedAt: alert.receivedAt || new Date().toISOString(),
    verified: alert.verified !== false,
    source: alert.source || "control-center",
    ...alert
  };

  alerts.unshift(nextAlert);
  writeJson(ALERT_FILE, alerts.slice(0, 25));
  return nextAlert;
}

function resetHazards() {
  writeJson(SENSOR_FILE, {});
  writeJson(TRIGGER_FILE, {});
  writeJson(ALERT_FILE, []);
}

function recordSensorReading(identity, body = {}) {
  const sensor = String(body.sensor || body.metric || "").trim();
  const value = Number(body.value);

  if (!sensor) {
    throw new Error("Sensor name is required.");
  }

  if (!Number.isFinite(value)) {
    throw new Error("Sensor value must be a number.");
  }

  const readings = getSensorReadings();
  const triggered = getTriggeredPacks();
  const sensorReadings = readings[sensor] || [];
  const reading = {
    sensor,
    value,
    unit: body.unit || "",
    source: body.source || "pod-sensor",
    recordedAt: new Date().toISOString()
  };

  sensorReadings.push(reading);
  readings[sensor] = sensorReadings.slice(-30);
  writeJson(SENSOR_FILE, readings);

  const fired = [];

  for (const pack of HAZARD_PACKS) {
    if (pack.sensor !== sensor || triggered[pack.name]) {
      continue;
    }

    let trigger = "";
    if (value >= pack.threshold) {
      trigger = `value ${value} >= threshold ${pack.threshold}`;
    } else if (pack.trendWindow && readings[sensor].length >= pack.trendWindow) {
      const window = readings[sensor].slice(-pack.trendWindow);
      const rise = window[window.length - 1].value - window[0].value;
      if (rise >= pack.trendMinRise) {
        trigger = `rising ${rise} over last ${pack.trendWindow} readings`;
      }
    }

    if (!trigger) {
      continue;
    }

    triggered[pack.name] = {
      sensor,
      value,
      trigger,
      triggeredAt: new Date().toISOString()
    };

    const alert = storeAlert({
      source: "local-hazard-pack",
      hazard: pack.name,
      severity: pack.severity,
      scope: identity.podId,
      message: formatAlert(pack.alert, {
        site: identity.podName,
        value
      }),
      trigger,
      sensor,
      value
    });

    fired.push(alert);
  }

  writeJson(TRIGGER_FILE, triggered);

  return {
    reading,
    fired,
    readings: readings[sensor],
    triggered
  };
}

module.exports = {
  HAZARD_PACKS,
  getAlerts,
  getSensorReadings,
  getTriggeredPacks,
  recordSensorReading,
  resetHazards,
  storeAlert
};
