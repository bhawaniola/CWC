export function SubmissionNotice({ notice }) {
  const state = notice?.state || "idle";
  const title = notice?.title || "Ready for SOS intake.";
  const details =
    notice?.details ||
    "Your request will be triaged locally, then sent through the best available path.";

  return (
    <div className={`notice ${state}`} role="status">
      <strong>{title}</strong>
      <span>{details}</span>
    </div>
  );
}
