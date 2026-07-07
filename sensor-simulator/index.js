const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 9400;
const TICK_MS = Number(process.env.TICK_MS || 4000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function nowIso() {
  return new Date().toISOString();
}

// --- Simulated Meraki MT fleet -------------------------------------------
// A real MT10/MT12 talks Bluetooth Low Energy to a Meraki MR/MV gateway,
// which uploads to the Meraki cloud dashboard. From there you either poll
// the Dashboard API (exactly what integrations/meraki_live.py does for real)
// or set up a Sensor Alert Profile that fires a webhook when a threshold is
// crossed. We don't have physical MT hardware for the hackathon, so this
// file plays the role of "the thing on the other end of that webhook/API" -
// it produces a reading in the same {sensor, value, unit, source} shape and
// HTTP-POSTs it straight at each pod's /api/sensors endpoint on a timer.
// The BLE hop, the gateway, and the Meraki dashboard itself are NOT
// simulated - only the data contract and delivery are.
//
// shake_g is intentionally NOT labeled Meraki - Cisco has no seismic MT
// sensor - it's framed as a third-party accelerometer feeding in through a
// Catalyst IOx edge app instead.
//
// Pod URLs below use the same "http://pod-XX:8000" Docker-network hostnames
// your own gossipRouter.js already uses to talk pod-to-pod. If your
// docker-compose service names or ports differ, edit the `url` fields below
// to match.
// max is set well past each hazardPackService threshold (flood=150cm,
// heatwave=45C, earthquake=0.4g) so /spike can actually cross it on demand -
// clamping at, say, 130cm would let you "spike" POD-04 forever and never see
// a flood alert fire.
// Names/ids/urls below are pulled straight from your real docker-compose.yml
// (POD_NAME per service), not placeholders.
const STATIONS = [
  { podId: "POD-01", podName: "District Command Pod", url: "http://pod-01:8000", sensor: "temperature", unit: "celsius", model: "MT10", base: 29, drift: 0.6, min: 22, max: 50 },
  { podId: "POD-02", podName: "Hospital Relief Pod", url: "http://pod-02:8000", sensor: "temperature", unit: "celsius", model: "MT10", base: 30, drift: 0.6, min: 22, max: 50 },
  { podId: "POD-03", podName: "School Shelter Pod", url: "http://pod-03:8000", sensor: "shake_g", unit: "g", model: "3rd-party accelerometer (Catalyst IOx)", base: 0.02, drift: 0.01, min: 0, max: 0.6 },
  { podId: "POD-04", podName: "Riverbank Village Pod", url: "http://pod-04:8000", sensor: "water_level", unit: "cm", model: "MT12", base: 70, drift: 3, min: 35, max: 200 },
  { podId: "POD-05", podName: "Evacuation Route Pod", url: "http://pod-05:8000", sensor: "water_level", unit: "cm", model: "MT12", base: 58, drift: 2, min: 35, max: 200 },
  { podId: "POD-06", podName: "Remote Village Pod", url: "http://pod-06:8000", sensor: "temperature", unit: "celsius", model: "MT10", base: 31, drift: 0.7, min: 22, max: 50 },
  { podId: "POD-07", podName: "Supply Warehouse Pod", url: "http://pod-07:8000", sensor: "temperature", unit: "celsius", model: "MT10", base: 28, drift: 0.5, min: 22, max: 50 },
  { podId: "POD-08", podName: "Medical Camp Pod", url: "http://pod-08:8000", sensor: "temperature", unit: "celsius", model: "MT10", base: 30, drift: 0.6, min: 22, max: 50 },
  { podId: "POD-09", podName: "High Ground Shelter Pod", url: "http://pod-09:8000", sensor: "shake_g", unit: "g", model: "3rd-party accelerometer (Catalyst IOx)", base: 0.02, drift: 0.01, min: 0, max: 0.6 },
  { podId: "POD-10", podName: "Mobile Relay Pod", url: "http://pod-10:8000", sensor: "water_level", unit: "cm", model: "MT12", base: 55, drift: 2, min: 35, max: 200 }
];

// Meraki MT30 smart automation buttons - a physical "press for help" fixture
// rather than a threshold sensor, so it gets its own list and its own route
// (POST /api/sensors/button) on the pod side. These three (School Shelter,
// Medical Camp, Mobile Relay) can also have a regular sensor installed at
// the same time - a real MT30 and MT10/MT12 can share the same MR gateway.
const BUTTONS = [
  { podId: "POD-03", podName: "School Shelter Pod", url: "http://pod-03:8000" },
  { podId: "POD-08", podName: "Medical Camp Pod", url: "http://pod-08:8000" },
  { podId: "POD-10", podName: "Mobile Relay Pod", url: "http://pod-10:8000" }
];

function stationKey(station) {
  return `${station.podId}:${station.sensor}`;
}

const STATE = new Map();
for (const station of STATIONS) {
  STATE.set(stationKey(station), {
    value: station.base,
    spikeTicksLeft: 0,
    spikeStep: 0,
    lastSentAt: null,
    lastError: null
  });
}

function stepStation(station) {
  const state = STATE.get(stationKey(station));

  if (state.spikeTicksLeft > 0) {
    state.value += state.spikeStep;
    state.spikeTicksLeft -= 1;
  } else {
    // Gentle pull back toward baseline so an idle station hovers near `base`
    // instead of randomly drifting toward the hazard threshold over a long
    // demo. Only a manual /spike (or a repeat one) should trigger a pack.
    const pullToBase = (station.base - state.value) * 0.1;
    const wander = (Math.random() * 2 - 1) * station.drift;
    state.value += pullToBase + wander;
  }

  state.value = Math.min(station.max, Math.max(station.min, state.value));
  return state;
}

async function sendReading(station) {
  const state = stepStation(station);
  const value = Number(state.value.toFixed(2));

  const payload = {
    sensor: station.sensor,
    value,
    unit: station.unit,
    source: `Meraki ${station.model} (simulated)`
  };

  try {
    await axios.post(`${station.url}/api/sensors`, payload, { timeout: 2000 });
    state.lastSentAt = nowIso();
    state.lastError = null;
    console.log(`[sensor-sim] ${station.model} @ ${station.podId}: ${station.sensor}=${value}${station.unit} sent`);
  } catch (error) {
    state.lastError = error.message;
    console.warn(`[sensor-sim] ${station.podId} ${station.sensor} send failed: ${error.message}`);
  }
}

setInterval(() => {
  STATIONS.forEach(sendReading);
}, TICK_MS);

// --- Control API, so you (or a teammate on the judging floor) can drive the demo live ---

app.get("/health", (req, res) => {
  res.json({ success: true, service: "sensor-simulator", status: "up", tickMs: TICK_MS });
});

app.get("/status", (req, res) => {
  const stations = STATIONS.map((station) => ({
    podId: station.podId,
    podName: station.podName,
    sensor: station.sensor,
    model: station.model,
    unit: station.unit,
    ...STATE.get(stationKey(station))
  }));

  res.json({
    success: true,
    tickMs: TICK_MS,
    stations,
    buttons: BUTTONS
  });
});

// Ramp a station toward (or past) its hazardPackService threshold over the
// next N ticks - this is how you demo the flood/heatwave story live.
app.post("/spike/:podId/:sensor", (req, res) => {
  const { podId, sensor } = req.params;
  const station = STATIONS.find(
    (s) => s.podId.toUpperCase() === podId.toUpperCase() && s.sensor === sensor
  );

  if (!station) {
    return res.status(404).json({
      success: false,
      message: `No simulated station for ${podId}/${sensor}. Check the STATIONS list at the top of index.js.`
    });
  }

  const ticks = Number(req.body?.ticks || 6);
  const step = Number(req.body?.step ?? 15);
  const state = STATE.get(stationKey(station));
  state.spikeTicksLeft = ticks;
  state.spikeStep = step;

  console.log(`[sensor-sim] spike armed for ${podId}/${sensor}: +${step} per tick over ${ticks} ticks`);

  res.json({
    success: true,
    message: `Ramping ${podId} ${sensor} by ${step} per tick for the next ${ticks} ticks.`,
    data: { podId, sensor, ticks, step, currentValue: state.value }
  });
});

app.post("/reset/:podId/:sensor", (req, res) => {
  const { podId, sensor } = req.params;
  const station = STATIONS.find(
    (s) => s.podId.toUpperCase() === podId.toUpperCase() && s.sensor === sensor
  );

  if (!station) {
    return res.status(404).json({ success: false, message: `No simulated station for ${podId}/${sensor}.` });
  }

  const state = STATE.get(stationKey(station));
  state.value = station.base;
  state.spikeTicksLeft = 0;
  state.spikeStep = 0;

  res.json({ success: true, message: `${podId} ${sensor} reset to baseline ${station.base}${station.unit}.` });
});

// Simulates a physical Meraki MT30 button press at a pod. Skips the sensor
// threshold path entirely and hits the pod's dedicated button route.
app.post("/press/:podId", async (req, res) => {
  const { podId } = req.params;
  const button = BUTTONS.find((b) => b.podId.toUpperCase() === podId.toUpperCase());

  if (!button) {
    return res.status(404).json({
      success: false,
      message: `No MT30 button configured for ${podId}. Check the BUTTONS list at the top of index.js.`
    });
  }

  try {
    const response = await axios.post(
      `${button.url}/api/sensors/button`,
      {
        name: "Meraki MT30 Smart Button (simulated)",
        message: req.body?.message || `MT30 button pressed at ${button.podName}. Immediate assistance requested.`,
        location: button.podName
      },
      { timeout: 3000 }
    );

    console.log(`[sensor-sim] MT30 button pressed at ${podId} (${button.podName})`);
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: `Could not reach ${podId} to deliver the button press.`,
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`[sensor-sim] control API listening on ${PORT}`);
  console.log(`[sensor-sim] simulating ${STATIONS.length} Meraki-style stations, tick every ${TICK_MS}ms`);
});
