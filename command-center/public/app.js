// SANJEEVANI Command Center — vanilla JS, hash-routed, real backend data.
const $ = (id) => document.getElementById(id);
const view = $("view");
let overview = null;
let timer = null;

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
  $("sys-sync").textContent = "Last synced: just now";
}

async function refresh() {
  const r = await api("/api/overview");
  if (r && r.success) {
    overview = r.data;
    paintChrome(overview);
    render();
  }
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
        <td><span class="pill p-cloud">${esc(r.forwardedBy || r.network?.activePath || "queued")}</span></td>
        <td class="muted">${ago(r.cloudReceivedAt)}</td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">No citizen requests yet. Submit one from a pod portal.</td></tr>`;

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
        <table><thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Location</th><th>Via</th><th>Received</th></tr></thead>
        <tbody>${reqRows}</tbody></table>
      </div>
      <div class="card">
        <div class="head"><h3>Pod network status</h3><span class="link" onclick="location.hash='#/network'">View network →</span></div>
        <div class="grid g2" style="grid-template-columns:1fr 1fr;gap:10px">
          ${links.map((l) => `<div class="linkbox"><div class="name">${l.k}</div>
            <div class="st">${statusPill(l.s === "on" ? "up" : l.s === "off" ? "down" : l.s)}</div></div>`).join("")}
        </div>
        <div class="note">Queued (offline) requests waiting to sync: <b>${d.counts.queued}</b></div>
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

function pageNetwork(d) {
  const infra = d.infra || {};
  const details = infra.details || {};
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
  const msg = $("al-msg").value.trim() || "Signed EOC test alert. No action needed.";
  await api("/api/broadcast", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hazard: "drill", message: msg })
  });
  $("al-msg-out").textContent = "Broadcast sent and signed. Refreshing…";
  setTimeout(refresh, 800);
}
window.infra = infra; window.restoreAll = restoreAll; window.broadcast = broadcast;

// ---- router ----
const routes = {
  "/dashboard": pageDashboard,
  "/requests": pageRequests,
  "/network": pageNetwork,
  "/resources": pageResources,
  "/alerts": pageAlerts
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
  if (route === "/requests") loadRequests();
}
window.addEventListener("hashchange", render);

refresh();
timer = setInterval(refresh, 5000);
