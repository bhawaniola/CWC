import { NETWORK_PATHS } from "../constants/networkPaths.js";

export function BulkActionPanel({
  selectedCount,
  isBusy,
  onRefresh,
  onPathChange,
  onForceIsland,
  onRestoreAll,
  onSync
}) {
  return (
    <section className="control-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Manager actions</p>
          <h2>Bulk controls</h2>
        </div>
        <button type="button" onClick={onRefresh} disabled={isBusy}>
          Refresh
        </button>
      </div>

      <div className="selected-callout">
        <strong>{selectedCount}</strong>
        <span>pod{selectedCount === 1 ? "" : "s"} selected</span>
      </div>

      <div className="button-grid">
        {NETWORK_PATHS.map((path) => (
          <div className="button-pair" key={path.key}>
            <button type="button" onClick={() => onPathChange(path.key, "down")} disabled={isBusy || selectedCount === 0}>
              Fail {path.label}
            </button>
            <button type="button" onClick={() => onPathChange(path.key, "up")} disabled={isBusy || selectedCount === 0}>
              Restore {path.label}
            </button>
          </div>
        ))}
        <button className="danger" type="button" onClick={onForceIsland} disabled={isBusy || selectedCount === 0}>
          Force Island Mode
        </button>
        <button type="button" onClick={onRestoreAll} disabled={isBusy || selectedCount === 0}>
          Restore All Paths
        </button>
        <button type="button" onClick={onSync} disabled={isBusy || selectedCount === 0}>
          Manual Sync Queue
        </button>
      </div>
    </section>
  );
}
