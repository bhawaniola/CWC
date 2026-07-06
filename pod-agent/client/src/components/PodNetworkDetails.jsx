import { FiActivity, FiClock, FiCloud, FiGitBranch, FiRadio, FiServer } from "react-icons/fi";

function titleCase(value) {
  return String(value || "checking")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(status) {
  if (status === "up" || status === true) {
    return "up";
  }
  if (status === "degraded") {
    return "degraded";
  }
  if (status === "down" || status === "unreachable") {
    return "down";
  }
  return "unknown";
}

function formatTime(value) {
  if (!value) {
    return "waiting for first poll";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatInterval(value) {
  if (!value) {
    return "5s";
  }

  return `${Math.round(value / 1000)}s`;
}

function RouteSummary({ status }) {
  if (!status) {
    return "Checking pod route...";
  }

  if (status.mode === "mesh-relay" && status.relayPod) {
    return `Mesh relay via ${status.relayPod.podId}, then ${titleCase(status.relayPod.cloudPath)}`;
  }

  if (status.mode === "cloud") {
    return `Sending through ${titleCase(status.activePath)}`;
  }

  return "Island mode: requests are cached locally";
}

export default function PodNetworkDetails({ status }) {
  const networkState = status?.networkState || {};
  const towers = status?.cellTowerStatuses || [];
  const relayPod = status?.relayPod;

  return (
    <section className="network-details-card">
      <div className="network-details-header">
        <div>
          <p className="eyebrow live-eyebrow">
            <span aria-hidden="true" />
            Live Pod Details
          </p>
          <h2>{status?.podName || "Local SANJEEVANI Pod"}</h2>
        </div>
        <span className="pod-id-badge">{status?.podId || "POD"}</span>
      </div>

      <div className="route-summary">
        <span className={`route-orb ${statusClass(status?.mode === "island" ? "down" : "up")}`}>
          <FiActivity aria-hidden="true" />
        </span>
        <div>
          <strong>
            <RouteSummary status={status} />
          </strong>
          <small>
            Health poll every {formatInterval(status?.healthPollIntervalMs)}, last checked{" "}
            {formatTime(status?.healthLastCheckedAt)}
          </small>
        </div>
      </div>

      <div className="identity-grid">
        <div>
          <small>Region</small>
          <strong>{status?.region || "Region"}</strong>
        </div>
        <div>
          <small>Queued SOS</small>
          <strong>{status?.queuedRequests ?? 0}</strong>
        </div>
        <div>
          <small>Neighbors</small>
          <strong>{status?.neighbors?.length ?? 0}</strong>
        </div>
      </div>

      <div className="backhaul-grid">
        <div className={`backhaul-chip ${statusClass(status?.satelliteStatus)}`}>
          <FiCloud aria-hidden="true" />
          <span>
            <small>Satellite</small>
            <strong>{titleCase(status?.satelliteStatus)}</strong>
          </span>
        </div>
        <div className={`backhaul-chip ${statusClass(status?.cellularStatus)}`}>
          <FiRadio aria-hidden="true" />
          <span>
            <small>Cellular</small>
            <strong>{titleCase(status?.cellularStatus)}</strong>
          </span>
        </div>
      </div>

      <div className="tower-list">
        {towers.length > 0 ? (
          towers.map((tower) => (
            <div className="tower-row" key={tower.name}>
              <span className={`status-dot ${statusClass(tower.status)}`} />
              <span>{tower.name}</span>
              <strong>{titleCase(tower.status)}</strong>
            </div>
          ))
        ) : (
          <div className="tower-row muted">
            <span className="status-dot unknown" />
            <span>No cellular tower assigned</span>
            <strong>Mesh ready</strong>
          </div>
        )}
      </div>

      <div className="routing-policy-grid">
        <div>
          <FiCloud aria-hidden="true" />
          <span>Satellite</span>
          <strong>{networkState.satelliteEnabled === false ? "Disabled" : "Enabled"}</strong>
        </div>
        <div>
          <FiRadio aria-hidden="true" />
          <span>Cellular</span>
          <strong>{networkState.cellularEnabled === false ? "Disabled" : "Enabled"}</strong>
        </div>
        <div>
          <FiGitBranch aria-hidden="true" />
          <span>Mesh</span>
          <strong>{networkState.meshEnabled === false ? "Disabled" : "Enabled"}</strong>
        </div>
      </div>

      <div className="relay-strip">
        <FiServer aria-hidden="true" />
        <span>
          <strong>{relayPod ? `Relay: ${relayPod.podId}` : "Relay standby"}</strong>
          <small>
            {relayPod
              ? `Cloud path: ${titleCase(relayPod.cloudPath)}`
              : "Neighbor pods can relay when direct links fail"}
          </small>
        </span>
        <FiClock aria-hidden="true" />
      </div>
    </section>
  );
}
