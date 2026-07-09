// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const elements = {
  refresh: document.getElementById("refresh"),
  notice: document.getElementById("notice"),
  satelliteStatus: document.getElementById("satelliteStatus"),
  satelliteDocker: document.getElementById("satelliteDocker"),
  celltower1Status: document.getElementById("celltower1Status"),
  celltower1Docker: document.getElementById("celltower1Docker"),
  celltower2Status: document.getElementById("celltower2Status"),
  celltower2Docker: document.getElementById("celltower2Docker"),
  infraSummary: document.getElementById("infraSummary"),
  lastUpdated: document.getElementById("lastUpdated"),
  topologyStats: document.getElementById("topologyStats"),
  towerTopology: document.getElementById("towerTopology"),
  meshTopology: document.getElementById("meshTopology"),
  podConnectionMap: document.getElementById("podConnectionMap")
};

const viewMap = {
  satellite: {
    status: elements.satelliteStatus,
    docker: elements.satelliteDocker,
    card: document.querySelector('[data-link="satellite"]')
  },
  "celltower-1": {
    status: elements.celltower1Status,
    docker: elements.celltower1Docker,
    card: document.querySelector('[data-link="celltower-1"]')
  },
  "celltower-2": {
    status: elements.celltower2Status,
    docker: elements.celltower2Docker,
    card: document.querySelector('[data-link="celltower-2"]')
  }
};

// Pod topology used to be a hand-typed array here. It drifted out of sync
// with docker-compose.yml because nothing kept it in sync automatically.
// It's now fetched live from simulation-controller's /api/topology, which in
// turn asks each pod's own /api/pod/status for its real configured neighbors
// and its real, current routing decision. Nothing about the network is
// hand-typed on this page anymore.
let livePods = [];
let liveEdges = [];
let towerCoverage = {};
let linkDetails = {};

// --- Live event timeline state --------------------------------------------
// The controller used to only show current state. This keeps a short rolling
// log of *changes* (a link failing, a sensor crossing its hazard line, a mesh
// relay lighting up) so an operator - or a judge watching over your shoulder -
// can read the story of the drill, not just its snapshot.
let eventLog = [];
const EVENT_LIMIT = 60;
let prevLinkState = null;
let prevSensorState = null;
let prevLiveEdgeKeys = null;

const LINK_LABELS = {
  satellite: "Satellite",
  "celltower-1": "CELLTOWER-1",
  "celltower-2": "CELLTOWER-2"
};

// ---------------------------------------------------------------------------
// Style helpers - one place that maps a link/route "state" to Tailwind
// classes, so every card/badge/chip on the page stays visually consistent.
// ---------------------------------------------------------------------------

function stateColor(state) {
  if (state === "up") return "emerald";
  if (state === "mesh") return "violet";
  if (state === "down" || state === "unreachable") return "rose";
  return "amber"; // unknown / checking
}

function badgeClasses(state, { solid = false } = {}) {
  const color = stateColor(state);
  return solid
    ? `inline-flex items-center gap-1 rounded-full border border-${color}-200 bg-${color}-50 px-2.5 py-1 text-xs font-bold text-${color}-700`
    : `text-${color}-600`;
}

function noticeClasses(kind) {
  const base = "min-h-[46px] flex-1 rounded-lg border px-4 py-3 text-sm font-semibold shadow-soft";
  if (kind === "success") return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (kind === "error") return `${base} border-rose-200 bg-rose-50 text-rose-700`;
  return `${base} border-brand-line bg-white text-brand-muted`;
}

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

function setNotice(kind, message) {
  elements.notice.className = noticeClasses(kind);
  elements.notice.textContent = message || "";
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

// Matches the server's INFRA_CONTROL_KEY default (simulation-controller/server.js).
// This is the operator-only page for this controller, so a shared demo token
// here is enough to stop opportunistic/blind POSTs to /api/infra/*/fail from
// outside this UI - it isn't meant to resist someone reading this source file.
const INFRA_TOKEN = "sanjeevani-infra-demo-key";

async function api(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...extraHeaders },
    ...rest
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.detail || "Controller request failed.");
  }
  return data;
}

function podName(id) {
  return livePods.find((pod) => pod.podId === id)?.podName || id;
}

function towerKey(towerName) {
  return String(towerName || "").toLowerCase();
}

function routeLabel(pod) {
  if (!pod.reachable) return "unreachable";
  if (pod.mode === "cloud") {
    return pod.activePath === "cellular" && pod.activeCellTower
      ? `cellular · ${pod.activeCellTower}`
      : "satellite";
  }
  if (pod.mode === "mesh-relay" && pod.relayPod) {
    return `mesh · via ${pod.relayPod.podId}`;
  }
  if (pod.mode === "island") return "queued locally";
  return "checking";
}

function routeState(pod) {
  if (!pod.reachable) return "unreachable";
  if (pod.mode === "cloud") return "up";
  if (pod.mode === "mesh-relay") return "mesh";
  if (pod.mode === "island") return "down";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Infra links (satellite / celltower cards) + full topology rendering
// ---------------------------------------------------------------------------

function towerGroupsFromPods(pods) {
  return [
    {
      key: "celltower-1",
      label: "CELLTOWER-1",
      description: "Pods currently configured with a CELLTOWER-1 radio",
      pods: pods.filter((pod) => pod.connectedTowers.includes("CELLTOWER-1")).map((pod) => pod.podId),
      coordinators: (towerCoverage["CELLTOWER-1"] || []).map((c) => c.name)
    },
    {
      key: "celltower-2",
      label: "CELLTOWER-2",
      description: "Pods currently configured with a CELLTOWER-2 radio",
      pods: pods.filter((pod) => pod.connectedTowers.includes("CELLTOWER-2")).map((pod) => pod.podId),
      coordinators: (towerCoverage["CELLTOWER-2"] || []).map((c) => c.name)
    },
    {
      key: "mesh-only",
      label: "No direct cell tower",
      description: "Relies on satellite or neighbor pod mesh only",
      pods: pods.filter((pod) => pod.connectedTowers.length === 0).map((pod) => pod.podId),
      coordinators: []
    }
  ];
}

function podChip(id, { coordinator = false } = {}) {
  const cls = coordinator
    ? "inline-flex min-h-[30px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
    : "inline-flex min-h-[30px] items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-brand-ink";
  return `<span class="${cls}" title="${podName(id)}">${id}</span>`;
}

function renderTowerTopology(pods) {
  const groups = towerGroupsFromPods(pods);

  return groups
    .map((tower) => {
      // Mesh-only pods have no radio to poll, so they're always "mesh
      // standby" rather than up/down; real cell towers read their live
      // health straight from linkDetails (set by the last /api/infra/status
      // poll), so this card never gets stuck showing a stale placeholder.
      const state = tower.key === "mesh-only" ? "mesh" : linkDetails[tower.key]?.status || "unknown";
      const statusText = tower.key === "mesh-only" ? "mesh standby" : state;
      const color = stateColor(state);

      return `
        <div class="rounded-xl border p-4 border-${color}-200 bg-${color}-50/40">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <span class="block text-xs font-extrabold uppercase tracking-wide text-brand-muted">${tower.label}</span>
              <strong class="mt-1 block text-lg font-extrabold uppercase text-${color}-700">${statusText}</strong>
            </div>
            <small class="max-w-[45%] text-right text-xs leading-snug text-brand-muted">${tower.description}</small>
          </div>
          <div class="flex flex-wrap gap-2">
            ${tower.pods.length ? tower.pods.map((id) => podChip(id)).join("") : '<span class="text-xs text-brand-muted">none</span>'}
          </div>
          ${
            tower.coordinators.length
              ? `<div class="mt-2 flex flex-wrap gap-2">${tower.coordinators.map((name) => podChip(name, { coordinator: true })).join("")}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderMeshTopology(meshEdges) {
  const edgeChips = meshEdges.length
    ? meshEdges
        .map(({ pair: [from, to], active }) => {
          const activeCls = active
            ? "border-violet-300 bg-violet-50 text-violet-700"
            : "border-slate-200 bg-white text-brand-ink";
          const title = `${podName(from)} to ${podName(to)}${active ? " - actively relaying right now" : " - configured neighbor"}`;
          return `
            <span class="flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${activeCls}" title="${title}">
              <span>${from}</span>
              <span aria-hidden="true" class="text-brand-muted">&#8594;</span>
              <span>${to}</span>
              ${active ? '<span class="ml-auto rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">live</span>' : ""}
            </span>
          `;
        })
        .join("")
    : '<p class="text-sm text-brand-muted">No mesh links configured.</p>';

  return `
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">${edgeChips}</div>
    <div class="mt-4 rounded-lg bg-brand-soft p-3.5">
      <strong class="text-sm text-brand-ink">Relay rule</strong>
      <p class="mt-1 text-sm leading-relaxed text-brand-muted">A pod sends to a neighbor only when satellite and direct cellular are unavailable, and that neighbor still has a cloud path. Edges marked "live" are carrying traffic right now, not just configured.</p>
    </div>
  `;
}

function connectionChip(text, variant) {
  const variants = {
    tower_up: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tower_down: "border-rose-200 bg-rose-50 text-rose-700",
    none: "border-slate-200 bg-slate-100 text-slate-500",
    neighbor: "border-blue-100 bg-blue-50 text-blue-800",
    "neighbor-active": "border-violet-300 bg-violet-50 text-violet-700",
    route_up: "border-emerald-200 bg-emerald-50 text-emerald-700",
    route_mesh: "border-violet-200 bg-violet-50 text-violet-700",
    route_down: "border-rose-200 bg-rose-50 text-rose-700",
    queue: "border-amber-200 bg-amber-50 text-amber-700"
  };
  return `<span class="inline-flex min-h-[28px] items-center rounded-full border px-2.5 py-1 text-xs font-bold ${variants[variant] || variants.none}">${text}</span>`;
}

function renderPodConnectionMap(pods) {
  return pods
    .map((pod) => {
      const state = routeState(pod);
      const isBridge = pod.connectedTowers.length > 1;
      const stateBorder = {
        up: "border-emerald-200",
        mesh: "border-violet-200",
        down: "border-rose-200",
        unreachable: "border-rose-200",
        unknown: "border-brand-line"
      }[state];

      const towerChips = pod.connectedTowers.length
        ? pod.connectedTowers
            .map((tower) => connectionChip(tower, linkDetails[towerKey(tower)]?.status === "up" ? "tower_up" : "tower_down"))
            .join("")
        : connectionChip("No direct cellular", "none");

      const neighborChips = pod.neighbors.length
        ? pod.neighbors
            .map((neighbor) => connectionChip(neighbor, pod.relayPod?.podId === neighbor ? "neighbor-active" : "neighbor"))
            .join("")
        : connectionChip("No configured neighbors", "none");

      const routeVariant = state === "up" ? "route_up" : state === "mesh" ? "route_mesh" : "route_down";

      return `
        <article class="rounded-xl border ${stateBorder} bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div>
              <strong class="block text-sm font-extrabold text-brand-ink">${pod.podId}</strong>
              <span class="block text-xs text-brand-muted">${pod.podName}</span>
            </div>
            ${isBridge ? '<span class="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">bridge</span>' : ""}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <small class="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-brand-muted">Cell tower</small>
              <div class="flex flex-wrap gap-1.5">${towerChips}</div>
            </div>
            <div>
              <small class="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-brand-muted">Mesh neighbors</small>
              <div class="flex flex-wrap gap-1.5">${neighborChips}</div>
            </div>
            <div>
              <small class="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-brand-muted">Routing now</small>
              <div class="flex flex-wrap gap-1.5">
                ${connectionChip(routeLabel(pod), routeVariant)}
                ${pod.queuedRequests ? connectionChip(`${pod.queuedRequests} queued`, "queue") : ""}
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTopology() {
  const pods = livePods;
  const meshEdges = liveEdges;
  const bridgePods = pods.filter((pod) => pod.connectedTowers.length > 1);
  const meshOnlyPods = pods.filter((pod) => pod.connectedTowers.length === 0);
  const activeMeshCount = meshEdges.filter((edge) => edge.active).length;

  const stats = [
    { label: "Pods", value: pods.length || "-" },
    { label: "Cell towers", value: "2" },
    { label: "Mesh links (active now)", value: `${meshEdges.length} (${activeMeshCount})` },
    { label: "Bridge pod", value: bridgePods.map((pod) => pod.podId).join(", ") || "-" },
    { label: "Mesh-only pods", value: meshOnlyPods.map((pod) => pod.podId).join(", ") || "-" }
  ];

  elements.topologyStats.innerHTML = stats
    .map(
      (item) => `
        <div class="min-w-0 rounded-xl border border-brand-line bg-white/80 p-3">
          <span class="block text-[11px] font-extrabold uppercase tracking-wide text-brand-muted">${item.label}</span>
          <strong class="mt-1 block truncate text-sm font-extrabold text-brand-ink" title="${item.value}">${item.value}</strong>
        </div>
      `
    )
    .join("");

  elements.towerTopology.innerHTML = renderTowerTopology(pods);
  elements.meshTopology.innerHTML = renderMeshTopology(meshEdges);
  elements.podConnectionMap.innerHTML = renderPodConnectionMap(pods);
}

function renderStatus(payload) {
  const details = payload.data?.details || {};
  linkDetails = details;
  towerCoverage = payload.data?.towerCoverage || {};
  const statusCounts = { up: 0, down: 0, unknown: 0 };

  for (const [key, view] of Object.entries(viewMap)) {
    const link = details[key] || {};
    const linkStatus = link.status || "unknown";
    const color = stateColor(linkStatus);

    view.status.textContent = linkStatus;
    view.status.className = `block text-3xl font-extrabold uppercase leading-none text-${color}-600`;
    view.docker.textContent = `container: ${link.containerName || "-"} / ${link.dockerStatus || "unknown"}`;
    view.card.dataset.state = linkStatus;
    view.card.querySelector("[data-accent]").className = `absolute inset-x-0 top-0 h-1 bg-${color}-500`;
    statusCounts[linkStatus] = (statusCounts[linkStatus] || 0) + 1;
  }

  const linkCount = Object.keys(viewMap).length;
  if (statusCounts.down > 0) {
    elements.infraSummary.textContent = `${statusCounts.down} link${statusCounts.down > 1 ? "s" : ""} down`;
    elements.infraSummary.className = "mt-1 block text-sm font-bold text-rose-600";
  } else if (statusCounts.up === linkCount) {
    elements.infraSummary.textContent = "All links online";
    elements.infraSummary.className = "mt-1 block text-sm font-bold text-emerald-600";
  } else {
    elements.infraSummary.textContent = "Checking links";
    elements.infraSummary.className = "mt-1 block text-sm font-bold text-amber-600";
  }

  elements.lastUpdated.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  renderTopology();
}

async function loadStatus() {
  const status = await api("/api/infra/status");
  renderStatus(status);
  diffLinks(status.data?.details || {});
  return status;
}

async function loadTopology() {
  const payload = await api("/api/topology");
  livePods = payload.data?.pods || [];
  liveEdges = payload.data?.edges || [];
  renderTopology();
  diffEdges(liveEdges);
  return payload;
}

// ---------------------------------------------------------------------------
// Wiring: refresh button, per-link fail/restore buttons, polling
// ---------------------------------------------------------------------------

elements.refresh.addEventListener("click", async () => {
  setBusy(elements.refresh, true);
  try {
    await Promise.all([loadStatus(), loadTopology()]);
    setNotice("success", "Controller status refreshed.");
  } catch (error) {
    setNotice("error", error.message);
  } finally {
    setBusy(elements.refresh, false);
  }
});

document.querySelectorAll("[data-link-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const linkKey = button.dataset.linkKey;
    const action = button.dataset.linkAction;
    setBusy(button, true);
    try {
      const result = await api(`/api/infra/${linkKey}/${action}`, {
        method: "POST",
        headers: { "x-infra-token": INFRA_TOKEN },
        body: "{}"
      });
      await Promise.all([loadStatus(), loadTopology()]);
      setNotice("success", result.message);
    } catch (error) {
      setNotice("error", error.message);
    } finally {
      setBusy(button, false);
    }
  });
});

renderTopology();
loadStatus().catch((error) => setNotice("error", error.message));
loadTopology().catch((error) => setNotice("error", `Live topology unavailable: ${error.message}`));
setInterval(() => loadStatus().catch(() => {}), 3000);
setInterval(() => loadTopology().catch(() => {}), 3000);

// ---------------------------------------------------------------------------
// Live sensor feed
// ---------------------------------------------------------------------------
// sensor-simulator is a separate container (docker-compose service
// sensor-simulator, port 9400, internal-network only - it isn't published
// to the host at all). This page calls it through simulation-controller's
// own /api/sensors/* proxy, same-origin, the same pattern used by /api/infra/*.
// Thresholds below are copied from pod-agent's hazardPackService.js purely
// for the "normal/warning/critical" badge - they don't change any alerting
// logic, that still happens on the pod side.

const SENSOR_API_BASE = "/api/sensors";

const HAZARD_THRESHOLDS = {
  water_level: 150,
  shake_g: 0.4,
  temperature: 45,
  air_quality: 250
};

const SENSOR_LABELS = {
  water_level: "Water level",
  shake_g: "Ground shake",
  temperature: "Temperature",
  air_quality: "Air quality · smoke"
};

// Which disaster each sensor's threshold breach represents - shown on the card
// so an operator reads the hazard, not just the metric.
const SENSOR_HAZARD = {
  water_level: "Flood",
  shake_g: "Earthquake",
  temperature: "Heatwave",
  air_quality: "Wildfire smoke"
};

// Inline SVG glyph per sensor type (stroke uses currentColor so it tints with
// the card's status color). Keeps the feed readable at a glance.
const SENSOR_ICON = {
  water_level:
    '<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z"></path>',
  shake_g:
    '<path d="M3 12h3l2-6 3 12 3-9 2 3h5"></path>',
  temperature:
    '<path d="M10 13V5a2 2 0 1 1 4 0v8a4 4 0 1 1-4 0Z"></path><path d="M12 13.5v3"></path>',
  air_quality:
    '<path d="M4 8h11a3 3 0 1 0-3-3M4 12h15a3 3 0 1 1-3 3M4 16h9a2.5 2.5 0 1 1-2.5 2.5"></path>'
};

const UNIT_DISPLAY = {
  celsius: "°C",
  cm: "cm",
  g: "g",
  ugm3: "µg/m³"
};

const SPIKE_STEP_BY_SENSOR = {
  water_level: 20,
  shake_g: 0.08,
  temperature: 5,
  air_quality: 80
};

const sensorElements = {
  notice: document.getElementById("sensorNotice"),
  grid: document.getElementById("sensorGrid"),
  buttons: document.getElementById("buttonGrid")
};

function sensorStatusFor(sensor, value) {
  const threshold = HAZARD_THRESHOLDS[sensor];
  if (!threshold) return "normal";
  if (value >= threshold) return "critical";
  if (value >= threshold * 0.8) return "warning";
  return "normal";
}

function sensorStateFromStatus(status) {
  if (status === "critical") return "down";
  if (status === "warning") return "unknown";
  return "up";
}

function setSensorNotice(kind, message) {
  if (!sensorElements.notice) return;
  if (!message) {
    sensorElements.notice.hidden = true;
    sensorElements.notice.textContent = "";
    return;
  }
  sensorElements.notice.hidden = false;
  sensorElements.notice.className = noticeClasses(kind).replace("flex-1 ", "");
  sensorElements.notice.textContent = message;
}

async function sensorApi(path, options = {}) {
  const response = await fetch(`${SENSOR_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Sensor simulator request failed.");
  }
  return data;
}

function renderSensors(payload) {
  const stations = payload.stations || [];
  const buttons = payload.buttons || [];

  sensorElements.grid.innerHTML = stations
    .map((station) => {
      const status = sensorStatusFor(station.sensor, station.value);
      const color = stateColor(sensorStateFromStatus(status));
      const decimals = station.sensor === "shake_g" ? 3 : station.sensor === "air_quality" ? 0 : 1;
      const displayValue = Number(station.value).toFixed(decimals);
      const unit = UNIT_DISPLAY[station.unit] || station.unit;
      const label = SENSOR_LABELS[station.sensor] || station.sensor;
      const hazard = SENSOR_HAZARD[station.sensor] || "Hazard";
      const icon = SENSOR_ICON[station.sensor] || "";
      const threshold = HAZARD_THRESHOLDS[station.sensor];
      // How close this reading sits to its hazard threshold, as a 0-100 bar.
      const pct = threshold ? Math.min(100, Math.round((Number(station.value) / threshold) * 100)) : 0;
      const thresholdText = threshold
        ? `${Number(threshold).toLocaleString()}${unit} = ${hazard.toLowerCase()}`
        : "no threshold";

      return `
        <article class="group relative flex flex-col overflow-hidden rounded-2xl border border-brand-line bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
          <div class="absolute inset-x-0 top-0 h-1 bg-${color}-500"></div>
          <div class="mb-3 flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-${color}-50 text-${color}-600">
                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
              </span>
              <div class="min-w-0">
                <strong class="block truncate text-sm font-extrabold text-brand-ink">${station.podId}</strong>
                <small class="block truncate text-xs text-brand-muted">${station.podName}</small>
              </div>
            </div>
            <span class="${badgeClasses(sensorStateFromStatus(status), { solid: true })} shrink-0 uppercase">${status}</span>
          </div>

          <div class="flex items-end justify-between gap-2">
            <div class="text-3xl font-extrabold leading-none text-brand-ink">${displayValue}<span class="ml-1 text-sm font-bold text-brand-muted">${unit}</span></div>
            <span class="mb-0.5 shrink-0 rounded-full border border-${color}-200 bg-${color}-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-${color}-700">${hazard}</span>
          </div>
          <div class="mt-1 text-xs font-bold text-brand-muted">${label} · ${station.model}</div>

          <div class="mt-3">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-${color}-500 transition-all duration-500" style="width: ${pct}%"></div>
            </div>
            <div class="mt-1 flex justify-between text-[10px] font-semibold text-brand-muted">
              <span>${pct}% of threshold</span>
              <span>${thresholdText}</span>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button" data-sensor-action="spike" data-pod-id="${station.podId}" data-sensor="${station.sensor}" class="h-9 rounded-lg border border-brand-line bg-white text-xs font-bold text-brand-ink transition hover:-translate-y-0.5 hover:border-blue-300 disabled:cursor-wait disabled:opacity-60">Spike</button>
            <button type="button" data-sensor-action="reset" data-pod-id="${station.podId}" data-sensor="${station.sensor}" class="h-9 rounded-lg border border-brand-line bg-white text-xs font-bold text-brand-ink transition hover:-translate-y-0.5 hover:border-blue-300 disabled:cursor-wait disabled:opacity-60">Reset</button>
          </div>
        </article>
      `;
    })
    .join("");

  sensorElements.buttons.innerHTML = buttons
    .map(
      (button) => `
        <article class="rounded-xl border border-brand-line bg-gradient-to-b from-white to-slate-50 p-4">
          <strong class="block text-sm font-extrabold text-brand-ink">${button.podId}</strong>
          <small class="mb-3 block text-xs text-brand-muted">${button.podName} · MT30 button</small>
          <button type="button" data-sensor-action="press" data-pod-id="${button.podId}" class="h-9 w-full rounded-lg border border-rose-200 bg-rose-50 text-sm font-bold text-rose-700 transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60">Press for help</button>
        </article>
      `
    )
    .join("");
}

async function loadSensors() {
  const payload = await sensorApi("/status");
  renderSensors(payload);
  diffSensors(payload.stations || []);
  setSensorNotice();
  return payload;
}

if (sensorElements.grid) {
  sensorElements.grid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sensor-action]");
    if (!button) return;

    const action = button.dataset.sensorAction;
    const podId = button.dataset.podId;
    const sensor = button.dataset.sensor;

    setBusy(button, true);
    try {
      const sensorLabel = SENSOR_LABELS[sensor] || sensor;
      if (action === "spike") {
        await sensorApi(`/spike/${podId}/${sensor}`, {
          method: "POST",
          body: JSON.stringify({ ticks: 6, step: SPIKE_STEP_BY_SENSOR[sensor] || 10 })
        });
        logEvent("action", `Operator spiked ${podId} · ${sensorLabel}`, `Ramping toward the ${(SENSOR_HAZARD[sensor] || "hazard").toLowerCase()} threshold.`);
      } else if (action === "reset") {
        await sensorApi(`/reset/${podId}/${sensor}`, {
          method: "POST",
          body: "{}"
        });
        logEvent("action", `Operator reset ${podId} · ${sensorLabel}`, "Reading returned to baseline.");
      }
      await loadSensors();
    } catch (error) {
      setSensorNotice("error", error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

if (sensorElements.buttons) {
  sensorElements.buttons.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sensor-action='press']");
    if (!button) return;

    const podId = button.dataset.podId;
    setBusy(button, true);
    try {
      await sensorApi(`/press/${podId}`, {
        method: "POST",
        body: JSON.stringify({
          message: `MT30 button pressed at ${podId}. Immediate assistance requested.`
        })
      });
      logEvent("hazard", `MT30 help button pressed at ${podId}`, "Physical panic button — immediate assistance requested.");
      setSensorNotice("success", `Button press sent to ${podId}.`);
    } catch (error) {
      setSensorNotice("error", error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

loadSensors().catch((error) =>
  setSensorNotice("error", `Sensor simulator not reachable at ${SENSOR_API_BASE} - is the container running? (${error.message})`)
);
setInterval(
  () =>
    loadSensors().catch((error) =>
      setSensorNotice("error", `Sensor simulator not reachable at ${SENSOR_API_BASE} - is the container running? (${error.message})`)
    ),
  3000
);

// ---------------------------------------------------------------------------
// Live event timeline - narrates state changes the poll loops discover
// ---------------------------------------------------------------------------

const eventLogElements = {
  list: document.getElementById("eventLog"),
  count: document.getElementById("eventCount"),
  clear: document.getElementById("clearEvents")
};

// kind -> colour + glyph + short tag. Colours reuse the page's Tailwind set.
const EVENT_STYLES = {
  fail: { color: "rose", tag: "LINK DOWN", icon: "M18 6 6 18M6 6l12 12" },
  restore: { color: "emerald", tag: "LINK UP", icon: "M20 6 9 17l-5-5" },
  hazard: { color: "rose", tag: "HAZARD", icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
  warn: { color: "amber", tag: "RISING", icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
  recover: { color: "emerald", tag: "RECOVERED", icon: "M20 6 9 17l-5-5" },
  relay: { color: "violet", tag: "MESH RELAY", icon: "M4 12h4l3-8 3 16 3-8h4" },
  action: { color: "blue", tag: "OPERATOR", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }
};

function eventTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function logEvent(kind, title, detail) {
  eventLog.unshift({ kind, title, detail: detail || "", at: new Date() });
  eventLog = eventLog.slice(0, EVENT_LIMIT);
  renderEventLog();
}

function renderEventLog() {
  if (!eventLogElements.list) return;
  if (eventLogElements.count) eventLogElements.count.textContent = String(eventLog.length);

  if (!eventLog.length) {
    eventLogElements.list.innerHTML =
      '<li class="rounded-xl border border-dashed border-brand-line bg-brand-soft/50 px-4 py-6 text-center text-sm text-brand-muted">Waiting for network activity. Stop a link or Spike a sensor to see the story unfold here.</li>';
    return;
  }

  eventLogElements.list.innerHTML = eventLog
    .map((entry) => {
      const style = EVENT_STYLES[entry.kind] || EVENT_STYLES.action;
      return `
        <li class="flex items-start gap-3 rounded-xl border border-brand-line bg-white px-3 py-2.5 shadow-soft">
          <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-${style.color}-50 text-${style.color}-600">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${style.icon}"></path></svg>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="rounded-full bg-${style.color}-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-${style.color}-700">${style.tag}</span>
              <strong class="truncate text-sm font-bold text-brand-ink">${entry.title}</strong>
            </div>
            ${entry.detail ? `<p class="mt-0.5 text-xs leading-snug text-brand-muted">${entry.detail}</p>` : ""}
          </div>
          <time class="shrink-0 pt-0.5 text-[10px] font-semibold tabular-nums text-brand-muted">${eventTime(entry.at)}</time>
        </li>
      `;
    })
    .join("");
}

// --- Diff engines: compare this poll's snapshot to the previous one --------

function diffLinks(details) {
  const next = {};
  for (const key of Object.keys(LINK_LABELS)) next[key] = details[key]?.status || "unknown";
  if (prevLinkState) {
    for (const key of Object.keys(next)) {
      if (prevLinkState[key] === next[key]) continue;
      if (next[key] === "down") {
        logEvent("fail", `${LINK_LABELS[key]} went DOWN`, "Pods on this link must reroute via satellite or the pod mesh.");
      } else if (next[key] === "up" && prevLinkState[key] === "down") {
        logEvent("restore", `${LINK_LABELS[key]} restored`, "Direct uplink is available again.");
      }
    }
  }
  prevLinkState = next;
}

function diffSensors(stations) {
  const next = {};
  for (const station of stations) {
    const key = `${station.podId}:${station.sensor}`;
    const status = sensorStatusFor(station.sensor, station.value);
    next[key] = status;

    if (prevSensorState && prevSensorState[key] && prevSensorState[key] !== status) {
      const label = SENSOR_LABELS[station.sensor] || station.sensor;
      const hazard = SENSOR_HAZARD[station.sensor] || "hazard";
      const unit = UNIT_DISPLAY[station.unit] || station.unit;
      const decimals = station.sensor === "shake_g" ? 3 : station.sensor === "air_quality" ? 0 : 1;
      const reading = `${Number(station.value).toFixed(decimals)}${unit}`;
      if (status === "critical") {
        logEvent("hazard", `${hazard.toUpperCase()} at ${station.podId}`, `${station.podName}: ${label} ${reading} crossed the alert threshold.`);
      } else if (status === "warning" && prevSensorState[key] === "normal") {
        logEvent("warn", `${station.podId} · ${label} rising`, `${reading} at ${station.podName}, nearing the ${hazard.toLowerCase()} threshold.`);
      } else if (status === "normal" && prevSensorState[key] !== "normal") {
        logEvent("recover", `${station.podId} · ${label} back to normal`, `${station.podName} settled to ${reading}.`);
      }
    }
  }
  prevSensorState = next;
}

function diffEdges(edges) {
  const activeKeys = new Set(
    edges.filter((edge) => edge.active).map((edge) => `${edge.pair[0]}->${edge.pair[1]}`)
  );
  if (prevLiveEdgeKeys) {
    for (const key of activeKeys) {
      if (!prevLiveEdgeKeys.has(key)) {
        const [from, to] = key.split("->");
        logEvent("relay", `Mesh relay active: ${from} → ${to}`, `${from} lost its direct uplink and is now relaying SOS traffic through ${to}.`);
      }
    }
    for (const key of prevLiveEdgeKeys) {
      if (!activeKeys.has(key)) {
        const [from, to] = key.split("->");
        logEvent("recover", `Mesh relay cleared: ${from} → ${to}`, `${from} regained a direct path and stopped relaying through ${to}.`);
      }
    }
  }
  prevLiveEdgeKeys = activeKeys;
}

if (eventLogElements.clear) {
  eventLogElements.clear.addEventListener("click", () => {
    eventLog = [];
    renderEventLog();
  });
}

renderEventLog();
