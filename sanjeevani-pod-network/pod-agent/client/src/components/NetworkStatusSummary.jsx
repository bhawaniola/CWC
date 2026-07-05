const NETWORK_PATHS = [
  { key: "satellite", label: "Satellite" },
  { key: "cellular", label: "Cellular" },
  { key: "mesh", label: "Mesh" }
];

export function NetworkStatusSummary({ podStatus }) {
  const networkState = podStatus?.networkState || {};

  return (
    <section className="info-panel">
      <div className="section-heading">
        <h2>Connection status</h2>
        <span className="quiet-label">Live</span>
      </div>
      <div className="network-grid">
        {NETWORK_PATHS.map((path) => (
          <article className="network-card" data-state={networkState[path.key]} key={path.key}>
            <span>{path.label}</span>
            <strong>{networkState[path.key] || "-"}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
