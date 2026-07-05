export function ManagerHeader({ selectedCount, reachableCount, totalCount }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">SANJEEVANI operator console</p>
        <h1>Manager control center</h1>
        <p>
          Manage pod display names, fail or restore network paths, and manually sync queues without exposing these tools to victims.
        </p>
      </div>
      <div className="summary-grid">
        <article>
          <strong>{selectedCount}</strong>
          <span>selected</span>
        </article>
        <article>
          <strong>
            {reachableCount}/{totalCount}
          </strong>
          <span>reachable</span>
        </article>
      </div>
    </header>
  );
}
