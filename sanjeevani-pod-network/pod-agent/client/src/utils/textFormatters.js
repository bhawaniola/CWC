export function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function modeLabel(mode) {
  if (mode === "mesh-relay") {
    return "Mesh Relay";
  }

  if (mode === "cloud") {
    return "Cloud";
  }

  return "Island";
}
