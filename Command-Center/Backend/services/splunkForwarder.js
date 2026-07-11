// Splunk HEC forwarder — streams every cloud event to a Splunk instance via
// the standard HTTP Event Collector, so an enterprise deployment gets full
// after-action searchability for free.
//
// Same design rules as the Webex notifier ("enhancer, never gatekeeper"):
// - OFF unless both SPLUNK_HEC_URL and SPLUNK_HEC_TOKEN are set — the demo
//   stack runs with zero Splunk footprint.
// - Fire-and-forget with batching: nothing anywhere waits for Splunk. A dead
//   or slow Splunk costs one throttled warning line, never a delayed SOS.
const axios = require("axios");

const HEC_URL = String(process.env.SPLUNK_HEC_URL || "").replace(/\/+$/, "");
const HEC_TOKEN = process.env.SPLUNK_HEC_TOKEN || "";
const SPLUNK_ENABLED = Boolean(HEC_URL && HEC_TOKEN);

const FLUSH_INTERVAL_MS = Number(process.env.SPLUNK_FLUSH_INTERVAL_MS || 2000);
const MAX_BATCH = 20;
const MAX_QUEUE = 500;
const SEND_TIMEOUT_MS = 4000;
const ERROR_LOG_THROTTLE_MS = 30000;

const queue = [];
let lastErrorLogAt = 0;

// Every event type carries a different payload shape; pull out the fields an
// operator would actually search on and drop the bulk (undefined keys vanish
// in JSON.stringify, so absent fields cost nothing).
function summarize(type, payload = {}) {
  return {
    type,
    id: payload.id || payload.requestId || undefined,
    podId: payload.podId || undefined,
    coordinatorId: payload.coordinatorId || payload.targetCoordinatorId || undefined,
    category: payload.category || undefined,
    severity: payload.triage?.severity ?? payload.severity ?? undefined,
    critical: payload.isCritical === true ? true : undefined,
    status: payload.status || payload.resolutionStatus || undefined,
    transport: payload.forwardedBy || payload.linkType || payload.transport || undefined,
    targets: Array.isArray(payload.routing?.targets)
      ? payload.routing.targets.map((target) => target.id)
      : undefined,
    saturatedRoles: payload.routing?.saturatedRoles?.length
      ? payload.routing.saturatedRoles
      : undefined,
    shortageLevel: payload.shortageLevel || undefined,
    hazard: payload.hazard || undefined,
    aiUpgraded: payload.aiTriage?.upgraded === true ? true : undefined,
    message: payload.message ? String(payload.message).slice(0, 200) : undefined
  };
}

function logEvent(type, payload) {
  if (!SPLUNK_ENABLED) {
    return;
  }
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
  }
  queue.push({
    time: Date.now() / 1000,
    host: "sanjeevani-cloud",
    source: "sanjeevani",
    sourcetype: "_json",
    event: summarize(type, payload)
  });
}

async function flush() {
  if (queue.length === 0) {
    return;
  }
  const batch = queue.splice(0, MAX_BATCH);
  // HEC accepts newline-separated event objects in a single request.
  const body = batch.map((entry) => JSON.stringify(entry)).join("\n");
  try {
    await axios.post(`${HEC_URL}/services/collector/event`, body, {
      headers: { Authorization: `Splunk ${HEC_TOKEN}` },
      timeout: SEND_TIMEOUT_MS
    });
  } catch (error) {
    if (Date.now() - lastErrorLogAt > ERROR_LOG_THROTTLE_MS) {
      lastErrorLogAt = Date.now();
      console.warn(
        `[cloud-api][splunk] forward failed: ${error.message} (${batch.length} event(s) dropped)`
      );
    }
  }
}

if (SPLUNK_ENABLED) {
  // unref: the flush timer must never keep a test harness process alive.
  setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS).unref();
  console.log(`[cloud-api][splunk] HEC forwarding enabled -> ${HEC_URL}`);
}

module.exports = { SPLUNK_ENABLED, logEvent };
