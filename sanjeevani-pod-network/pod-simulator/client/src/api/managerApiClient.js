const JSON_HEADERS = {
  "Content-Type": "application/json"
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...JSON_HEADERS,
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
}

export function fetchPods() {
  return request("/api/pods").then((response) => response.data);
}

export function updatePodName({ podId, podName }) {
  return request("/api/pods/name", {
    method: "POST",
    body: JSON.stringify({ podId, podName })
  });
}

export function updateNetworkPath({ podIds, path, state }) {
  return request("/api/pods/network", {
    method: "POST",
    body: JSON.stringify({ podIds, path, state })
  });
}

export function forceIslandMode(podIds) {
  return request("/api/pods/island", {
    method: "POST",
    body: JSON.stringify({ podIds })
  });
}

export function restoreAllPaths(podIds) {
  return request("/api/pods/restore-all", {
    method: "POST",
    body: JSON.stringify({ podIds })
  });
}

export function syncPods(podIds) {
  return request("/api/pods/sync", {
    method: "POST",
    body: JSON.stringify({ podIds })
  });
}
