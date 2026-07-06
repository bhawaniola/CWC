const elements = {
  activePath: document.getElementById("activePath"),
  accuracyLabel: document.getElementById("accuracyLabel"),
  addressInput: document.getElementById("addressInput"),
  closeMapButton: document.getElementById("closeMapButton"),
  confirmMapButton: document.getElementById("confirmMapButton"),
  healthPollMeta: document.getElementById("healthPollMeta"),
  latInput: document.getElementById("latInput"),
  lngInput: document.getElementById("lngInput"),
  mapModal: document.getElementById("mapModal"),
  mapPointInput: document.getElementById("mapPointInput"),
  modeBadge: document.getElementById("modeBadge"),
  modalCoordinates: document.getElementById("modalCoordinates"),
  modalPrecision: document.getElementById("modalPrecision"),
  modalZoneLabel: document.getElementById("modalZoneLabel"),
  openMapButton: document.getElementById("openMapButton"),
  podId: document.getElementById("podId"),
  previewPin: document.getElementById("previewPin"),
  requestForm: document.getElementById("requestForm"),
  routeDetail: document.getElementById("routeDetail"),
  selectedCoordinates: document.getElementById("selectedCoordinates"),
  selectedMapLabel: document.getElementById("selectedMapLabel"),
  smallMapButton: document.getElementById("smallMapButton"),
  submissionNotice: document.getElementById("submissionNotice"),
  wideMap: document.getElementById("wideMap"),
  wideMapPin: document.getElementById("wideMapPin"),
  zoneSelect: document.getElementById("zoneSelect")
};

const mapBounds = {
  north: 17.560000,
  south: 17.210000,
  west: 78.260000,
  east: 78.620000
};

const mapLocations = [
  { label: "Pod 1 sector", address: "Hill road settlement near Pod 1", x: 34.7, y: 16.7 },
  { label: "Pod 2 sector", address: "Central village near Pod 2", x: 55.2, y: 15.8 },
  { label: "Pod 3 sector", address: "River approach village near Pod 3", x: 74.8, y: 15.7 },
  { label: "Pod 4 sector", address: "West village near Pod 4", x: 24.1, y: 45.8 },
  { label: "Pod 5 sector", address: "Central road settlement near Pod 5", x: 38.8, y: 45.3 },
  { label: "Pod 6 sector", address: "East bridge village near Pod 6", x: 81.0, y: 43.8 },
  { label: "Pod 7 sector", address: "City edge road near Pod 7", x: 25.2, y: 77.0 },
  { label: "Pod 8 sector", address: "South central village near Pod 8", x: 45.6, y: 85.0 },
  { label: "Pod 9 sector", address: "Lower river village near Pod 9", x: 78.2, y: 74.2 },
  { label: "Pod 10 sector", address: "South floodplain village near Pod 10", x: 77.5, y: 87.4 },
  { label: "Main Base Center", address: "Main Base Center hill command area", x: 54.0, y: 50.5 },
  { label: "Shelter Camp A", address: "Shelter Camp A central north road", x: 43.1, y: 27.3 },
  { label: "Shelter Camp B", address: "Shelter Camp B east connector road", x: 67.3, y: 42.4 },
  { label: "Shelter Camp C", address: "Shelter Camp C south route", x: 57.1, y: 72.0 },
  { label: "Hospital 1", address: "Hospital 1 near east highway", x: 77.3, y: 27.0 },
  { label: "Hospital 2", address: "Hospital 2 near city edge", x: 23.6, y: 65.7 },
  { label: "Flood prone river edge", address: "Suryaa river flood prone area", x: 92.0, y: 66.0 },
  { label: "Kothapalli, Zone 3", address: "Kothapalli Zone 3", x: 74.4, y: 41.8 }
];

let selectedLocation = buildLocation(mapLocations[17].x, mapLocations[17].y);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function coordinatesFromPercent(x, y) {
  const lat = mapBounds.north - (clamp(y, 0, 100) / 100) * (mapBounds.north - mapBounds.south);
  const lng = mapBounds.west + (clamp(x, 0, 100) / 100) * (mapBounds.east - mapBounds.west);
  return { lat, lng };
}

function nearestMapLocation(x, y) {
  return mapLocations.reduce((nearest, location) => {
    const distance = Math.hypot(location.x - x, location.y - y);
    return distance < nearest.distance ? { location, distance } : nearest;
  }, { location: mapLocations[0], distance: Number.POSITIVE_INFINITY });
}

function buildLocation(x, y) {
  const preciseX = Number(clamp(x, 0, 100).toFixed(2));
  const preciseY = Number(clamp(y, 0, 100).toFixed(2));
  const nearest = nearestMapLocation(preciseX, preciseY);
  const coordinates = coordinatesFromPercent(preciseX, preciseY);
  const metersApprox = Math.round(nearest.distance * 38);

  return {
    label: nearest.location.label,
    address: nearest.location.address,
    x: preciseX,
    y: preciseY,
    lat: Number(coordinates.lat.toFixed(6)),
    lng: Number(coordinates.lng.toFixed(6)),
    precision: `Click locked at X ${preciseX.toFixed(2)}%, Y ${preciseY.toFixed(2)}%`,
    nearestDistanceMeters: metersApprox
  };
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

function setNotice(kind, title, details) {
  elements.submissionNotice.className = `notice ${kind || "ready"}`;
  elements.submissionNotice.innerHTML = "";

  const strong = document.createElement("strong");
  strong.textContent = title;
  elements.submissionNotice.appendChild(strong);

  if (details) {
    const span = document.createElement("span");
    span.textContent = details;
    elements.submissionNotice.appendChild(span);
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
    return "Satellite path available";
  }
  if (status.mode === "cloud" && status.activePath === "cellular") {
    return `${status.activeCellTower || "Cellular"} path available`;
  }
  if (status.mode === "mesh-relay" && status.relayPod) {
    return `Mesh relay through ${status.relayPod.podId}`;
  }
  return "Offline resilient mode";
}

function renderStatus(status) {
  elements.podId.textContent = status.podId || "Pod: -";
  elements.modeBadge.textContent = status.mode === "cloud" ? "Offline Resilient" : status.mode === "mesh-relay" ? "Mesh Relay" : "Saved Locally";
  elements.modeBadge.dataset.mode = status.mode;
  elements.activePath.textContent = `Path: ${titleCase(status.activePath)}`;
  elements.routeDetail.textContent = describeRoute(status);
  elements.healthPollMeta.textContent = status.healthLastCheckedAt
    ? `Links checked every ${Math.round(status.healthPollIntervalMs / 1000)} sec`
    : "Checking links";
}

async function loadStatus() {
  const status = await api("/api/pod/status");
  renderStatus(status.data);
  return status.data;
}

function renderSelectedLocation(location) {
  selectedLocation = location;
  const coordText = `Lat ${location.lat.toFixed(6)}, Long ${location.lng.toFixed(6)}`;

  elements.selectedMapLabel.textContent = location.label;
  elements.selectedCoordinates.textContent = coordText;
  elements.accuracyLabel.textContent = `Location accurate within nearest ${location.nearestDistanceMeters} m map sector`;
  elements.mapPointInput.value = location.label;
  elements.latInput.value = location.lat.toFixed(6);
  elements.lngInput.value = location.lng.toFixed(6);
  elements.modalZoneLabel.textContent = location.label;
  elements.modalCoordinates.textContent = coordText;
  elements.modalPrecision.textContent = location.precision;
  elements.previewPin.style.left = `${location.x}%`;
  elements.previewPin.style.top = `${location.y}%`;
  elements.wideMapPin.style.left = `${location.x}%`;
  elements.wideMapPin.style.top = `${location.y}%`;

  if (!elements.addressInput.value.trim() || elements.addressInput.dataset.autoFilled === "true") {
    elements.addressInput.value = location.address;
    elements.addressInput.dataset.autoFilled = "true";
  }

  if (![...elements.zoneSelect.options].some((option) => option.value === location.label)) {
    elements.zoneSelect.add(new Option(location.label, location.label));
  }
  elements.zoneSelect.value = location.label;
}

function locationFromMapEvent(event, target) {
  const rect = target.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return buildLocation(x, y);
}

function openMapModal() {
  elements.mapModal.classList.add("open");
  elements.mapModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeMapModal() {
  elements.mapModal.classList.remove("open");
  elements.mapModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

elements.addressInput.addEventListener("input", () => {
  elements.addressInput.dataset.autoFilled = "false";
});

elements.openMapButton.addEventListener("click", openMapModal);
elements.smallMapButton.addEventListener("click", openMapModal);
elements.closeMapButton.addEventListener("click", closeMapModal);
elements.confirmMapButton.addEventListener("click", closeMapModal);

elements.mapModal.addEventListener("click", (event) => {
  if (event.target === elements.mapModal) {
    closeMapModal();
  }
});

elements.wideMap.addEventListener("click", (event) => {
  renderSelectedLocation(locationFromMapEvent(event, elements.wideMap));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMapModal();
  }
});

elements.requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.requestForm.querySelector("button[type='submit']");
  setBusy(submitButton, true);

  const formData = new FormData(elements.requestForm);
  const payload = Object.fromEntries(formData.entries());
  payload.age = payload.age ? Number(payload.age) : null;
  payload.location = `${payload.location} | Zone: ${payload.zone} | Map: ${payload.mapPoint} | Lat ${payload.lat}, Long ${payload.lng}`;

  try {
    setNotice("warning", "Sending request...", "Please keep this page open until confirmation appears.");
    const result = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadStatus();

    const request = result.data.request;
    setNotice(
      "success",
      "Request submitted.",
      `${request.syncStatus} via ${titleCase(result.data.activePath)}. Request ID: ${request.id}`
    );
  } catch (error) {
    setNotice("error", "Submission failed.", error.message);
  } finally {
    setBusy(submitButton, false);
  }
});

renderSelectedLocation(selectedLocation);
loadStatus().catch((error) => {
  setNotice("error", "Pod status unavailable.", error.message);
});

setInterval(() => {
  loadStatus().catch(() => {});
}, 5000);
