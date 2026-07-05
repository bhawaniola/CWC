import { useCallback, useEffect, useState } from "react";
import { fetchPodStatus, submitEmergencyRequest } from "../api/podApiClient.js";
import { ConnectionBanner } from "../components/ConnectionBanner.jsx";
import { NetworkStatusSummary } from "../components/NetworkStatusSummary.jsx";
import { PodIdentityCard } from "../components/PodIdentityCard.jsx";
import { SosRequestForm } from "../components/SosRequestForm.jsx";
import { SubmissionNotice } from "../components/SubmissionNotice.jsx";

export function PodSosApplication() {
  const [podStatus, setPodStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadStatus = useCallback(async () => {
    const status = await fetchPodStatus();
    setPodStatus(status);
  }, []);

  useEffect(() => {
    loadStatus().catch((error) => {
      setNotice({
        state: "error",
        title: "Pod status unavailable.",
        details: error.message
      });
    });

    const timer = setInterval(() => {
      loadStatus().catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, [loadStatus]);

  async function handleSubmit(formData) {
    setIsSubmitting(true);
    setNotice({
      state: "warning",
      title: "Sending SOS request...",
      details: "Please keep this page open until confirmation appears."
    });

    try {
      const response = await submitEmergencyRequest(formData);
      await loadStatus();
      const request = response.data.request;

      setNotice({
        state: "success",
        title: "SOS request received.",
        details: `SOS ${request.id} | Priority ${request.triage.priority} | Severity ${request.triage.severity}/10 | ${request.triage.reason} | ${response.message}`
      });
    } catch (error) {
      setNotice({
        state: "error",
        title: "SOS submission failed.",
        details: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SANJEEVANI-HELP local Wi-Fi</p>
          <h1>Request emergency help</h1>
          <p className="hero-note">
            You are connected to <strong>{podStatus ? `${podStatus.podName} (${podStatus.podId})` : "this pod"}</strong>.
            Submit your SOS here and the pod will send, relay, or safely store it until a link returns.
          </p>
        </div>
        <ConnectionBanner podStatus={podStatus} />
      </header>

      <main className="shell">
        <section className="sos-panel" aria-labelledby="sosTitle">
          <div className="panel-heading">
            <p className="eyebrow">Citizen SOS</p>
            <h2 id="sosTitle">Tell local responders what happened</h2>
          </div>
          <SosRequestForm isSubmitting={isSubmitting} onSubmit={handleSubmit} />
          <SubmissionNotice notice={notice} />
        </section>

        <aside className="side-rail">
          <PodIdentityCard podStatus={podStatus} />
          <NetworkStatusSummary podStatus={podStatus} />
          <section className="help-panel">
            <strong>Manager controls are not available on this citizen page.</strong>
            <span>Use the simulator console for pod naming, link failures, restores, and manual sync.</span>
          </section>
        </aside>
      </main>
    </>
  );
}
