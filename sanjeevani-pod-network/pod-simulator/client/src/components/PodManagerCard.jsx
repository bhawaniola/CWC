import { useEffect, useState } from "react";
import { NETWORK_PATHS } from "../constants/networkPaths.js";
import { titleCase } from "../utils/textFormatters.js";

export function PodManagerCard({
  pod,
  isSelected,
  isBusy,
  onSelectionChange,
  onNameSave,
  onPathChange,
  onSync
}) {
  const [draftName, setDraftName] = useState(pod.podName || pod.podId);

  useEffect(() => {
    setDraftName(pod.podName || pod.podId);
  }, [pod.podName, pod.podId]);

  function submitName(event) {
    event.preventDefault();
    onNameSave(pod.podId, draftName);
  }

  return (
    <article className={`pod-card ${pod.reachable ? "" : "unreachable"}`}>
      <div className="pod-head">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => onSelectionChange(pod.podId, event.target.checked)}
          aria-label={`Select ${pod.podId}`}
        />
        <div className="pod-title">
          <strong>{pod.podName || pod.podId}</strong>
          <span>
            {pod.podId} | {pod.region || "unknown region"}
          </span>
        </div>
      </div>

      <div className={`mode-chip ${pod.mode}`}>
        <span>Mode</span>
        <strong>{pod.reachable ? titleCase(pod.mode) : "Unreachable"}</strong>
      </div>

      <div className="state-grid">
        {NETWORK_PATHS.map((path) => (
          <div className={`state-chip ${pod.networkState[path.key]}`} key={path.key}>
            <span>{path.label}</span>
            <strong>{pod.networkState[path.key]}</strong>
          </div>
        ))}
      </div>

      <form className="name-editor" onSubmit={submitName}>
        <label>
          Display name
          <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength="80" />
        </label>
        <button type="submit" disabled={isBusy || !pod.reachable}>
          Save
        </button>
      </form>

      <div className="local-tools">
        {NETWORK_PATHS.map((path) => (
          <div className="mini-pair" key={path.key}>
            <button type="button" onClick={() => onPathChange([pod.podId], path.key, "down")} disabled={isBusy || !pod.reachable}>
              Fail {path.label}
            </button>
            <button type="button" onClick={() => onPathChange([pod.podId], path.key, "up")} disabled={isBusy || !pod.reachable}>
              Up
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onSync([pod.podId])} disabled={isBusy || !pod.reachable}>
          Sync this pod
        </button>
      </div>
    </article>
  );
}
