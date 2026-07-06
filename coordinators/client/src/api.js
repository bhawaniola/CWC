export async function fetchCoordinatorStatus(signal) {
  const response = await fetch("/api/coordinator/status", { signal });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to load coordinator status.");
  }

  return result;
}

export async function updateCoordinatorField(fieldId, value) {
  const response = await fetch(`/api/coordinator/fields/${fieldId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ value })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to update coordinator field.");
  }

  return result;
}

export async function updateCoordinatorTask(taskId, status) {
  const response = await fetch(`/api/coordinator/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to update coordinator task.");
  }

  return result;
}

export async function updateNetworkPath(pathName, enabled) {
  const action = enabled ? "enable" : "disable";
  const response = await fetch(`/api/network/${pathName}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to update network path.");
  }

  return result;
}

export async function syncCoordinator() {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to sync coordinator.");
  }

  return result;
}
