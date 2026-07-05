export function ActionNotice({ notice }) {
  const state = notice?.state || "idle";
  const title = notice?.title || "Ready.";
  const details = notice?.details || "Select pods and apply a manager action.";

  return (
    <div className={`notice ${state}`} role="status">
      <strong>{title}</strong>
      <span>{details}</span>
    </div>
  );
}
