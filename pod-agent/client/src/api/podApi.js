export async function fetchPodStatus(signal) {
  const response = await fetch("/api/pod/status", { signal });

  if (!response.ok) {
    throw new Error("Unable to load pod status.");
  }

  return response.json();
}

export async function submitSosRequest(payload) {
  const response = await fetch("/api/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to submit SOS.");
  }

  return result;
}
