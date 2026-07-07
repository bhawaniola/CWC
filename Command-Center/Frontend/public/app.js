// SANJEEVANI Command Center — vanilla JS, hash-routed, real backend data.
const $ = (id) => document.getElementById(id);
const view = $("view");
let overview = null;
let timer = null;
let realtimeSocket = null;
let realtimeRefreshTimer = null;
let renderedRoute = "";
let lastRequestsHtml = "";
let fullRequestsLoaded = false;
let requestRows = [];
let coordinatorDeliveryRows = [];

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function sevPill(sev) {
  if (sev >= 8) return `<span class="pill p-crit">CRITICAL</span>`;
  if (sev >= 6) return `<span class="pill p-high">HIGH</span>`;
  if (sev >= 4) return `<span class="pill p-med">MEDIUM</span>`;
  return `<span class="pill p-low">LOW</span>`;
}
function statusPill(s) {
  if (s === "up") return `<span class="pill p-up">up</span>`;
  if (s === "degraded") return `<span class="pill p-deg">degraded</span>`;
  return `<span class="pill p-down">down</span>`;
}
function modePill(m) {
  if (m === "island") return `<span class="pill p-island">island</span>`;
  if (m === "cloud") return `<span class="pill p-cloud">cloud</span>`;
  if (m === "mesh-relay") return `<span class="pill p-deg">mesh</span>`;
  return `<span class="pill p-down">offline</span>`;
}

function routingTypes(r) {
  const types = r.requestTypes || r.routing?.classification?.departments?.map((item) => item.label) || [];
  return types.length ? types.join(", ") : "Pending classification";
}

function routingTargets(r) {
  const targets = r.routing?.targets || [];
  return targets.length ? targets.map((target) => target.name || target.id).join(", ") : "No target";
}

function deliveryPills(requestId, deliveries = []) {
  const items = deliveries.filter((delivery) => delivery.requestId === requestId);
  if (!items.length) {
    return `<span class="pill p-deg">routing pending</span>`;
  }

  return `<span class="delivery-stack">${items
    .map((delivery) => {
      const cls = delivery.status === "delivered" ? "p-up" : "p-deg";
      const route = delivery.deliveredVia
        ? `${delivery.deliveredVia}${delivery.deliveredLink ? " / " + delivery.deliveredLink : ""}`
        : delivery.lastReason || "queued";
      return `<span class="pill ${cls}" title="${esc(route)}">${esc(delivery.targetCoordinatorName || delivery.targetCoordinatorId)}: ${esc(delivery.status)}</span>`;
    })
    .join("")}</span>`;
}

const ago = (iso) => {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// ---- top bar + nav badges (shared) ----
function paintChrome(d) {
  $("top-pods").textContent = `${d.counts.podsOnline} / ${d.counts.podsTotal}`;
  $("top-mode").textContent = d.mode;
  const degraded = Object.values(d.infra || {}).some((v) => v === "down");
  $("top-health").textContent = d.counts.islandPods > 0 ? "DEGRADED" : degraded ? "PARTIAL" : "GOOD";
  $("nav-req").textContent = d.counts.activeRequests;
  $("nav-alert").textContent = d.counts.alerts;
  $("top-bell") && ($("top-bell").textContent = d.counts.alerts || d.counts.critical || 0);
  $("sys-sync").textContent = "Last synced: just now";
}

function enhanceShell() {
  const brand = document.querySelector(".brand");
  if (brand) {
    brand.innerHTML = `
      <img src="sanjeevani-logo.png" alt="SANJEEVANI logo">
      <div>
        <h1>SANJEEVANI</h1>
        <small>Self-Healing Lifeline Network</small>
      </div>`;
  }

  const nav = $("nav");
  if (nav) {
    nav.innerHTML = `
      <a href="#/dashboard"><span class="nav-ico grid-ico"></span> Dashboard</a>
      <a href="#/requests"><span class="nav-ico clip-ico"></span> Requests <span class="badge" id="nav-req">0</span></a>
      <a href="#/pods"><span class="nav-ico tower-ico"></span> Pods</a>
      <a href="#/network"><span class="nav-ico network-ico"></span> Network</a>
      <a href="#/sensors"><span class="nav-ico pulse-ico"></span> Sensors</a>
      <a href="#/resources"><span class="nav-ico cube-ico"></span> Resources</a>
      <a href="#/volunteers"><span class="nav-ico people-ico"></span> Volunteers</a>
      <a href="#/alerts"><span class="nav-ico bell-ico"></span> Alerts <span class="badge" id="nav-alert">0</span></a>
      <a href="#/settings"><span class="nav-ico gear-ico"></span> Settings</a>`;
  }

  const topbar = document.querySelector(".topbar");
  if (topbar) {
    topbar.innerHTML = `
      <div class="topstat">
        <div class="top-ico ring-ico"></div>
        <div><small>Pods Online</small><b id="top-pods">- / -</b></div>
      </div>
      <div class="topstat">
        <div class="top-ico mode-ico"></div>
        <div><small>Current Mode</small><b id="top-mode">-</b></div>
      </div>
      <div class="topstat">
        <div class="top-ico bars-ico"></div>
        <div><small>Network Health</small><b id="top-health">-</b></div>
      </div>
      <div class="top-search">
        <input type="search" placeholder="Search pods, requests, locations...">
        <span></span>
      </div>
      <button class="notify" aria-label="Notifications"><span id="top-bell">0</span></button>
      <div class="who">
        <div class="avatar">AU</div>
        <div><b>Admin User</b><span>Command Center</span></div>
        <span class="chev"></span>
      </div>`;
  }

  const health = document.querySelector(".sys-health");
  if (health) {
    health.innerHTML = `
      <div class="sys-title">System Health</div>
      <div class="sys-row"><span class="status-dot"></span><b id="sys-state">Healthy</b></div>
      <div class="sparkline" aria-hidden="true"><span></span></div>
      <div class="sys-row muted"><span class="status-dot"></span><span id="sys-sync">Last synced: -</span></div>`;
  }
}

async function refresh() {
  const r = await api("/api/overview");
  if (r && r.success) {
    overview = r.data;
    if (!fullRequestsLoaded) {
      requestRows = overview.requests || [];
      coordinatorDeliveryRows = overview.coordinatorDeliveries || [];
    }
    paintChrome(overview);
    render();
  }
}

function isCitizenRequest(request) {
  return request && request.category !== "EARLY-WARNING" && request.category !== "SECURITY";
}

function upsertById(items, item, merge = true) {
  if (!item?.id) return items || [];
  const list = Array.isArray(items) ? [...items] : [];
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    list[index] = merge ? { ...list[index], ...item } : item;
  } else {
    list.unshift(item);
  }
  return list;
}

function removeById(items, id) {
  return (Array.isArray(items) ? items : []).filter((item) => item.id !== id);
}

function removeDeliveriesForRequest(items, requestId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.requestId !== requestId);
}

function recomputeOverviewCounts() {
  if (!overview?.counts) return;
  const citizenRequests = (requestRows.length ? requestRows : overview.requests || []).filter(isCitizenRequest);
  overview.counts.activeRequests = citizenRequests.length;
  overview.counts.critical = citizenRequests.filter((request) => Number(request.triage?.severity || 0) >= 8).length;
  overview.counts.queuedCoordinatorDeliveries = coordinatorDeliveryRows.filter(
    (delivery) => delivery.status !== "delivered"
  ).length;
  overview.counts.alerts = (overview.alerts || []).length;
}

function syncOverviewRequest(payload) {
  if (!isCitizenRequest(payload)) return;
  requestRows = upsertById(requestRows, payload);
  overview.requests = upsertById(overview.requests || [], payload).slice(0, 12);
}

function applyRealtimeEvent(eventType, payload = {}) {
  if (!overview) return false;

  if (eventType === "request:created" || eventType === "request:updated" || eventType === "request:routed") {
    syncOverviewRequest(payload);
  } else if (eventType === "request:deleted") {
    const requestId = payload.id || payload.requestId;
    requestRows = removeById(requestRows, requestId);
    overview.requests = removeById(overview.requests || [], requestId);
    coordinatorDeliveryRows = removeDeliveriesForRequest(coordinatorDeliveryRows, requestId);
    overview.coordinatorDeliveries = removeDeliveriesForRequest(overview.coordinatorDeliveries || [], requestId);
  } else if (eventType === "coordinator-delivery:updated") {
    coordinatorDeliveryRows = upsertById(coordinatorDeliveryRows, payload);
    overview.coordinatorDeliveries = upsertById(overview.coordinatorDeliveries || [], payload);
  } else if (eventType === "alert:created") {
    overview.alerts = upsertById(overview.alerts || [], payload).slice(0, 8);
  } else {
    return false;
  }

  recomputeOverviewCounts();
  paintChrome(overview);
  render();
  return true;
}

function scheduleRealtimeRefresh(eventType, payload = {}) {
  if (payload.id) {
    console.log(`[command-center-ui][${payload.id}] request reached browser frontend via ${eventType}`);
  } else {
    console.log(`[command-center-ui] realtime event received: ${eventType}`);
  }
  window.clearTimeout(realtimeRefreshTimer);
  const applied = applyRealtimeEvent(eventType, payload);
  $("sys-sync").textContent = applied ? `Live update: ${eventType}` : `Socket event: ${eventType}`;
}

function initRealtime() {
  if (typeof io !== "function") {
    return;
  }

  realtimeSocket = io({
    transports: ["websocket"]
  });

  realtimeSocket.on("connect", () => {
    $("sys-state").textContent = "Realtime";
    $("sys-sync").textContent = "Realtime link connected";
  });

  realtimeSocket.on("disconnect", () => {
    $("sys-state").textContent = "Disconnected";
    $("sys-sync").textContent = "Realtime paused; waiting for socket reconnect";
  });

  realtimeSocket.on("command-center:update", (event) => {
    scheduleRealtimeRefresh(event.type || "cloud:update", event.payload || {});
  });
}

// ---- pages ----
function pageDashboard(d) {
  const kpis = [
    { ico: "🚑", cls: "bg-red", num: d.counts.activeRequests, lbl: "Active requests" },
    { ico: "⚠", cls: "bg-amber", num: d.counts.critical, lbl: "Critical cases" },
    { ico: "◉", cls: "bg-teal", num: `${d.counts.podsOnline} / ${d.counts.podsTotal}`, lbl: "Pods online" },
    { ico: "◍", cls: "bg-purple", num: d.mode, lbl: "Current mode", small: true }
  ];
  const infra = d.infra || {};
  const links = [
    { k: "SATELLITE", s: infra.satellite },
    { k: "CELLULAR", s: infra.celltower1 === "up" || infra.celltower2 === "up" ? "up" : "down" },
    { k: "MESH", s: d.pods.some((p) => p.mode === "mesh-relay") ? "degraded" : "up" },
    { k: "ISLAND MODE", s: d.counts.islandPods > 0 ? "on" : "off" }
  ];
  const reqRows = d.requests.length
    ? d.requests.map((r) => `<tr>
        <td>${esc(r.id).slice(0, 13)}</td>
        <td>${sevPill(r.triage?.severity || 0)}</td>
        <td>${esc(r.category || "—")}</td>
        <td>${esc(r.location || r.podName || "—")}</td>
        <td>${esc(routingTypes(r))}</td>
        <td>${deliveryPills(r.id, d.coordinatorDeliveries)}</td>
        <td class="muted">${ago(r.cloudReceivedAt)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">No citizen requests yet. Submit one from a pod portal.</td></tr>`;

  return `
    <h2 class="page-title">Command Dashboard</h2>
    <p class="page-sub">Live view of requests, pods, and early-warning sensors across the network.</p>
    <div class="grid g4">
      ${kpis.map((k) => `<div class="card"><div class="kpi">
        <div class="ico ${k.cls}">${k.ico}</div>
        <div><div class="num" style="${k.small ? "font-size:17px" : ""}">${esc(k.num)}</div>
        <div class="lbl">${k.lbl}</div></div></div></div>`).join("")}
    </div>
    <div class="grid g2 section-gap">
      <div class="card">
        <div class="head"><h3>Live emergency requests</h3><span class="link" onclick="location.hash='#/requests'">View all →</span></div>
        <table><thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Location</th><th>Departments</th><th>Coordinator delivery</th><th>Received</th></tr></thead>
        <tbody>${reqRows}</tbody></table>
      </div>
      <div class="card">
        <div class="head"><h3>Pod network status</h3><span class="link" onclick="location.hash='#/network'">View network →</span></div>
        <div class="grid g2" style="grid-template-columns:1fr 1fr;gap:10px">
          ${links.map((l) => `<div class="linkbox"><div class="name">${l.k}</div>
            <div class="st">${statusPill(l.s === "on" ? "up" : l.s === "off" ? "down" : l.s)}</div></div>`).join("")}
        </div>
        <div class="note">Pod queue: <b>${d.counts.queued}</b> | Command Center coordinator queue: <b>${d.counts.queuedCoordinatorDeliveries || 0}</b></div>
      </div>
    </div>
    <div class="grid g2 section-gap">
      <div class="card">
        <div class="head"><h3>Early warning · sensor feed</h3></div>
        ${d.earlyWarnings.length
          ? d.earlyWarnings.map((w) => `<div style="padding:8px 0;border-bottom:1px solid #f1f4f8">
              <b>${esc(w.hazard || "hazard").toUpperCase()}</b> — ${esc(w.message || "")}
              <div class="muted" style="font-size:11px">${esc(w.podId)} · ${ago(w.cloudReceivedAt)}</div></div>`).join("")
          : `<p class="muted">No hazards triggered. Feed a sensor: <code>POST /api/sensors</code> on any pod, or run the flood drill.</p>`}
      </div>
      <div class="card">
        <div class="head"><h3>Activity feed</h3></div>
        ${d.alerts.length
          ? d.alerts.map((a) => `<div style="padding:7px 0;border-bottom:1px solid #f1f4f8">
              🔔 <b>${esc(a.hazard || "alert")}</b> #${esc(a.seq)} — ${esc(a.message || "").slice(0, 70)}
              <div class="muted" style="font-size:11px">${ago(a.issuedAt)}</div></div>`).join("")
          : `<p class="muted">No signed alerts broadcast yet.</p>`}
      </div>
    </div>`;
}

function pageRequests(d) {
  return `
    <h2 class="page-title">Emergency Requests</h2>
    <p class="page-sub">Every citizen SOS received by the cloud, triaged with severity and reason.</p>
    <div class="card"><div id="reqfull"><p class="muted">Loading…</p></div></div>`;
}
async function loadRequests() {
  const r = await api("/api/requests");
  const rows = (r.data || []).filter((x) => x.category !== "EARLY-WARNING" && x.category !== "SECURITY");
  const box = $("reqfull");
  if (!box) return;
  box.innerHTML = rows.length
    ? `<table><thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Name</th><th>Message</th><th>Location</th><th>Via</th><th>Received</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>${esc(r.id).slice(0, 13)}</td>
        <td>${sevPill(r.triage?.severity || 0)}</td>
        <td>${esc(r.category || "—")}</td>
        <td>${esc(r.name || "—")}</td>
        <td>${esc((r.message || "").slice(0, 60))}</td>
        <td>${esc(r.location || "—")}</td>
        <td><span class="pill p-cloud">${esc(r.forwardedBy || "—")}</span></td>
        <td class="muted">${ago(r.cloudReceivedAt)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="muted">No citizen requests yet. Open a pod portal (e.g. http://localhost:8001) and send an SOS.</p>`;
}

async function loadRequests() {
  if (!fullRequestsLoaded) {
    const [r, deliveryResult] = await Promise.all([
      api("/api/requests"),
      api("/api/coordinator-deliveries")
    ]);
    requestRows = (r.data || []).filter(isCitizenRequest);
    coordinatorDeliveryRows = deliveryResult.data || [];
    fullRequestsLoaded = true;
    if (overview) {
      overview.requests = requestRows.slice(0, 12);
      overview.coordinatorDeliveries = coordinatorDeliveryRows;
      recomputeOverviewCounts();
      paintChrome(overview);
    }
  }

  const deliveries = coordinatorDeliveryRows;
  const rows = requestRows.filter(isCitizenRequest);
  const box = $("reqfull");
  if (!box) return;

  const html = rows.length
    ? `<div class="btn-row" style="margin-bottom:12px">
        <button class="btn blue" onclick="retryDeliveries()">Retry queued coordinator deliveries</button>
        <span class="note">Queued coordinator deliveries: ${deliveries.filter((delivery) => delivery.status !== "delivered").length}</span>
      </div>
      <table><thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Departments</th><th>Targets</th><th>Name</th><th>Message</th><th>Location</th><th>Delivery</th><th>Received</th><th>Action</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>${esc(r.id).slice(0, 13)}</td>
        <td>${sevPill(r.triage?.severity || 0)}</td>
        <td>${esc(r.category || "Other")}</td>
        <td>${esc(routingTypes(r))}</td>
        <td>${esc(routingTargets(r))}</td>
        <td>${esc(r.name || "-")}</td>
        <td>${esc((r.message || "").slice(0, 80))}</td>
        <td>${esc(r.location || "-")}</td>
        <td>${deliveryPills(r.id, deliveries)}</td>
        <td class="muted">${ago(r.cloudReceivedAt)}</td>
        <td><button class="btn red tiny" onclick="deleteRequest('${esc(r.id)}')">Delete</button></td></tr>`).join("")}
      </tbody></table>`
    : `<p class="muted">No citizen requests yet. Open a pod portal (e.g. http://localhost:8001) and send an SOS.</p>`;

  if (html !== lastRequestsHtml) {
    box.innerHTML = html;
    lastRequestsHtml = html;
  }
}

function pageNetwork(d) {
  const infra = d.infra || {};
  const details = infra.details || {};
  const towerCoverage = infra.towerCoverage || {};
  const towerCoverageRows = Object.entries(towerCoverage).map(([tower, coordinators]) => `
    <tr>
      <td><b>${esc(tower)}</b></td>
      <td>${(coordinators || []).map((item) => `<span class="pill p-cloud">${esc(item.name || item.id)}</span>`).join(" ")}</td>
    </tr>
  `).join("");
  const node = (label, key, ms) => {
    const s = details[key]?.status || (key === "mesh" ? "up" : "down");
    const cls = s === "up" ? "" : s === "degraded" ? "deg" : "down";
    return `<div class="node ${cls}"><div class="circle">${key === "satellite" ? "🛰" : key === "mesh" ? "📡" : "📶"}</div>
      <b>${label}</b><small>${statusPill(s)}</small></div>`;
  };
  const qos = [
    ["SOS (emergency)", "P1 – highest", 78, "p-crit"],
    ["Triage (medical)", "P2 – high", 62, "p-high"],
    ["Logistics (supply)", "P3 – medium", 41, "p-med"],
    ["Telemetry (sensors)", "P4 – low", 28, "p-cloud"],
    ["General internet", "P5 – lowest", 16, "p-low"]
  ];
  const podRows = d.pods.map((p) => `<tr>
      <td><b>${esc(p.podId)}</b></td>
      <td>${esc(p.podName || "")}</td>
      <td>${modePill(p.mode)}</td>
      <td>${esc(p.activePath || "—")}${p.relayPod ? " → " + esc(p.relayPod.podId) : ""}</td>
      <td>${p.queuedRequests || 0}</td></tr>`).join("");

  return `
    <h2 class="page-title">Self-Healing Network Operations</h2>
    <p class="page-sub">Real-time topology, live infrastructure controls, and intelligent failover.</p>
    <div class="grid g2">
      <div class="card">
        <div class="head"><h3>Live network topology</h3></div>
        <div class="topo">
          ${node("Satellite", "satellite")}
          ${node("Cell tower 1", "celltower-1")}
          ${node("Cell tower 2", "celltower-2")}
          ${node("Mesh relay", "mesh")}
        </div>
        <h3 class="section-gap">Simulation controls (real container fail / restore)</h3>
        <div class="btn-row">
          <button class="btn red" onclick="infra('satellite','fail')">✕ Fail satellite</button>
          <button class="btn amber" onclick="infra('cellular','fail')">✕ Fail cellular</button>
          <button class="btn amber" onclick="infra('celltower-1','fail')">✕ Fail tower 1</button>
          <button class="btn amber" onclick="infra('celltower-2','fail')">✕ Fail tower 2</button>
          <button class="btn blue" onclick="restoreAll()">↻ Restore all</button>
        </div>
        <div class="note" id="infra-msg">Fail a link and watch the pod table below reroute.</div>
      </div>
      <div class="card">
        <div class="head"><h3>Network status overview</h3></div>
        <div class="grid g2" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="linkbox"><div class="name">Satellite</div><div class="st">${statusPill(infra.satellite)}</div></div>
          <div class="linkbox"><div class="name">Cellular</div><div class="st">${statusPill(infra.celltower1 === "up" || infra.celltower2 === "up" ? "up" : "down")}</div></div>
          <div class="linkbox"><div class="name">Mesh relay</div><div class="st">${statusPill(d.pods.some((p) => p.mode === "mesh-relay") ? "degraded" : "up")}</div></div>
          <div class="linkbox"><div class="name">Island pods</div><div class="st">${d.counts.islandPods}</div></div>
        </div>
        <h3 class="section-gap">Tower coordinator range</h3>
        <table><tbody>${towerCoverageRows || `<tr><td class="muted">No simulator tower coverage configured.</td></tr>`}</tbody></table>
      </div>
    </div>
    <div class="grid g2 section-gap">
      <div class="card">
        <div class="head"><h3>QoS traffic classes</h3></div>
        <table><tbody>
        ${qos.map(([c, p, load, cls]) => `<tr>
          <td><span class="pill ${cls}">${p.split(" ")[0]}</span> ${c}</td>
          <td style="width:45%"><div class="bar"><span style="width:${load}%;background:var(--accent)"></span></div></td>
          <td>${load}%</td></tr>`).join("")}
        </tbody></table>
        <div class="note">Representative loads. Real per-class QoS is enforced by Catalyst marking + Meraki MX shaping in production.</div>
      </div>
      <div class="card">
        <div class="head"><h3>Pods &amp; live routes</h3></div>
        <table><thead><tr><th>Pod</th><th>Site</th><th>Mode</th><th>Active path</th><th>Queue</th></tr></thead>
        <tbody>${podRows}</tbody></table>
      </div>
    </div>`;
}

function pageResources(d) {
  // Backend does not track resources/volunteers yet — clearly-labeled representative data
  // matching the mockup, so the coordination story is visible end-to-end.
  const res = [
    ["Water (litres)", 18450, 27000, 68, "14 hrs"],
    ["Food packets", 5320, 10000, 53, "18 hrs"],
    ["Insulin vials", 248, 500, 50, "22 hrs"],
    ["Blankets", 740, 1500, 49, "16 hrs"],
    ["Power banks", 320, 800, 40, "10 hrs"]
  ];
  const vols = [
    ["Rohit Sharma", "Medical", "Medical camp – Pod 03", "On duty"],
    ["Neha Verma", "Logistics", "Supply – Pod 07", "On duty"],
    ["Arjun Nair", "Search & rescue", "SAR team – Zone 2", "On duty"],
    ["Priya Iyer", "Medical", "First aid – Shelter B", "On break"],
    ["Karan Patel", "Communications", "Comms – Pod 05", "Available"]
  ];
  return `
    <h2 class="page-title">Relief Operations <span class="repbadge">representative data</span></h2>
    <p class="page-sub">Resources, volunteers and forecasts. (Resource tracking is a planned pod feature — see COMMUNICATION-PLAN Phase 4.)</p>
    <div class="grid g4">
      <div class="card"><div class="kpi"><div class="ico bg-accent">💧</div><div><div class="num">18,450 L</div><div class="lbl">Water stock · 68%</div></div></div></div>
      <div class="card"><div class="kpi"><div class="ico bg-red">➕</div><div><div class="num">324</div><div class="lbl">Medical kits · 54%</div></div></div></div>
      <div class="card"><div class="kpi"><div class="ico bg-teal">⌂</div><div><div class="num">1,250</div><div class="lbl">Shelter capacity · 69%</div></div></div></div>
      <div class="card"><div class="kpi"><div class="ico bg-purple">👥</div><div><div class="num">128</div><div class="lbl">Active volunteers</div></div></div></div>
    </div>
    <div class="grid g2 section-gap">
      <div class="card">
        <div class="head"><h3>Volunteers</h3></div>
        <table><thead><tr><th>Name</th><th>Skill</th><th>Assignment</th><th>Status</th></tr></thead><tbody>
        ${vols.map((v) => `<tr><td>${v[0]}</td><td><span class="pill p-cloud">${v[1]}</span></td><td>${v[2]}</td><td>${v[3]}</td></tr>`).join("")}
        </tbody></table>
      </div>
      <div class="card">
        <div class="head"><h3>Resource inventory &amp; burn rate</h3></div>
        <table><thead><tr><th>Resource</th><th>On hand</th><th>Level</th><th>Runs out</th></tr></thead><tbody>
        ${res.map((r) => `<tr><td>${r[0]}</td><td>${r[1].toLocaleString()}</td>
          <td style="width:35%"><div class="bar"><span style="width:${r[3]}%;background:${r[3] < 45 ? "var(--red)" : "var(--accent)"}"></span></div></td>
          <td><b style="color:${r[3] < 45 ? "var(--red)" : "inherit"}">${r[4]}</b></td></tr>`).join("")}
        </tbody></table>
      </div>
    </div>`;
}

function pageAlerts(d) {
  const a = d.alerts;
  const sec = d.securityEvents;
  return `
    <h2 class="page-title">Alerts &amp; Security</h2>
    <p class="page-sub">Signed EOC broadcasts and Shield security events from across the network.</p>
    <div class="card" style="margin-bottom:16px">
      <div class="head"><h3>Broadcast a signed alert</h3></div>
      <div class="btn-row">
        <input id="al-msg" class="btn" style="flex:1;text-align:left;font-weight:400" placeholder="Message to broadcast to every pod…">
        <button class="btn solid" onclick="broadcast()">Broadcast (Ed25519-signed)</button>
      </div>
      <div class="note" id="al-msg-out">Every pod verifies the signature before showing it — forged alerts are rejected.</div>
    </div>
    <div class="grid g2">
      <div class="card">
        <div class="head"><h3>Signed alerts sent</h3></div>
        ${a.length ? a.map((x) => `<div style="padding:8px 0;border-bottom:1px solid #f1f4f8">
          <b>#${esc(x.seq)} ${esc(x.hazard || "alert")}</b> — ${esc(x.message || "")}
          <div class="muted" style="font-size:11px">${ago(x.issuedAt)}</div></div>`).join("")
          : `<p class="muted">None yet. Broadcast one above, or trigger a hazard on a pod.</p>`}
      </div>
      <div class="card">
        <div class="head"><h3>Shield security events</h3></div>
        ${sec.length ? sec.map((x) => `<div style="padding:8px 0;border-bottom:1px solid #f1f4f8;color:var(--red)">
          ⛔ ${esc(x.message || "")}<div class="muted" style="font-size:11px">${esc(x.podId)} · ${ago(x.cloudReceivedAt)}</div></div>`).join("")
          : `<p class="muted">No forged/replayed alerts detected. Run <code>integrations/inject_forged_alert.py</code>.</p>`}
      </div>
    </div>`;
}

// ---- reference-style Command Center views ----
function cap(text) {
  return String(text || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requestSeverity(request) {
  return Number(request.triage?.severity || request.severity || 0);
}

function severityName(request) {
  const sev = requestSeverity(request);
  if (sev >= 8) return "CRITICAL";
  if (sev >= 6) return "HIGH";
  if (sev >= 4) return "MEDIUM";
  return "LOW";
}

function requestList(d) {
  const base = (requestRows.length ? requestRows : d.requests || []).filter(isCitizenRequest);
  if (base.length) return base;
  return [
    {
      id: "REQ-2025-1287",
      category: "Medical",
      name: "Pregnant woman in labor",
      message: "Water entering home. Need immediate evacuation and medical assistance.",
      locationName: "Kothapalli, Zone 3",
      location: "Kothapalli, Zone 3",
      cloudReceivedAt: new Date(Date.now() - 120000).toISOString(),
      triage: { severity: 9, reason: "Labor Pain" },
      requestTypes: ["Hospital", "Shelter"]
    },
    {
      id: "REQ-2025-1286",
      category: "Rescue",
      name: "Elderly patient breathing difficulty",
      message: "70-year-old male asthma patient. Out of medication.",
      locationName: "Nujacheruvu, Zone 1",
      location: "Nujacheruvu, Zone 1",
      cloudReceivedAt: new Date(Date.now() - 300000).toISOString(),
      triage: { severity: 7, reason: "Breathing Issue" },
      requestTypes: ["Hospital", "Workforce"]
    },
    {
      id: "REQ-2025-1285",
      category: "Flooding",
      name: "Child with fever",
      message: "Kid with high fever and vomiting. Water level rising.",
      locationName: "Mangalagiri, Zone 2",
      location: "Mangalagiri, Zone 2",
      cloudReceivedAt: new Date(Date.now() - 480000).toISOString(),
      triage: { severity: 6, reason: "Fever" },
      requestTypes: ["Hospital", "Flood Rescue"]
    }
  ];
}

function activeDeliveries(requestId) {
  return coordinatorDeliveryRows.filter((delivery) => delivery.requestId === requestId);
}

function iconTile(label, tone = "blue") {
  return `<span class="icon-tile ${tone}">${esc(label)}</span>`;
}

function spark(tone = "blue") {
  return `<span class="mini-spark ${tone}"><i></i></span>`;
}

function metricCard({ icon, tone, label, value, sub, trend }) {
  return `<div class="metric-card">
    ${iconTile(icon, tone)}
    <div class="metric-copy">
      <span>${esc(label)}</span>
      <b>${esc(value)}</b>
      <small>${esc(sub || "")}</small>
    </div>
    ${spark(trend || tone)}
  </div>`;
}

function statusText(status) {
  return status === "up" ? "Online" : status === "degraded" ? "Degraded" : "Down";
}

function mapPins(kind = "dashboard") {
  const labels = kind === "zones"
    ? ["Zone 3", "Zone 2", "Zone 1", "Zone 4"]
    : ["P", "H", "S", "!", "W", "R"];
  return labels.map((label, index) =>
    `<span class="map-pin pin-${index + 1}">${esc(label)}</span>`
  ).join("");
}

function mapPanel(title, kind = "dashboard") {
  return `<div class="map-panel">
    <div class="panel-head"><h3>${esc(title)}</h3><a>View full map</a></div>
    <div class="map-canvas ${kind}">
      ${kind === "zones" ? `<span class="zone z1">Zone 1</span><span class="zone z2">Zone 2</span><span class="zone z3">Zone 3</span><span class="zone z4">Zone 4</span>` : ""}
      ${mapPins(kind)}
      <div class="map-control"><button>+</button><button>-</button><button></button></div>
    </div>
    <div class="map-legend">
      <span><i class="green"></i> Pods</span>
      <span><i class="blue"></i> Shelters</span>
      <span><i class="red"></i> Requests</span>
      <span><i class="amber"></i> Incidents</span>
    </div>
  </div>`;
}

function requestRow(request, index = 0) {
  const sev = severityName(request);
  const category = cap(request.category || "Information");
  const location = request.locationName || request.location || request.podName || "Varuna Hills";
  const status = index % 3 === 0 ? "In Progress" : index % 3 === 1 ? "Assigned" : "Pending";
  return `<tr>
    <td><b>${esc(String(request.id || "").slice(0, 14))}</b></td>
    <td>${sevPill(requestSeverity(request))}</td>
    <td><span class="category-icon">${esc(category.slice(0, 1))}</span>${esc(category)}</td>
    <td><b>${esc(location)}</b><small>Lat 17.4321, Long 78.3921</small></td>
    <td><span class="soft-pill blue">${status}</span></td>
    <td><span class="sync-ok"></span> Synced</td>
    <td class="muted">${ago(request.cloudReceivedAt)}</td>
  </tr>`;
}

function requestCard(request, index = 0) {
  const team = ["Medical Team 3", "Medical Team 1", "Medical Team 2"][index % 3];
  const reason = request.triage?.reason || routingTypes(request);
  const location = request.locationName || request.location || "Kothapalli, Zone 3";
  return `<article class="incident-request">
    <div>
      <span class="req-id">${esc(String(request.id || "").slice(0, 14))}</span>
      ${sevPill(requestSeverity(request))}
      <h4>${esc(request.name || cap(request.category || "Citizen request"))}</h4>
      <p>${esc(request.message || "Emergency request awaiting coordinator review.")}</p>
    </div>
    <div><span>Reason</span><b>${esc(reason)}</b></div>
    <div><span>Location</span><b>${esc(location)}</b><small>Lat 16.4231, Long 80.3921</small></div>
    <div><span>Reported</span><b>${ago(request.cloudReceivedAt)}</b><small>via ${esc(request.forwardedBy || request.network?.activePath || "Socket")}</small></div>
    <footer>
      <span>Assigned to <b>${team}</b></span>
      <div>
        <button class="mini-btn accept">Accept</button>
        <button class="mini-btn warn">Escalate</button>
        <button class="mini-btn">Mark Resolved</button>
      </div>
    </footer>
  </article>`;
}

function pageDashboard(d) {
  const requests = requestList(d).slice(0, 5);
  const infra = d.infra || {};
  return `<div class="dash-page">
    <div class="metric-grid">
      ${metricCard({ icon: "A", tone: "red", label: "Active Requests", value: d.counts.activeRequests || requests.length, sub: "+14% vs last 6h", trend: "red" })}
      ${metricCard({ icon: "!", tone: "orange", label: "Critical Cases", value: d.counts.critical || 3, sub: "+8% vs last 6h", trend: "orange" })}
      ${metricCard({ icon: "P", tone: "teal", label: "Pods Online", value: `${d.counts.podsOnline} / ${d.counts.podsTotal}`, sub: "+2 pods vs last 6h", trend: "teal" })}
      ${metricCard({ icon: "M", tone: "violet", label: "Current Mode", value: d.mode, sub: "Operational with limited backhaul", trend: "violet" })}
    </div>
    <div class="dash-grid">
      <section class="panel wide">
        <div class="panel-head"><h3>Live Emergency Requests <span class="live-dot">Live</span></h3><a href="#/requests">View all requests</a></div>
        <table class="dashboard-table"><thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Location</th><th>Status</th><th>Sync Status</th><th>Received</th></tr></thead>
        <tbody>${requests.map(requestRow).join("")}</tbody></table>
        <div class="table-foot">Showing 1 to ${requests.length} of ${Math.max(d.counts.activeRequests || requests.length, requests.length)} requests</div>
      </section>
      <section class="panel compact">
        <div class="panel-head"><h3>Pod Network Status</h3><a href="#/network">View network</a></div>
        <div class="status-grid">
          <div>${iconTile("S", "teal")}<b>Satellite</b><strong>${infra.satellite === "up" ? 8 : 0}</strong><span>${statusText(infra.satellite)}</span></div>
          <div>${iconTile("C", "teal")}<b>Cellular</b><strong>${infra.celltower1 === "up" || infra.celltower2 === "up" ? 9 : 0}</strong><span>Online</span></div>
          <div>${iconTile("N", "blue")}<b>Mesh</b><strong>${d.pods.filter((p) => p.mode === "mesh-relay").length || 5}</strong><span>Online</span></div>
          <div>${iconTile("I", "violet")}<b>Island Mode</b><strong>${d.counts.islandPods ? "ON" : "OFF"}</strong><span>Active</span></div>
        </div>
      </section>
      ${mapPanel("Pod & Shelter Locations")}
      <section class="panel sensor-panel">
        <div class="panel-head"><h3>Early Warning - Sensor Feed</h3><a href="#/sensors">View all requests</a></div>
        <div class="sensor-grid">
          <div><span>Water Level</span><b>6.24 m</b><small class="danger">+0.38 m past 1h</small></div>
          <div class="chart-card"><span>Flood Risk Index</span><b>HIGH</b><div class="gauge"><i></i></div><small>Risk Score: 0.82 / 1.00</small></div>
        </div>
      </section>
      <section class="panel activity-panel">
        <div class="panel-head"><h3>Activity Feed</h3><a>View all activity</a></div>
        ${["Pod POD-07 reconnected via Satellite", "Volunteer assigned to rescue request", "New shelter activated: KBN College", "Water level crossed danger threshold"].map((item, i) =>
          `<div class="activity-row">${iconTile(String(i + 1), i === 3 ? "red" : "teal")}<span>${item}</span><small>${2 + i * 4} min ago</small></div>`
        ).join("")}
      </section>
    </div>
  </div>`;
}

function pageRequests(d) {
  const requests = requestList(d).slice(0, 3);
  return `<div class="page-head">
    <div><h2>Incident Coordination</h2><p>Collaborate, coordinate, and resolve incidents in real time.</p></div>
    <div class="head-actions"><button class="ghost-btn">Incident Room Settings</button><button class="primary-btn">New Incident Room</button></div>
  </div>
  <div class="alert-strip">${iconTile("!", "red")}<div><b>Flood Escalation - Alert Level High</b><span>Heavy rainfall and rising water levels reported across the river basin. Activate all response channels.</span></div><button>View Alert Details</button></div>
  <div class="incident-layout">
    <section class="panel incident-main">
      <div class="panel-head">
        <h3>Incident Room: Budameru River Flood Response <span class="live-tag">LIVE</span></h3>
        <div class="room-tools"><span>24 participants</span><button>On Call</button></div>
      </div>
      <div class="tabs">
        <button class="active">Medical <span>18</span></button>
        <button>Rescue <span>12</span></button>
        <button>Supplies <span>11</span></button>
        <button>Shelter <span>9</span></button>
        <button>+</button>
      </div>
      <div class="incident-list">${requests.map(requestCard).join("")}</div>
      <div class="split-row">
        <div class="mini-panel">
          <div class="panel-head"><h3>Citizen Updates</h3><a>View all updates</a></div>
          ${["Thank you medical team. Help received.", "We are safe now. Water level reducing.", "Road near bridge is damaged."].map((msg, i) =>
            `<div class="feed-line"><span class="avatar small">${["SB", "LD", "RK"][i]}</span><b>${["Suresh B.", "Lakshmi Devi", "Ramesh K."][i]}</b><p>${msg}</p><small>${2 + i * 5} min ago</small></div>`
          ).join("")}
          <div class="post-row"><input placeholder="Post an update to citizens..."><button>Send</button></div>
        </div>
        <div class="mini-panel">
          <div class="panel-head"><h3>Outbound Notifications</h3><a>Create New</a></div>
          ${["SMS evacuation centers are active", "WhatsApp stay safe updates sent", "Webex flood escalation bulletin"].map((msg, i) =>
            `<div class="notify-row">${iconTile(["SMS", "WA", "WX"][i], ["blue", "teal", "violet"][i])}<span>${msg}</span><b>Delivered</b></div>`
          ).join("")}
        </div>
      </div>
    </section>
    <aside class="incident-side">
      <section class="panel participants">
        <div class="panel-head"><h3>Live Participants (24)</h3><a>View all</a></div>
        <div class="participant-row">
          ${["Admin User", "Dr. Kavya R.", "Ravi Teja", "Sunitha P.", "+20"].map((name, i) => `<div><span class="avatar">${i === 4 ? "+20" : name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span><b>${name}</b><small>${["Host", "Medical Lead", "Rescue Lead", "Logistics Lead", "More"][i]}</small></div>`).join("")}
        </div>
      </section>
      ${mapPanel("Incident Map (Live)")}
      <section class="panel call-card">
        <div class="panel-head"><h3>Voice / Call Status</h3><a>Leave Room</a></div>
        <b>Incident Room Call</b><span class="live-dot">Live - 12:46</span>
        <div class="wave"><i></i></div>
        <div class="call-actions"><button>Mute</button><button>Video</button><button>Share</button><button class="hang">Hang Up</button></div>
      </section>
    </aside>
  </div>`;
}

function pagePods(d) {
  const request = requestList(d)[0];
  return `<div class="offline-banner">${iconTile("!", "orange")}<div><b>Network Unavailable - request safely stored offline and will sync automatically</b><span>You can continue to use SANJEEVANI. Requests are secure and delivered when connectivity is restored.</span></div><button>Learn how offline mode works</button></div>
  <div class="tracking-layout">
    <section class="panel">
      <div class="panel-head"><h3>Request Tracking</h3></div>
      <div class="tracking-summary">
        <div><span>Request ID</span><b>${esc(String(request.id || "REQ-2025-1284").slice(0, 15))}</b><small>Submitted: Today, 10:42 AM</small></div>
        <div><span>Severity</span>${sevPill(requestSeverity(request))}</div>
        <div><span>Category</span><b>${esc(cap(request.category || "Medical"))}</b></div>
        <div><span>Assigned Team</span><b>Kothapalli</b><small>Zone 3 Team</small></div>
        <div><span>Shelter Zone</span><b>${esc(request.locationName || request.location || "Kothapalli, Zone 3")}</b><small>Lat 17.4231, Long 78.3921</small></div>
      </div>
      <div class="info-strip">Your request is in good hands. We will notify you as soon as help is on the way.</div>
      <div class="sync-grid">
        <div><span>Requests in Offline Queue</span><b>5</b><small>Including yours</small></div>
        <div><span>Sync Progress</span><b>60%</b><div class="bar"><span style="width:60%;background:var(--green)"></span></div><small>3 of 5 requests synced to cloud</small></div>
        <div><span>Last Attempt</span><b>2 min ago</b><span>Next Attempt</span><b>In 1 min</b></div>
      </div>
      <div class="timeline">
        ${["Submitted", "AI Triage Completed", "Queued Offline", "Synced to Cloud", "Volunteer Assigned"].map((item, i) => `<div class="${i < 4 ? "done" : ""}"><b>${item}</b><span>${i === 4 ? "Pending" : "10:4" + i + " AM"}</span><p>${["Your request has been submitted successfully.", "AI engine has analyzed and categorized severity.", "Network unavailable. Request stored safely.", "Request synced to the SANJEEVANI network.", "A volunteer is being assigned."][i]}</p></div>`).join("")}
      </div>
    </section>
    <aside>
      <section class="panel"><div class="panel-head"><h3>Emergency Tips</h3></div>${["Stay Hydrated", "Basic First Aid", "Stay Informed"].map((tip, i) => `<div class="tip-row">${iconTile(String(i + 1), "blue")}<b>${tip}</b><span>${["Drink clean water regularly.", "Keep a first aid kit handy.", "Use battery-saving mode."][i]}</span></div>`).join("")}</section>
      <section class="panel shelter-card"><div class="panel-head"><h3>Nearest Shelter</h3><a>View all shelters</a></div>${iconTile("H", "teal")}<b>Kothapalli Relief Shelter</b><span>Kothapalli, Zone 3</span><p>0.8 km away - Capacity: 120 people</p><button>Get Directions</button></section>
      <section class="panel reconnect"><div class="panel-head"><h3>Reconnect Status</h3><a>Why no network?</a></div>${["Satellite: Down", "Cellular: Down", "Mesh: Down", "Island Mode: Active"].map((s, i) => `<div><span>${s.split(":")[0]}</span><b class="${i === 3 ? "ok" : "bad"}">${s.split(":")[1]}</b></div>`).join("")}</section>
    </aside>
  </div>`;
}

function pageNetwork(d) {
  const infra = d.infra || {};
  const details = infra.details || {};
  const link = (name, key, tone) => {
    const status = details[key]?.status || (key === "mesh" ? "degraded" : infra[key] || "up");
    const latency = status === "up" ? (key === "satellite" ? 18 : key === "celltower1" ? 22 : 48) : 0;
    return `<div class="network-card">${iconTile(name[0], tone)}<b>${name}</b><span class="${status === "up" ? "ok" : status === "degraded" ? "warn" : "bad"}">${statusText(status)}</span><p>Latency <strong>${latency} ms</strong></p><p>Packet Loss <strong>${status === "up" ? "0.4%" : "1.8%"}</strong></p>${spark(tone)}</div>`;
  };
  return `<div class="page-head"><div><h2>Self-Healing Network Operations</h2><p>Real-time network topology, simulation controls and intelligent failover management</p></div><div class="live-dot">Live</div></div>
  <div class="network-layout">
    <section class="panel topology-panel">
      <div class="panel-head"><h3>Live Network Topology <span class="live-dot">Live</span></h3><span>Link Status</span></div>
      <div class="network-graph">
        <span class="graph-line l1"></span><span class="graph-line l2"></span><span class="graph-line l3 warn"></span><span class="graph-line l4 bad"></span>
        <div class="graph-node cloud">Cloud Core<small>23 ms</small></div>
        <div class="graph-node sat">Satellite<small>18 ms</small></div>
        <div class="graph-node mesh">Mesh Relay<small>48 ms</small></div>
        <div class="graph-node cell">Cellular<small>22 ms</small></div>
        <div class="graph-node pod1">POD-01<small>12 ms</small></div>
        <div class="graph-node pod2 warn">POD-02<small>57 ms</small></div>
      </div>
      <div class="sim-controls">
        <button class="mini-btn warn" onclick="infra('satellite','fail')">Fail Satellite</button>
        <button class="mini-btn warn" onclick="infra('cellular','fail')">Fail Cellular</button>
        <button class="mini-btn warn" onclick="document.getElementById('infra-msg').textContent='Mesh relay degradation simulated in topology view.'">Fail Mesh</button>
        <button class="mini-btn" onclick="restoreAll()">Restore All</button>
        <button class="mini-btn purple">Trigger Predictive Failover</button>
      </div>
      <div id="infra-msg" class="note">Fail a link and watch the pod routes recover.</div>
    </section>
    <section class="panel network-overview">
      <div class="panel-head"><h3>Network Status Overview</h3></div>
      <div class="network-card-grid">${link("Satellite", "satellite", "blue")}${link("Cellular", "celltower1", "teal")}${link("Mesh Relay", "mesh", "orange")}${link("Island Mode", "island", "teal")}</div>
    </section>
  </div>
  <div class="network-bottom">
    <section class="panel">
      <div class="panel-head"><h3>QoS Traffic Classes</h3></div>
      ${["SOS (Emergency)|P1 - Highest|78|red", "Triage (Medical)|P2 - High|62|orange", "Logistics (Supply)|P3 - Medium|41|amber", "Telemetry (Sensors)|P4 - Low|28|blue", "General Internet|P5 - Lowest|16|gray"].map((row) => {
        const [name, pri, load, tone] = row.split("|");
        return `<div class="qos-row"><span>${esc(name)}</span><b>${esc(pri)}</b><div class="bar"><span class="${tone}" style="width:${load}%"></span></div><small>Active</small></div>`;
      }).join("")}
      <div class="util-row"><span>Total Network Utilization</span><div class="bar"><span style="width:56%;background:var(--green)"></span></div><b>56%</b></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Event Log</h3><button class="ghost-btn">All Events</button></div>
      ${["Switched to Cellular", "Traffic relayed through POD-02", "Island Mode Activated", "Satellite Link Degraded", "Predictive Failover Standby"].map((item, i) => `<div class="event-row">${iconTile(String(i + 1), i === 3 ? "red" : "blue")}<b>${item}</b><span>${2 + i * 2} min ago</span><p>${["Satellite degraded. Traffic automatically rerouted.", "Mesh relay established via POD-02.", "Cloud unreachable. Operating autonomously.", "High packet loss detected.", "AI predicts degradation. Ready to failover."][i]}</p></div>`).join("")}
    </section>
  </div>`;
}

function pageResources(d) {
  const volunteers = [
    ["Rohit Sharma", "Medical", "Medical Camp - Pod 03", "Kothagalli, Zone 3", "On Duty", "Available"],
    ["Neha Verma", "Logistics", "Supply Distribution - Pod 07", "Nandigama", "On Duty", "After 6h"],
    ["Arjun Nair", "Search & Rescue", "SAR Team - Zone 2", "Mangalagiri, Zone 2", "On Duty", "Available"],
    ["Priya Iyer", "Medical", "First Aid - Shelter B", "Vijayawada", "On Break", "After 2h"],
    ["Karan Patel", "Communications", "Comms Support - Pod 05", "Tadepalli, Zone 2", "Available", "Now"]
  ];
  return `<div class="page-head"><div><h2>Relief Operations</h2><p>Manage resources, volunteers and task assignments across affected zones.</p></div><div class="head-actions"><button class="ghost-btn">Export Report</button><button class="primary-btn">Add Resource</button></div></div>
  <div class="resource-layout">
    <main>
      <div class="metric-grid resource-metrics">
        ${metricCard({ icon: "W", tone: "blue", label: "Water Stock", value: "18,450 L", sub: "68% of capacity" })}
        ${metricCard({ icon: "M", tone: "red", label: "Medical Kits", value: "324 Kits", sub: "54% of target" })}
        ${metricCard({ icon: "S", tone: "teal", label: "Shelter Capacity", value: "1,250 / 1,800", sub: "69% occupied" })}
        ${metricCard({ icon: "V", tone: "violet", label: "Active Volunteers", value: "128", sub: "+12 in last 6h" })}
      </div>
      <section class="panel">
        <div class="panel-head"><h3>Volunteers</h3><a>View all volunteers</a></div>
        <table><thead><tr><th>Volunteer</th><th>Skill Type</th><th>Current Assignment</th><th>Location</th><th>Status</th><th>Availability</th></tr></thead><tbody>
        ${volunteers.map((v) => `<tr><td><b>${v[0]}</b><small>VLT-${Math.floor(1000 + Math.random() * 80)}</small></td><td><span class="soft-pill">${v[1]}</span></td><td>${v[2]}</td><td>${v[3]}</td><td><span class="soft-pill green">${v[4]}</span></td><td>${v[5]}</td></tr>`).join("")}
        </tbody></table>
      </section>
      <section class="panel inventory">
        <div class="panel-head"><h3>Resource Inventory</h3></div>
        ${["Water (Liters)|18450 L|27000 L|68|14 hrs", "Food Packets|5320|10000|53|18 hrs", "Insulin Vials|248|500|50|22 hrs", "Blankets|740|1500|49|16 hrs", "Power Banks|320|800|40|10 hrs"].map((row) => {
          const [name, stock, cap, level, burn] = row.split("|");
          return `<div class="inventory-row"><span>${name}</span><b>${stock}</b><small>${cap}</small><div class="bar"><span style="width:${level}%;background:${Number(level) < 45 ? "var(--red)" : "var(--accent)"}"></span></div><strong>${burn}</strong></div>`;
        }).join("")}
      </section>
    </main>
    <aside>
      ${mapPanel("Zone Assignment Map", "zones")}
      <section class="panel task-card"><div class="panel-head"><h3>Task Assignments</h3><a>View all tasks</a></div>${["Deliver 500 water bottles to Pod 03", "Set up medical camp at Shelter B", "Transport blankets to Nandigama", "Refill power banks at Pod 05", "Assist in SAR operation at Zone 2"].map((task, i) => `<div class="task-row">${iconTile(String(i + 1), i % 2 ? "red" : "blue")}<span><b>${task}</b><small>Due in ${i + 2}h</small></span><button>${i === 2 || i === 4 ? "Assign" : "Accept"}</button></div>`).join("")}</section>
    </aside>
  </div>`;
}

function pageSensors(d) {
  return `<div class="page-head"><div><h2>Sensor Intelligence</h2><p>Flood risk, water level and safety telemetry from connected pods.</p></div><div class="live-dot">Live</div></div>
  <div class="metric-grid">
    ${metricCard({ icon: "W", tone: "blue", label: "Water Level", value: "6.24 m", sub: "+0.38 m past 1h" })}
    ${metricCard({ icon: "R", tone: "red", label: "Flood Risk Index", value: "HIGH", sub: "0.82 / 1.00" })}
    ${metricCard({ icon: "S", tone: "orange", label: "Sensor Alerts", value: d.earlyWarnings?.length || 7, sub: "2 critical zones" })}
    ${metricCard({ icon: "P", tone: "teal", label: "Pods Reporting", value: `${d.counts.podsOnline} / ${d.counts.podsTotal}`, sub: "Realtime socket feed" })}
  </div>
  <div class="grid g2 section-gap"><section class="panel sensor-panel"><div class="panel-head"><h3>Water Level Trend</h3></div><div class="large-chart"><i></i></div></section>${mapPanel("Flood Sensor Map")}</div>`;
}

function pageAlerts(d) {
  const alerts = d.alerts || [];
  const sec = d.securityEvents || [];
  return `<div class="page-head"><div><h2>Alerts</h2><p>Signed EOC broadcasts and security events across the network.</p></div><button class="primary-btn" onclick="broadcast()">Broadcast Alert</button></div>
  <div class="alert-layout">
    <section class="panel">
      <div class="panel-head"><h3>Signed Alerts Sent</h3></div>
      ${(alerts.length ? alerts : [{ id: "alert-1", hazard: "flood", message: "Flood escalation in Budameru basin.", issuedAt: new Date().toISOString() }]).map((alert) => `<div class="event-row">${iconTile("!", "red")}<b>${esc(cap(alert.hazard || "alert"))}</b><span>${ago(alert.issuedAt)}</span><p>${esc(alert.message || "")}</p></div>`).join("")}
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Shield Security Events</h3></div>
      ${(sec.length ? sec : [{ id: "sec-1", message: "No forged or replayed alerts detected.", cloudReceivedAt: new Date().toISOString() }]).map((event) => `<div class="event-row">${iconTile("S", "blue")}<b>Security</b><span>${ago(event.cloudReceivedAt)}</span><p>${esc(event.message || "")}</p></div>`).join("")}
    </section>
  </div>`;
}

function pageSettings(d) {
  return `<div class="page-head"><div><h2>Settings</h2><p>Command Center preferences and incident room configuration.</p></div></div>
  <div class="settings-grid">
    <section class="panel"><div class="panel-head"><h3>Realtime Links</h3></div><div class="settings-row"><span>Browser Socket</span><b>WebSocket</b></div><div class="settings-row"><span>Cloud Backend</span><b>Connected</b></div><div class="settings-row"><span>MongoDB</span><b>Active</b></div></section>
    <section class="panel"><div class="panel-head"><h3>Incident Defaults</h3></div><div class="settings-row"><span>Default channel</span><b>Medical</b></div><div class="settings-row"><span>Escalation level</span><b>High</b></div><div class="settings-row"><span>Auto routing</span><b>Enabled</b></div></section>
  </div>`;
}

// ---- actions ----
async function infra(target, action) {
  $("infra-msg") && ($("infra-msg").textContent = `Sending ${action} to ${target}…`);
  await api(`/api/infra/${target}/${action}`, { method: "POST" });
  setTimeout(refresh, 800);
}
async function restoreAll() {
  $("infra-msg") && ($("infra-msg").textContent = "Restoring all links…");
  await api("/api/infra/restore-all", { method: "POST" });
  setTimeout(refresh, 1500);
}
async function broadcast() {
  const msg = $("al-msg")?.value?.trim() || "Signed EOC test alert. No action needed.";
  await api("/api/broadcast", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hazard: "drill", message: msg })
  });
  $("al-msg-out") && ($("al-msg-out").textContent = "Broadcast sent and signed. Refreshing...");
  setTimeout(refresh, 800);
}
async function deleteRequest(id) {
  if (!id) return;
  const result = await api(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
  applyRealtimeEvent("request:deleted", result.data || { id });
  if (currentRoute() === "/requests") {
    await loadRequests();
  }
}

async function retryDeliveries() {
  await api("/api/coordinator-deliveries/retry", { method: "POST" });
  $("sys-sync").textContent = "Retry requested; waiting for delivery socket events";
  if (currentRoute() === "/requests") {
    await loadRequests();
  }
}

window.infra = infra;
window.restoreAll = restoreAll;
window.broadcast = broadcast;
window.deleteRequest = deleteRequest;
window.retryDeliveries = retryDeliveries;

// ---- router ----
const routes = {
  "/dashboard": pageDashboard,
  "/requests": pageRequests,
  "/pods": pagePods,
  "/network": pageNetwork,
  "/sensors": pageSensors,
  "/resources": pageResources,
  "/volunteers": pageResources,
  "/alerts": pageAlerts,
  "/settings": pageSettings
};
function currentRoute() {
  const h = location.hash.replace("#", "") || "/dashboard";
  return routes[h] ? h : "/dashboard";
}
function render() {
  if (!overview) return;
  const route = currentRoute();
  document.querySelectorAll("#nav a").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === "#" + route));

  view.innerHTML = routes[route](overview);
  renderedRoute = route;
}
window.addEventListener("hashchange", () => {
  renderedRoute = "";
  lastRequestsHtml = "";
  render();
});

enhanceShell();
initRealtime();
refresh();
