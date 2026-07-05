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

export function fetchPodStatus() {
  return request("/api/pod/status").then((response) => response.data);
}

export function submitEmergencyRequest(data) {
  return request("/api/requests", {
    method: "POST",
    body: JSON.stringify(data)
  });
}
