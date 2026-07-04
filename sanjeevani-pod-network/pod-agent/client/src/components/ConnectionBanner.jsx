import { modeLabel, titleCase } from "../utils/textFormatters.js";

export function ConnectionBanner({ podStatus }) {
  if (!podStatus) {
    return (
      <aside className="connection-card">
        <span className="mode-badge">Checking</span>
        <strong>Finding nearest path</strong>
        <span>Preparing local SOS intake</span>
      </aside>
    );
  }

  return (
    <aside className="connection-card" aria-live="polite">
      <span className={`mode-badge ${podStatus.mode}`}>{modeLabel(podStatus.mode)}</span>
      <strong>Path: {titleCase(podStatus.activePath)}</strong>
      <span>
        {podStatus.relayPod
          ? `Relaying through ${podStatus.relayPod.podId}`
          : "Direct local pod intake active"}
      </span>
    </aside>
  );
}
