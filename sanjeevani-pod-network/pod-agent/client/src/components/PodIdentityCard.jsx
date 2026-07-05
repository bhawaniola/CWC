export function PodIdentityCard({ podStatus }) {
  return (
    <section className="info-panel">
      <div className="section-heading">
        <h2>Your local pod</h2>
        <span className="pill">{podStatus?.podId || "-"}</span>
      </div>
      <dl className="pod-facts">
        <div>
          <dt>Name</dt>
          <dd>{podStatus?.podName || "-"}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{podStatus?.region || "-"}</dd>
        </div>
        <div>
          <dt>Waiting to sync</dt>
          <dd>{podStatus?.queuedRequests ?? "-"}</dd>
        </div>
      </dl>
    </section>
  );
}
