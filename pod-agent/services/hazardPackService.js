const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SENSOR_FILE = path.join(DATA_DIR, "sensor-readings.json");
const ALERT_FILE = path.join(DATA_DIR, "alerts.json");
const TRIGGER_FILE = path.join(DATA_DIR, "hazard-triggers.json");

// `roles` names the responder teams for each hazard. It drives BOTH the
// direct pod -> in-range coordinator notification and the cloud's routing,
// so a hazard never depends on its alert text happening to contain a
// role keyword (earthquake/heatwave texts don't).
//
// `rearmBelow` is the recovery level: once a pack has fired it stays latched
// (no alert spam while the value hovers around the threshold), and only when
// the sensor drops back to safe does the pack re-arm — so a flood that
// recedes and rises again correctly alerts again.
const HAZARD_PACKS = [
  {
    name: "flood",
    sensor: "water_level",
    threshold: 150,
    rearmBelow: 120,
    trendWindow: 5,
    trendMinRise: 25,
    severity: 9,
    roles: ["flood", "shelter"],
    alert:
      "FLOOD WARNING at {site}: water level {value} cm and rising. Move to elevated shelter now. Follow volunteer instructions."
  },
  {
    name: "earthquake",
    sensor: "shake_g",
    threshold: 0.4,
    rearmBelow: 0.2,
    severity: 10,
    roles: ["hospital", "workforce"],
    alert:
      "EARTHQUAKE detected near {site} ({value} g). If safe, gather at the open assembly area. Report missing persons at the help desk or portal."
  },
  {
    name: "heatwave",
    sensor: "temperature",
    threshold: 45,
    rearmBelow: 40,
    severity: 7,
    roles: ["hospital", "shelter"],
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
    rearmBelow: 180,
    trendWindow: 5,
    trendMinRise: 120,
    severity: 8,
    roles: ["fire", "workforce"],
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
  const rearmed = [];

  // Recovery first: a latched pack re-arms once the sensor is back at a safe
  // level, so the next genuine spike can fire again (a demo re-run or a real
  // second flood must never be swallowed by a stale latch).
  for (const pack of HAZARD_PACKS) {
    if (pack.sensor !== sensor || !triggered[pack.name]) {
      continue;
    }
    const rearmLevel = Number.isFinite(pack.rearmBelow) ? pack.rearmBelow : pack.threshold;
    if (value <= rearmLevel) {
      delete triggered[pack.name];
      rearmed.push(pack.name);
    }
  }

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
      // The latest value must be the window's peak: a value RECEDING from a
      // recent spike still shows a big rise vs 5 readings ago, and a falling
      // river must never re-fire a "rising" warning right after re-arming.
      const latestIsPeak = window.every((entry) => entry.value <= window[window.length - 1].value);
      if (rise >= pack.trendMinRise && latestIsPeak) {
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
      roles: pack.roles || [],
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
    rearmed,
    readings: readings[sensor],
    triggered
  };
}

// Display names + Command Center sensor types for the pod's raw metrics.
const SENSOR_DISPLAY = {
  water_level: { label: "Water level", type: "water-level" },
  shake_g: { label: "Ground shake", type: "seismic" },
  temperature: { label: "Temperature", type: "temperature" },
  air_quality: { label: "Air quality (PM2.5)", type: "air-quality" }
};

// Live telemetry rows for the Command Center's Sensors page (and coordinator
// dashboards): the latest reading per sensor, with the status computed HERE
// from the same hazard-pack thresholds that fire alerts — the pod is the
// single source of truth, so no other screen can disagree with it.
function buildSensorTelemetry(identity) {
  const readings = getSensorReadings();
  const triggered = getTriggeredPacks();
  const rows = [];

  for (const [sensor, entries] of Object.entries(readings)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    const latest = entries[entries.length - 1];
    const value = Number(latest.value);
    const pack = HAZARD_PACKS.find((item) => item.sensor === sensor);
    const display = SENSOR_DISPLAY[sensor] || { label: sensor, type: sensor };

    let status = "normal";
    if (pack) {
      if (triggered[pack.name] || value >= pack.threshold) {
        status = "critical";
      } else if (value >= pack.threshold * 0.75) {
        status = "warning";
      }
    }

    const history = entries.slice(-10).map((entry) => Number(entry.value));
    const delta = history.length > 1 ? Number((history[history.length - 1] - history[0]).toFixed(2)) : 0;

    rows.push({
      id: `sensor-live-${identity.podId}-${sensor}`,
      sensorId: `${identity.podId}:${sensor}`,
      label: display.label,
      type: display.type,
      value,
      unit: latest.unit || "",
      delta,
      deltaLabel: `${delta >= 0 ? "+" : ""}${delta}${latest.unit ? ` ${latest.unit}` : ""} recent trend`,
      status,
      risk: status === "critical" ? "high" : status === "warning" ? "medium" : "low",
      zone: identity.region || "",
      locationName: identity.podName,
      podId: identity.podId,
      hazard: pack?.name,
      threshold: pack?.threshold,
      source: latest.source || "pod-sensor",
      lastReadingAt: latest.recordedAt,
      history
    });
  }

  return rows;
}

module.exports = {
  HAZARD_PACKS,
  buildSensorTelemetry,
  getAlerts,
  getSensorReadings,
  getTriggeredPacks,
  recordSensorReading,
  resetHazards,
  storeAlert
};
