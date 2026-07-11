const axios = require("axios");

// SANJEEVANI -> Webex: when a CRITICAL SOS lands (or the AI upgrades one, or
// a sensor fires an early warning), the cloud posts a formatted alert into
// every Webex space the Sanjeevni-Sentinel bot has been added to — the phone
// in a responder's pocket, not just the dashboard in the EOC.
//
// Same rule as the AI: enhancer, never gatekeeper. Every call is
// fire-and-forget with a short timeout; a dead internet connection costs one
// warning line in the log and nothing else. (This is the one feature that
// needs real internet — in production it rides the satellite uplink.)
const WEBEX_API = "https://webexapis.com/v1";
const BOT_TOKEN = String(process.env.WEBEX_BOT_TOKEN || "").trim();
const PINNED_ROOM_ID = String(process.env.WEBEX_ROOM_ID || "").trim();
const WEBEX_ENABLED =
  Boolean(BOT_TOKEN) && String(process.env.WEBEX_ENABLED || "true").toLowerCase() !== "false";
const SEND_TIMEOUT_MS = Number(process.env.WEBEX_TIMEOUT_MS || 6000);
const ROOM_REFRESH_MS = Number(process.env.WEBEX_ROOM_REFRESH_MS || 60000);
const MAX_ROOMS = 3;

// A surge of 100 critical SOS must not buzz phones 100 times: one alert per
// request ever (dedup by id), and at most a small burst per minute overall.
const RATE_LIMIT_PER_MINUTE = Number(process.env.WEBEX_MAX_PER_MINUTE || 6);
const notifiedKeys = new Set();
const sentTimestamps = [];

// A cloud restart re-processes old stored requests (AI retry sweep, demo
// seeds) — those must not buzz phones about emergencies from hours ago.
// cloudReceivedAt is used on purpose: an island-mode SOS delivered late has
// a FRESH cloudReceivedAt, so "delayed but never lost" still alerts.
const MAX_ALERT_AGE_MS = Number(process.env.WEBEX_MAX_ALERT_AGE_MIN || 30) * 60000;

// A single Wi-Fi blip must not eat an alert forever: failed sends go into a
// small retry queue (with forced room re-discovery), a few attempts apart.
const RETRY_INTERVAL_MS = Number(process.env.WEBEX_RETRY_INTERVAL_MS || 30000);
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_QUEUE = 10;
const retryQueue = [];

function isDemoSeed(request) {
  return String(request.source || "").toLowerCase().includes("seed");
}

function tooOldToAlert(request) {
  const at = request.cloudReceivedAt ? new Date(request.cloudReceivedAt).getTime() : NaN;
  return Number.isFinite(at) && Date.now() - at > MAX_ALERT_AGE_MS;
}

let cachedRooms = [];
let roomsFetchedAt = 0;
let botIdentity = null;

const authHeaders = { Authorization: `Bearer ${BOT_TOKEN}` };

function rateLimited() {
  const cutoff = Date.now() - 60000;
  while (sentTimestamps.length && sentTimestamps[0] < cutoff) {
    sentTimestamps.shift();
  }
  return sentTimestamps.length >= RATE_LIMIT_PER_MINUTE;
}

function rememberKey(key) {
  notifiedKeys.add(key);
  if (notifiedKeys.size > 2000) {
    notifiedKeys.clear();
  }
}

async function refreshRooms(force = false) {
  if (PINNED_ROOM_ID) {
    cachedRooms = [{ id: PINNED_ROOM_ID, title: "(pinned via WEBEX_ROOM_ID)" }];
    return cachedRooms;
  }

  if (!force && cachedRooms.length && Date.now() - roomsFetchedAt < ROOM_REFRESH_MS) {
    return cachedRooms;
  }

  const response = await axios.get(`${WEBEX_API}/rooms?max=20&sortBy=lastactivity`, {
    headers: authHeaders,
    timeout: SEND_TIMEOUT_MS
  });
  cachedRooms = (response.data?.items || []).slice(0, MAX_ROOMS);
  roomsFetchedAt = Date.now();
  return cachedRooms;
}

async function postToRooms(markdown) {
  const rooms = await refreshRooms();
  if (rooms.length === 0) {
    console.warn(
      "[cloud-api][webex] bot is not in any space yet — add sanjeevni_sentinel@webex.bot to a Webex space"
    );
    return { sent: 0, rooms: 0 };
  }

  let sent = 0;
  for (const room of rooms) {
    try {
      await axios.post(
        `${WEBEX_API}/messages`,
        { roomId: room.id, markdown },
        { headers: authHeaders, timeout: SEND_TIMEOUT_MS }
      );
      sent += 1;
    } catch (error) {
      console.warn(
        `[cloud-api][webex] send to "${room.title}" failed: ${error.response?.status || error.message}`
      );
      // The room may be gone (bot removed, space deleted) — re-discover
      // spaces on the next attempt instead of retrying a dead id.
      roomsFetchedAt = 0;
    }
  }

  if (sent > 0) {
    sentTimestamps.push(Date.now());
  }
  return { sent, rooms: rooms.length };
}

function severityOf(request) {
  return Number(request.triage?.severity || request.severity || 0);
}

function locationOf(request) {
  return request.locationName || request.location || request.podName || "unknown location";
}

// Webex squashes loose paragraphs together — a heading + blockquote + bullet
// list is what renders as clean separated lines on both phone and desktop.
function timestampLine() {
  return new Date().toLocaleString("en-IN", { hour12: true, timeZone: "Asia/Kolkata" });
}

function criticalAlertMarkdown(request, { aiUpgraded = false } = {}) {
  const lines = [
    `## 🚨 CRITICAL SOS — severity ${severityOf(request)}${aiUpgraded ? " (🤖 caught by AI triage)" : ""}`
  ];
  if (request.message) {
    lines.push(`> "${String(request.message).slice(0, 300)}"`);
  }
  lines.push(`- **Who:** ${request.name || "Citizen"}`);
  lines.push(`- **Where:** ${locationOf(request)} (${request.podId || "pod unknown"})`);
  if (request.aiTriage?.reason) {
    lines.push(
      `- **🤖 AI verdict:** ${request.aiTriage.reason}${
        request.aiTriage.upgraded ? ` — upgraded from severity ${request.aiTriage.previousSeverity}` : ""
      }`
    );
  }
  const targets = (request.routing?.targets || []).map((target) => target.name).join(", ");
  if (targets) {
    lines.push(`- **📟 Routed to:** ${targets}`);
  }
  lines.push(`- **🕐 Time:** ${timestampLine()}`);
  return lines.join("\n");
}

function earlyWarningMarkdown(request) {
  const lines = [`## ⚠️ EARLY WARNING — ${String(request.hazard || "hazard").toUpperCase()}`];
  if (request.message) {
    lines.push(`> ${String(request.message).slice(0, 300)}`);
  }
  lines.push(`- **📍 Detected at:** ${request.podName || request.podId || "sensor pod"}`);
  lines.push(`- **📡 Response:** signed broadcast sent to all pods`);
  lines.push(`- **🕐 Time:** ${timestampLine()}`);
  return lines.join("\n");
}

function saturationMarkdown(request, saturatedRoles) {
  const roles = saturatedRoles.map((role) => role.toUpperCase()).join(", ");
  const targets = (request.routing?.targets || []).map((target) => target.name).join(", ");
  const lines = [`## 🆘 RESOURCE SATURATION — every ${roles} coordinator is OUT OF STOCK`];
  if (request.message) {
    lines.push(`> "${String(request.message).slice(0, 300)}"`);
  }
  lines.push(`- **What happened:** the network had no stocked ${roles} team left for this SOS`);
  lines.push(`- **Fallback:** delivered to ${targets || "the out-of-stock team(s)"} anyway — a struggling responder beats silence`);
  lines.push(`- **👉 Operator action needed:** restock, reassign, or activate an external facility`);
  lines.push(`- **Where:** ${locationOf(request)} (${request.podId || "pod unknown"})`);
  lines.push(`- **🕐 Time:** ${timestampLine()}`);
  return lines.join("\n");
}

function queueRetry(key, markdown, attempts) {
  if (attempts >= MAX_RETRY_ATTEMPTS || retryQueue.length >= MAX_RETRY_QUEUE) {
    console.warn(`[cloud-api][webex] alert ${key} dropped after ${attempts} attempt(s)`);
    return;
  }
  retryQueue.push({ key, markdown, attempts });
}

async function deliver(key, markdown, attempts) {
  try {
    const result = await postToRooms(markdown);
    if (result.sent > 0) {
      console.log(`[cloud-api][webex] alert ${key} posted to ${result.sent} space(s)`);
      return;
    }
    queueRetry(key, markdown, attempts + 1);
  } catch (error) {
    console.warn(`[cloud-api][webex] alert ${key} failed (attempt ${attempts + 1}): ${error.message}`);
    queueRetry(key, markdown, attempts + 1);
  }
}

// One alert per request id, ever — the same SOS re-arriving over mesh, or
// the AI confirming a request that already alerted at ingest, stays silent.
async function notify(key, markdown) {
  if (!WEBEX_ENABLED || notifiedKeys.has(key)) {
    return;
  }
  if (rateLimited()) {
    console.warn(`[cloud-api][webex] rate limit reached, skipped alert ${key}`);
    return;
  }

  rememberKey(key);
  await deliver(key, markdown, 0);
}

if (WEBEX_ENABLED) {
  // unref: the retry timer must never keep a test harness process alive.
  setInterval(() => {
    if (retryQueue.length === 0 || rateLimited()) {
      return;
    }
    const item = retryQueue.shift();
    deliver(item.key, item.markdown, item.attempts).catch(() => {});
  }, RETRY_INTERVAL_MS).unref();
}

function notifyCriticalRequest(request, options = {}) {
  if (!request?.id || isDemoSeed(request) || tooOldToAlert(request)) {
    return;
  }
  notify(`critical:${request.id}`, criticalAlertMarkdown(request, options)).catch(() => {});
}

function notifyEarlyWarning(request) {
  if (!request?.id || isDemoSeed(request) || tooOldToAlert(request)) {
    return;
  }
  notify(`warning:${request.id}`, earlyWarningMarkdown(request)).catch(() => {});
}

// The routing layer had to deliver to out-of-stock coordinators because the
// whole role tier is saturated — the one situation only a human can fix.
function notifyResourceSaturation(request, saturatedRoles = []) {
  if (!request?.id || !saturatedRoles.length || isDemoSeed(request) || tooOldToAlert(request)) {
    return;
  }
  notify(`saturation:${request.id}`, saturationMarkdown(request, saturatedRoles)).catch(() => {});
}

async function sendTestAlert() {
  const markdown = [
    "## ✅ SANJEEVANI test alert",
    "- **Status:** Sanjeevni-Sentinel is wired to the EOC cloud",
    "- **You will receive:** 🚨 critical SOS · 🤖 AI-upgraded emergencies · ⚠️ sensor early warnings",
    `- **🕐 Time:** ${timestampLine()}`
  ].join("\n");
  return postToRooms(markdown);
}

async function webexHealth() {
  if (!WEBEX_ENABLED) {
    return { enabled: false, status: BOT_TOKEN ? "disabled" : "no-token" };
  }

  try {
    if (!botIdentity) {
      const response = await axios.get(`${WEBEX_API}/people/me`, {
        headers: authHeaders,
        timeout: SEND_TIMEOUT_MS
      });
      botIdentity = {
        name: response.data?.displayName,
        username: (response.data?.emails || [])[0]
      };
    }
    const rooms = await refreshRooms(true);
    return {
      enabled: true,
      status: rooms.length ? "ready" : "no-spaces",
      bot: botIdentity,
      spaces: rooms.map((room) => room.title)
    };
  } catch (error) {
    return { enabled: true, status: "unreachable", error: error.response?.status || error.message };
  }
}

module.exports = {
  WEBEX_ENABLED,
  notifyCriticalRequest,
  notifyEarlyWarning,
  notifyResourceSaturation,
  sendTestAlert,
  webexHealth
};
