export function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function summarizeResults(result) {
  const failed = (result.results || []).filter((item) => !item.success).length;
  return failed ? `${failed} operation(s) failed.` : "All selected pods updated.";
}
