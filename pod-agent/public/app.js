const elements = {
  activePath: document.getElementById("activePath"),
  cellularHealth: document.getElementById("cellularHealth"),
  cellularState: document.getElementById("cellularState"),
  infraCelltower1: document.getElementById("infraCelltower1"),
  infraCelltower2: document.getElementById("infraCelltower2"),
  infraSatellite: document.getElementById("infraSatellite"),
  healthPollMeta: document.getElementById("healthPollMeta"),
  manualSync: document.getElementById("manualSync"),
  meshDetail: document.getElementById("meshDetail"),
  meshState: document.getElementById("meshState"),
  modeBadge: document.getElementById("modeBadge"),
  operatorNotice: document.getElementById("operatorNotice"),
  podHeading: document.getElementById("podHeading"),
  podId: document.getElementById("podId"),
  podName: document.getElementById("podName"),
  podNameForm: document.getElementById("podNameForm"),
  podNameInput: document.getElementById("podNameInput"),
  queuedRequests: document.getElementById("queuedRequests"),
  refreshStatus: document.getElementById("refreshStatus"),
  region: document.getElementById("region"),
  requestForm: document.getElementById("requestForm"),
  routeDetail: document.getElementById("routeDetail"),
  satelliteHealth: document.getElementById("satelliteHealth"),
  satelliteState: document.getElementById("satelliteState"),
  submissionNotice: document.getElementById("submissionNotice"),
  towerList: document.getElementById("towerList")
};

function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function enabledLabel(enabled) {
  return enabled ? "Enabled" : "Disabled";
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

function setNotice(target, kind, title, details) {
  if (!target) {
    return;
  }

  const compact = target.classList.contains("compact");
  target.className = `notice ${kind || "ready"}${compact ? " compact" : ""}`;
  target.innerHTML = "";

  const strong = document.createElement("strong");
  strong.textContent = title;
  target.appendChild(strong);

  if (details) {
    const span = document.createElement("span");
    span.textContent = details;
    target.appendChild(span);
  }
}

function setCardState(selector, state) {
  const card = document.querySelector(selector);
  if (card) {
    card.dataset.state = state;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

function describeRoute(status) {
  if (status.mode === "cloud" && status.activePath === "satellite") {
    return "Forwarding through satellite link-node to cloud-api";
  }

  if (status.mode === "cloud" && status.activePath === "cellular") {
    return `Forwarding through ${status.activeCellTower || "cell tower"} to cloud-api`;
  }

  if (status.mode === "mesh-relay" && status.relayPod) {
    const relayPath = status.relayPod.activeCellTower || status.relayPod.cloudPath || "cloud path";
    return `Relaying to ${status.relayPod.podId}, then ${relayPath}`;
  }

  return "Island mode active. SOS requests will be cached locally.";
}

function renderTowerList(status) {
  elements.towerList.innerHTML = "";

  if (!status.cellTowerStatuses || status.cellTowerStatuses.length === 0) {
    const item = document.createElement("span");
    item.className = "tower-chip muted";
    item.textContent = "No cell tower assigned to this pod";
    elements.towerList.appendChild(item);
    return;
  }

  for (const tower of status.cellTowerStatuses) {
    const item = document.createElement("span");
    item.className = "tower-chip";
    item.dataset.state = tower.status;
    item.textContent = `${tower.name}: ${tower.status}`;
    elements.towerList.appendChild(item);
  }
}

function renderStatus(status) {
  elements.podId.textContent = status.podId;
  elements.podName.textContent = status.podName;
  elements.podHeading.textContent = `${status.podName} SOS intake`;
  elements.region.textContent = status.region;
  elements.queuedRequests.textContent = status.queuedRequests;

  if (document.activeElement !== elements.podNameInput) {
    elements.podNameInput.value = status.podName;
  }

  const modeLabel =
    status.mode === "cloud" ? "Cloud online" : status.mode === "mesh-relay" ? "Mesh relay" : "Island mode";
  elements.modeBadge.textContent = modeLabel;
  elements.modeBadge.className = `mode-badge ${status.mode}`;
  elements.activePath.textContent = `Path: ${titleCase(status.activePath)}`;
  elements.routeDetail.textContent = describeRoute(status);

  elements.satelliteState.textContent = enabledLabel(status.networkState.satelliteEnabled);
  elements.cellularState.textContent = enabledLabel(status.networkState.cellularEnabled);
  elements.meshState.textContent = enabledLabel(status.networkState.meshEnabled);
  elements.satelliteHealth.textContent = `health: ${status.satelliteStatus}`;
  elements.cellularHealth.textContent = `health: ${status.cellularStatus}`;
  elements.meshDetail.textContent = `neighbors: ${status.neighbors.length}`;
  elements.healthPollMeta.textContent = status.healthLastCheckedAt
    ? `Health poll: every ${Math.round(status.healthPollIntervalMs / 1000)}s, last checked ${new Date(
        status.healthLastCheckedAt
      ).toLocaleTimeString()}`
    : "Health poll: waiting";

  setCardState('[data-path-card="satellite"]', status.networkState.satelliteEnabled ? "enabled" : "disabled");
  setCardState('[data-path-card="cellular"]', status.networkState.cellularEnabled ? "enabled" : "disabled");
  setCardState('[data-path-card="mesh"]', status.networkState.meshEnabled ? "enabled" : "disabled");
  renderTowerList(status);
}

function renderInfra(infra) {
  const data = infra.data || infra;
  elements.infraSatellite.textContent = data.satellite || "unknown";
  elements.infraCelltower1.textContent = data.celltower1 || "unknown";
  elements.infraCelltower2.textContent = data.celltower2 || "unknown";
  setCardState('[data-infra-card="satellite"]', data.satellite || "unknown");
  setCardState('[data-infra-card="celltower1"]', data.celltower1 || "unknown");
  setCardState('[data-infra-card="celltower2"]', data.celltower2 || "unknown");
}

async function loadStatus() {
  const [status, infra] = await Promise.all([api("/api/pod/status"), api("/api/infra/status")]);
  renderStatus(status.data);
  renderInfra(infra);
  return status.data;
}

elements.refreshStatus.addEventListener("click", async () => {
  setBusy(elements.refreshStatus, true);
  try {
    await loadStatus();
    setNotice(elements.operatorNotice, "success", "Status refreshed.", "Current route and infrastructure state are up to date.");
  } catch (error) {
    setNotice(elements.operatorNotice, "error", "Status refresh failed.", error.message);
  } finally {
    setBusy(elements.refreshStatus, false);
  }
});

elements.podNameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.podNameForm.querySelector("button");
  setBusy(button, true);

  try {
    const result = await api("/api/pod/name", {
      method: "POST",
      body: JSON.stringify({ podName: elements.podNameInput.value })
    });
    renderStatus(result.data);
    setNotice(elements.operatorNotice, "success", "Pod name saved.", `${result.data.podId} now displays as ${result.data.podName}.`);
  } catch (error) {
    setNotice(elements.operatorNotice, "error", "Could not save pod name.", error.message);
  } finally {
    setBusy(button, false);
  }
});

elements.manualSync.addEventListener("click", async () => {
  setBusy(elements.manualSync, true);
  try {
    const result = await api("/api/sync", { method: "POST", body: "{}" });
    await loadStatus();
    setNotice(elements.operatorNotice, result.failed ? "warning" : "success", "Manual sync finished.", result.message);
  } catch (error) {
    setNotice(elements.operatorNotice, "error", "Manual sync failed.", error.message);
  } finally {
    setBusy(elements.manualSync, false);
  }
});

document.querySelectorAll("[data-network-path]").forEach((button) => {
  button.addEventListener("click", async () => {
    const pathName = button.dataset.networkPath;
    const action = button.dataset.networkState;
    setBusy(button, true);

    try {
      const result = await api(`/api/network/${pathName}/${action}`, {
        method: "POST",
        body: "{}"
      });
      await loadStatus();
      setNotice(elements.operatorNotice, "success", `${titleCase(pathName)} ${action}d.`, result.message);
    } catch (error) {
      setNotice(elements.operatorNotice, "error", "Network change failed.", error.message);
    } finally {
      setBusy(button, false);
    }
  });
});

elements.requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.requestForm.querySelector("button[type='submit']");
  setBusy(submitButton, true);

  const formData = new FormData(elements.requestForm);
  const payload = Object.fromEntries(formData.entries());
  payload.age = payload.age ? Number(payload.age) : null;

  try {
    setNotice(elements.submissionNotice, "warning", "Sending SOS request...", "The pod is selecting the best available route.");
    const result = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadStatus();

    const request = result.data.request;
    const details = `SOS ${request.id} | ${request.syncStatus} | Priority ${request.triage.priority} | ${result.message}`;
    setNotice(elements.submissionNotice, "success", "SOS request accepted.", details);
  } catch (error) {
    setNotice(elements.submissionNotice, "error", "SOS submission failed.", error.message);
  } finally {
    setBusy(submitButton, false);
  }
});

loadStatus().catch((error) => {
  setNotice(elements.submissionNotice, "error", "Pod status unavailable.", error.message);
});

setInterval(() => {
  loadStatus().catch(() => {
    // Keep the current UI visible during transient network changes.
  });
}, 5000);
