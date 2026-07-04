export function PodSelectionToolbar({ onSelectAll, onClearSelection }) {
  return (
    <div className="selection-tools">
      <button type="button" onClick={onSelectAll}>
        Select All
      </button>
      <button type="button" onClick={onClearSelection}>
        Clear
      </button>
    </div>
  );
}
