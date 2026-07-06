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
    neighbors: ["POD-02"]
  },
  {
    id: "POD-02",
    name: "Hospital Relief Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-01", "POD-03"]
  },
  {
    id: "POD-03",
    name: "School Shelter Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-02"]
  },
  {
    id: "POD-04",
    name: "Riverbank Village Pod",
    towers: [],
    neighbors: ["POD-05"]
  },
  {
    id: "POD-05",
    name: "Evacuation Route Pod",
    towers: ["CELLTOWER-1"],
    neighbors: ["POD-04"]
  },
  {
    id: "POD-06",
    name: "Remote Village Pod",
    towers: [],
    neighbors: []
  },
  {
    id: "POD-07",
    name: "Supply Warehouse Pod",
    towers: ["CELLTOWER-2"],
    neighbors: ["POD-09"]
  },
  {
    id: "POD-08",
    name: "Medical Camp Pod",
    towers: ["CELLTOWER-2"],
    neighbors: []
  },
  {
    id: "POD-09",
    name: "High Ground Shelter Pod",
    towers: [],
    neighbors: ["POD-10"]
  },
  {
    id: "POD-10",
    name: "Mobile Relay Pod",
    towers: [],
    neighbors: ["POD-09"]
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
