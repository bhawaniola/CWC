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

const podTopology = [
  {
    id: "POD-01",
    name: "District Command Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-02", "POD-03"]
  },
  {
    id: "POD-02",
    name: "Hospital Relief Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-01", "POD-04"]
  },
  {
    id: "POD-03",
    name: "School Shelter Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-01", "POD-05"]
  },
  {
    id: "POD-04",
    name: "Riverbank Village Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-02", "POD-06"]
  },
  {
    id: "POD-05",
    name: "Evacuation Route Pod",
    towers: ["CELLTOWER-1", "CELLTOWER-2"],
    neighbors: ["POD-03", "POD-07"]
  },
  {
    id: "POD-06",
    name: "Remote Village Pod",
    towers: ["CELLTOWER-2"],
    neighbors: ["POD-04", "POD-08"]
  },
  {
    id: "POD-07",
    name: "Supply Warehouse Pod",
    towers: ["CELLTOWER-2"],
    neighbors: ["POD-05", "POD-09"]
  },
  {
    id: "POD-08",
    name: "Medical Camp Pod",
    towers: ["CELLTOWER-2"],
    neighbors: ["POD-06", "POD-10"]
  },
  {
    id: "POD-09",
    name: "High Ground Shelter Pod",
    towers: [],
    neighbors: ["POD-07", "POD-10"]
  },
  {
    id: "POD-10",
    name: "Mobile Relay Pod",
    towers: [],
    neighbors: ["POD-08", "POD-09"]
  }
];

const towerTopology = [
  {
    key: "celltower-1",
    label: "CELLTOWER-1",
    description: "Primary west and central coverage",
    pods: podTopology.filter((pod) => pod.towers.includes("CELLTOWER-1")).map((pod) => pod.id)
  },
  {
    key: "celltower-2",
    label: "CELLTOWER-2",
    description: "Primary east and relay-side coverage",
    pods: podTopology.filter((pod) => pod.towers.includes("CELLTOWER-2")).map((pod) => pod.id)
  },
  {
    key: "mesh-only",
    label: "No direct cell tower",
    description: "Uses satellite or neighbor pod mesh",
    pods: podTopology.filter((pod) => pod.towers.length === 0).map((pod) => pod.id)
  }
];

function getMeshEdges() {
  const seen = new Set();
  const edges = [];

  for (const pod of podTopology) {
    for (const neighbor of pod.neighbors) {
      const pair = [pod.id, neighbor].sort();
      const key = pair.join("-");

      if (!seen.has(key)) {
        seen.add(key);
        edges.push(pair);
      }
    }
  }

  return edges;
}

function setNotice(kind, message) {
  elements.notice.className = `notice ${kind || ""}`;
  elements.notice.textContent = message || "";
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.detail || "Controller request failed.");
  }
  return data;
}

function podName(id) {
  return podTopology.find((pod) => pod.id === id)?.name || id;
}

function towerKey(towerName) {
  return String(towerName || "").toLowerCase();
}

function renderTopology() {
  const bridgePods = podTopology.filter((pod) => pod.towers.length > 1);
  const meshOnlyPods = podTopology.filter((pod) => pod.towers.length === 0);
  const meshEdges = getMeshEdges();

  elements.topologyStats.innerHTML = [
    { label: "Pods", value: podTopology.length },
    { label: "Cell towers", value: "2" },
    { label: "Mesh links", value: meshEdges.length },
    { label: "Bridge pod", value: bridgePods.map((pod) => pod.id).join(", ") || "-" },
    { label: "Mesh-only pods", value: meshOnlyPods.map((pod) => pod.id).join(", ") || "-" }
  ]
    .map(
      (item) => `
        <div>
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </div>
      `
    )
    .join("");

  elements.towerTopology.innerHTML = towerTopology
    .map(
      (tower) => `
        <div class="tower-group" data-tower-key="${tower.key}">
          <div class="tower-group-header">
            <div>
              <span>${tower.label}</span>
              <strong data-tower-status>${tower.key === "mesh-only" ? "mesh standby" : "checking"}</strong>
            </div>
            <small>${tower.description}</small>
          </div>
          <div class="pod-chip-list">
            ${tower.pods
              .map(
                (podId) => `
                  <span class="pod-chip" title="${podName(podId)}">
                    ${podId}
                  </span>
                `
              )
              .join("")}
          </div>
        </div>
      `
    )
    .join("");

  elements.meshTopology.innerHTML = `
    <div class="mesh-edge-list">
      ${meshEdges
        .map(
          ([from, to]) => `
            <span class="mesh-edge" title="${podName(from)} to ${podName(to)}">
              <b>${from}</b>
              <i aria-hidden="true"></i>
              <b>${to}</b>
            </span>
          `
        )
        .join("")}
    </div>
    <div class="mesh-note">
      <strong>Relay rule</strong>
      <span>A pod sends to a neighbor only when satellite and direct cellular are unavailable, and that neighbor still has a cloud path.</span>
    </div>
  `;

  elements.podConnectionMap.innerHTML = podTopology
    .map(
      (pod) => `
        <article class="pod-connection-row ${pod.towers.length > 1 ? "bridge" : ""}">
          <div class="pod-connection-title">
            <strong>${pod.id}</strong>
            <span>${pod.name}</span>
          </div>
          <div>
            <small>Connected cell tower</small>
            <div class="connection-chip-list">
              ${
                pod.towers.length > 0
                  ? pod.towers
                      .map(
                        (tower) => `
                          <span class="connection-chip tower" data-connected-tower="${towerKey(tower)}">
                            ${tower}
                          </span>
                        `
                      )
                      .join("")
                  : '<span class="connection-chip none">No direct cellular</span>'
              }
            </div>
          </div>
          <div>
            <small>Mesh neighbors</small>
            <div class="connection-chip-list">
              ${pod.neighbors
                .map(
                  (neighbor) => `
                    <span class="connection-chip neighbor" title="${podName(neighbor)}">
                      ${neighbor}
                    </span>
                  `
                )
                .join("")}
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderTowerTopologyHealth(details) {
  document.querySelectorAll("[data-tower-key]").forEach((card) => {
    const key = card.dataset.towerKey;
    const status = card.querySelector("[data-tower-status]");

    if (key === "mesh-only") {
      card.dataset.state = "mesh";
      status.textContent = "mesh standby";
      return;
    }

    const link = details[key] || {};
    const linkStatus = link.status || "unknown";
    card.dataset.state = linkStatus;
    status.textContent = linkStatus;
  });

  document.querySelectorAll("[data-connected-tower]").forEach((chip) => {
    const linkStatus = details[chip.dataset.connectedTower]?.status || "unknown";
    chip.dataset.state = linkStatus;
  });
}

function renderStatus(payload) {
  const details = payload.data?.details || {};
  const statusCounts = {
    up: 0,
    down: 0,
    unknown: 0
  };

  for (const [key, view] of Object.entries(viewMap)) {
    const link = details[key] || {};
    const linkStatus = link.status || "unknown";

    view.status.textContent = link.status || "unknown";
    view.docker.textContent = `container: ${link.containerName || "-"} / ${link.dockerStatus || "unknown"}`;
    view.card.dataset.state = linkStatus;
    statusCounts[linkStatus] = (statusCounts[linkStatus] || 0) + 1;
  }

  if (statusCounts.down > 0) {
    elements.infraSummary.textContent = `${statusCounts.down} link${statusCounts.down > 1 ? "s" : ""} down`;
    elements.infraSummary.dataset.state = "down";
  } else if (statusCounts.up === Object.keys(viewMap).length) {
    elements.infraSummary.textContent = "All links online";
    elements.infraSummary.dataset.state = "up";
  } else {
    elements.infraSummary.textContent = "Checking links";
    elements.infraSummary.dataset.state = "unknown";
  }

  elements.lastUpdated.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  renderTowerTopologyHealth(details);
}

async function loadStatus() {
  const status = await api("/api/infra/status");
  renderStatus(status);
  return status;
}

elements.refresh.addEventListener("click", async () => {
  setBusy(elements.refresh, true);
  try {
    await loadStatus();
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
        body: "{}"
      });
      await loadStatus();
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
setInterval(() => loadStatus().catch(() => {}), 3000);

// --- Live sensor feed --------------------------------------------------
// sensor-simulator is a separate container, but its port is published to
// the host (see docker-compose.yml "9400:9400"), so this page's own JS can
// call it directly at localhost:9400 - no proxy route needed on this
// server. Thresholds below are copied from pod-agent's hazardPackService.js
// purely for the "normal/warning/critical" badge - they don't change any
// alerting logic, that still happens on the pod side.

const SENSOR_API_BASE = "http://localhost:9400";

const HAZARD_THRESHOLDS = {
  water_level: 150,
  shake_g: 0.4,
  temperature: 45
};

const SENSOR_LABELS = {
  water_level: "Water level",
  shake_g: "Ground shake",
  temperature: "Temperature"
};

const UNIT_DISPLAY = {
  celsius: "°C",
  cm: "cm",
  g: "g"
};

const SPIKE_STEP_BY_SENSOR = {
  water_level: 20,
  shake_g: 0.08,
  temperature: 5
};

const sensorElements = {
  notice: document.getElementById("sensorNotice"),
  grid: document.getElementById("sensorGrid"),
  buttons: document.getElementById("buttonGrid")
};

function sensorStatusFor(sensor, value) {
  const threshold = HAZARD_THRESHOLDS[sensor];
  if (!threshold) {
    return "normal";
  }
  if (value >= threshold) {
    return "critical";
  }
  if (value >= threshold * 0.8) {
    return "warning";
  }
  return "normal";
}

function setSensorNotice(kind, message) {
  if (!sensorElements.notice) {
    return;
  }
  if (!message) {
    sensorElements.notice.hidden = true;
    sensorElements.notice.textContent = "";
    return;
  }
  sensorElements.notice.hidden = false;
  sensorElements.notice.className = `sensor-notice ${kind || ""}`;
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
      const decimals = station.sensor === "shake_g" ? 3 : 1;
      const displayValue = Number(station.value).toFixed(decimals);
      const unit = UNIT_DISPLAY[station.unit] || station.unit;
      const label = SENSOR_LABELS[station.sensor] || station.sensor;

      return `
        <article class="sensor-card" data-status="${status}">
          <div class="sensor-card-top">
            <div>
              <strong>${station.podId}</strong>
              <small>${station.podName}</small>
            </div>
            <span class="sensor-badge">${status}</span>
          </div>
          <div class="sensor-value">${displayValue}<span>${unit}</span></div>
          <div class="sensor-meta">${label} · ${station.model}</div>
          <div class="sensor-actions">
            <button type="button" data-sensor-action="spike" data-pod-id="${station.podId}" data-sensor="${station.sensor}">Spike</button>
            <button type="button" data-sensor-action="reset" data-pod-id="${station.podId}" data-sensor="${station.sensor}">Reset</button>
          </div>
        </article>
      `;
    })
    .join("");

  sensorElements.buttons.innerHTML = buttons
    .map(
      (button) => `
        <article class="button-card">
          <strong>${button.podId}</strong>
          <small>${button.podName} · MT30 button</small>
          <button type="button" data-sensor-action="press" data-pod-id="${button.podId}">Press for help</button>
        </article>
      `
    )
    .join("");
}

async function loadSensors() {
  const payload = await sensorApi("/status");
  renderSensors(payload);
  setSensorNotice();
  return payload;
}

if (sensorElements.grid) {
  sensorElements.grid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sensor-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.sensorAction;
    const podId = button.dataset.podId;
    const sensor = button.dataset.sensor;

    setBusy(button, true);
    try {
      if (action === "spike") {
        await sensorApi(`/spike/${podId}/${sensor}`, {
          method: "POST",
          body: JSON.stringify({ ticks: 6, step: SPIKE_STEP_BY_SENSOR[sensor] || 10 })
        });
      } else if (action === "reset") {
        await sensorApi(`/reset/${podId}/${sensor}`, {
          method: "POST",
          body: "{}"
        });
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
    if (!button) {
      return;
    }

    const podId = button.dataset.podId;
    setBusy(button, true);
    try {
      await sensorApi(`/press/${podId}`, {
        method: "POST",
        body: JSON.stringify({
          message: `MT30 button pressed at ${podId}. Immediate assistance requested.`
        })
      });
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
