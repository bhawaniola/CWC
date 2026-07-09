import { useEffect, useState } from "react";
import { FiAlertTriangle, FiDroplet, FiActivity, FiThermometer, FiWind } from "react-icons/fi";

import { fetchPodHazards } from "../api/podApi";

// Sensor metadata mirrors the simulation-controller so the citizen app speaks
// the same language: each sensor maps to a plain-English hazard, a unit, and a
// display precision. Thresholds themselves come live from the pod's own
// hazardPackService (via /api/hazards), never hard-coded here.
const SENSOR_META = {
  water_level: { label: "Water level", hazard: "Flood", unit: "cm", decimals: 0, Icon: FiDroplet },
  shake_g: { label: "Ground shake", hazard: "Earthquake", unit: "g", decimals: 3, Icon: FiActivity },
  temperature: { label: "Temperature", hazard: "Heatwave", unit: "°C", decimals: 1, Icon: FiThermometer },
  air_quality: { label: "Air quality", hazard: "Wildfire smoke", unit: "µg/m³", decimals: 0, Icon: FiWind }
};

function statusFor(value, threshold) {
  if (!threshold) return "normal";
  if (value >= threshold) return "critical";
  if (value >= threshold * 0.8) return "warning";
  return "normal";
}

function latestReading(readings) {
  if (!Array.isArray(readings) || readings.length === 0) return null;
  return readings[readings.length - 1];
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export default function PodSensorPanel() {
  const [hazards, setHazards] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const result = await fetchPodHazards(controller.signal);
        setHazards(result.data);
        setError("");
      } catch (err) {
        if (err.name !== "AbortError") {
          setError("Sensor telemetry unavailable.");
        }
      }
    };

    load();
    const interval = window.setInterval(load, 5000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const packs = hazards?.packs || [];
  const sensorReadings = hazards?.sensors || {};
  const alerts = hazards?.alerts || [];
  const thresholdBySensor = Object.fromEntries(packs.map((pack) => [pack.sensor, pack.threshold]));
  const severityBySensor = Object.fromEntries(packs.map((pack) => [pack.sensor, pack.severity]));

  // Build one card per sensor this pod actually reports (the simulator only
  // POSTs a pod its own sensors, so this list is naturally pod-local).
  const cards = Object.keys(sensorReadings)
    .filter((sensor) => SENSOR_META[sensor])
    .map((sensor) => {
      const meta = SENSOR_META[sensor];
      const reading = latestReading(sensorReadings[sensor]);
      const value = reading ? Number(reading.value) : null;
      const threshold = thresholdBySensor[sensor];
      const status = value == null ? "unknown" : statusFor(value, threshold);
      const pct = value != null && threshold ? Math.min(100, Math.round((value / threshold) * 100)) : 0;
      return { sensor, meta, reading, value, threshold, status, pct };
    });

  // The banner is driven by the LIVE reading, never by the stored alert log.
  // hazardPackService latches past alerts in alerts.json so they persist after
  // the reading recovers - showing those would be a false alarm. A hazard is
  // "active" only while a sensor is currently over its threshold right now.
  const criticalCards = cards.filter((card) => card.status === "critical").sort((a, b) => b.pct - a.pct);
  const warningCards = cards.filter((card) => card.status === "warning").sort((a, b) => b.pct - a.pct);
  const activeCard = criticalCards[0] || null;
  const watchCard = !activeCard ? warningCards[0] || null : null;
  const hasAlert = Boolean(activeCard);
  const severity = activeCard ? severityBySensor[activeCard.sensor] || 8 : 0;
  const sevClass = severity >= 9 ? "high" : severity >= 7 ? "mid" : "low";
  // Reuse the pod's own alert guidance text, but only for the sensor that is
  // currently critical - so the wording is real, yet never stale.
  const activeGuidance = activeCard ? alerts.find((entry) => entry.sensor === activeCard.sensor)?.message : "";

  return (
    <section className="pod-sensor-card">
      <div className="pod-sensor-header">
        <p className="eyebrow live-eyebrow">
          <span aria-hidden="true" />
          Local Situational Awareness
        </p>
        <span className={`pod-sensor-pill ${hasAlert ? "alert" : watchCard ? "watch" : "clear"}`}>
          {hasAlert ? "Hazard active" : watchCard ? "Watch" : "All clear"}
        </span>
      </div>
      <h2 className="pod-sensor-title">On-site sensors &amp; hazards</h2>

      {hasAlert ? (
        <div className={`pod-alert-banner sev-${sevClass}`}>
          <FiAlertTriangle aria-hidden="true" />
          <div>
            <strong>{activeCard.meta.hazard.toUpperCase()} ALERT</strong>
            <p>
              {activeCard.meta.label} is at {activeCard.value.toFixed(activeCard.meta.decimals)}
              {activeCard.meta.unit} — past the {activeCard.threshold}
              {activeCard.meta.unit} {activeCard.meta.hazard.toLowerCase()} line.
            </p>
            {activeGuidance ? <p className="pod-alert-guidance">{activeGuidance}</p> : null}
            {activeCard.reading?.recordedAt ? (
              <small>Live reading · updated {formatTime(activeCard.reading.recordedAt)}</small>
            ) : null}
          </div>
        </div>
      ) : watchCard ? (
        <div className="pod-watch-banner">
          <FiAlertTriangle aria-hidden="true" />
          <p>
            {watchCard.meta.label} rising ({watchCard.pct}% of the {watchCard.meta.hazard.toLowerCase()} threshold).
            Sensors are watching closely.
          </p>
        </div>
      ) : (
        <p className="pod-sensor-lede">
          Cisco Meraki &amp; Catalyst IOx sensors at this pod are reading normal. The moment one crosses its
          hazard line, a live alert appears here — and clears itself when the reading recovers.
        </p>
      )}

      {cards.length > 0 ? (
        <div className="pod-sensor-grid">
          {cards.map(({ sensor, meta, reading, value, threshold, status, pct }) => {
            const Icon = meta.Icon;
            return (
              <article className={`pod-sensor-tile ${status}`} key={sensor}>
                <div className="pod-sensor-tile-top">
                  <span className="pod-sensor-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className={`pod-sensor-status ${status}`}>{status}</span>
                </div>
                <div className="pod-sensor-value">
                  {value == null ? "--" : value.toFixed(meta.decimals)}
                  <span>{meta.unit}</span>
                </div>
                <div className="pod-sensor-meta">
                  {meta.label} &middot; guards <strong>{meta.hazard}</strong>
                </div>
                <div className="pod-sensor-meter">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="pod-sensor-scale">
                  <span>{pct}% of threshold</span>
                  {threshold ? <span>{threshold}{meta.unit}</span> : null}
                </div>
                {reading?.source ? <small className="pod-sensor-source">{reading.source}</small> : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="pod-sensor-empty">
          {error || "Waiting for the first sensor reading from this pod’s Meraki gateway…"}
        </p>
      )}
    </section>
  );
}
