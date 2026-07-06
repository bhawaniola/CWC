import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPodStatus } from "./api/podApi";
import EmergencyRequestForm from "./components/EmergencyRequestForm.jsx";
import HeroPanel from "./components/HeroPanel.jsx";
import LocationSelector from "./components/LocationSelector.jsx";
import PodNetworkDetails from "./components/PodNetworkDetails.jsx";
import ResilienceBanner from "./components/ResilienceBanner.jsx";
import TopNavigation from "./components/TopNavigation.jsx";
import TrustFooter from "./components/TrustFooter.jsx";
import { DEFAULT_LOCATION, createDefaultLocationForPod } from "./data/mapLocations";
import { LanguageProvider } from "./i18n/LanguageContext.jsx";

function SanjeevaniApp() {
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [podStatus, setPodStatus] = useState(null);
  const initializedPodLocationRef = useRef(null);

  const refreshPodStatus = useCallback(async (signal) => {
    try {
      const result = await fetchPodStatus(signal);
      setPodStatus(result.data);
    } catch (error) {
      if (error.name !== "AbortError") {
        setPodStatus(null);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    refreshPodStatus(controller.signal);
    const interval = window.setInterval(() => refreshPodStatus(controller.signal), 5000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshPodStatus]);

  useEffect(() => {
    if (!podStatus?.podId || initializedPodLocationRef.current === podStatus.podId) {
      return;
    }

    initializedPodLocationRef.current = podStatus.podId;
    setLocation(createDefaultLocationForPod(podStatus.podId));
  }, [podStatus?.podId]);

  function handleAddressChange(address) {
    setLocation((current) => ({ ...current, address }));
  }

  return (
    <main className="app-shell">
      <TopNavigation />
      <ResilienceBanner />
      <HeroPanel />

      <section className="content-grid">
        <EmergencyRequestForm
          location={location}
          onAddressChange={handleAddressChange}
          onLocationChange={setLocation}
          podStatus={podStatus}
        />
        <div className="side-column">
          <LocationSelector location={location} onChange={setLocation} />
          <PodNetworkDetails status={podStatus} onStatusChange={setPodStatus} />
        </div>
      </section>

      <TrustFooter />
    </main>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <SanjeevaniApp />
    </LanguageProvider>
  );
}
