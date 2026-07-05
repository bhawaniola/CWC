const elements = {
  refresh: document.getElementById("refresh"),
  notice: document.getElementById("notice"),
  satelliteStatus: document.getElementById("satelliteStatus"),
  satelliteDocker: document.getElementById("satelliteDocker"),
  celltower1Status: document.getElementById("celltower1Status"),
  celltower1Docker: document.getElementById("celltower1Docker"),
  celltower2Status: document.getElementById("celltower2Status"),
  celltower2Docker: document.getElementById("celltower2Docker")
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

function renderStatus(payload) {
  const details = payload.data?.details || {};

  for (const [key, view] of Object.entries(viewMap)) {
    const link = details[key] || {};
    view.status.textContent = link.status || "unknown";
    view.docker.textContent = `container: ${link.containerName || "-"} / ${link.dockerStatus || "unknown"}`;
    view.card.dataset.state = link.status || "unknown";
  }
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

loadStatus().catch((error) => setNotice("error", error.message));
setInterval(() => loadStatus().catch(() => {}), 3000);
