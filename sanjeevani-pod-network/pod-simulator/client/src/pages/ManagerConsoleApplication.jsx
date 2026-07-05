import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPods,
  forceIslandMode,
  restoreAllPaths,
  syncPods,
  updateNetworkPath,
  updatePodName
} from "../api/managerApiClient.js";
import { ActionNotice } from "../components/ActionNotice.jsx";
import { BulkActionPanel } from "../components/BulkActionPanel.jsx";
import { ManagerHeader } from "../components/ManagerHeader.jsx";
import { PodManagerCard } from "../components/PodManagerCard.jsx";
import { PodSelectionToolbar } from "../components/PodSelectionToolbar.jsx";
import { summarizeResults } from "../utils/textFormatters.js";

export function ManagerConsoleApplication() {
  const [pods, setPods] = useState([]);
  const [selectedPods, setSelectedPods] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const selectedPodIds = useMemo(() => Array.from(selectedPods), [selectedPods]);
  const reachableCount = pods.filter((pod) => pod.reachable).length;

  const loadPods = useCallback(async () => {
    const nextPods = await fetchPods();
    setPods(nextPods);
    setSelectedPods((current) => {
      if (current.size === 0) {
        return new Set(nextPods.map((pod) => pod.podId));
      }

      const available = new Set(nextPods.map((pod) => pod.podId));
      return new Set(Array.from(current).filter((podId) => available.has(podId)));
    });
  }, []);

  useEffect(() => {
    loadPods().catch((error) => {
      setNotice({
        state: "error",
        title: "Could not load pods.",
        details: error.message
      });
    });

    const timer = setInterval(() => {
      loadPods().catch(() => {});
    }, 6000);

    return () => clearInterval(timer);
  }, [loadPods]);

  function changeSelection(podId, checked) {
    setSelectedPods((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(podId);
      } else {
        next.delete(podId);
      }
      return next;
    });
  }

  async function runManagerAction(action, successTitle, affectedCount = selectedPods.size) {
    if (affectedCount === 0) {
      setNotice({
        state: "warning",
        title: "No pods selected.",
        details: "Choose at least one pod before applying a manager action."
      });
      return;
    }

    setIsBusy(true);
    setNotice({
      state: "warning",
      title: "Applying manager action...",
      details: "The simulator is updating selected pods."
    });

    try {
      const result = await action();
      await loadPods();
      setNotice({
        state: result.success ? "success" : "warning",
        title: successTitle || result.message,
        details: summarizeResults(result)
      });
    } catch (error) {
      setNotice({
        state: "error",
        title: "Manager action failed.",
        details: error.message
      });
    } finally {
      setIsBusy(false);
    }
  }

  function handleNetworkPathChange(podIds, path, state) {
    const targetPodIds = podIds || selectedPodIds;
    return runManagerAction(
      () => updateNetworkPath({ podIds: targetPodIds, path, state }),
      `${path} set ${state}`,
      targetPodIds.length
    );
  }

  async function handleNameSave(podId, podName) {
    setIsBusy(true);
    try {
      const result = await updatePodName({ podId, podName });
      await loadPods();
      setNotice({
        state: "success",
        title: "Pod display name saved.",
        details: `${result.data.podId} now shows as ${result.data.podName}.`
      });
    } catch (error) {
      setNotice({
        state: "error",
        title: "Could not save pod name.",
        details: error.message
      });
    } finally {
      setIsBusy(false);
    }
  }

  function handleSync(podIds = selectedPodIds) {
    return runManagerAction(() => syncPods(podIds), "Manual sync requested.", podIds.length);
  }

  return (
    <>
      <ManagerHeader selectedCount={selectedPods.size} reachableCount={reachableCount} totalCount={pods.length} />
      <main className="shell">
        <aside className="manager-rail">
          <BulkActionPanel
            selectedCount={selectedPods.size}
            isBusy={isBusy}
            onRefresh={loadPods}
            onPathChange={(path, state) => handleNetworkPathChange(selectedPodIds, path, state)}
            onForceIsland={() => runManagerAction(() => forceIslandMode(selectedPodIds), "Island mode applied.")}
            onRestoreAll={() => runManagerAction(() => restoreAllPaths(selectedPodIds), "All selected paths restored.")}
            onSync={() => handleSync(selectedPodIds)}
          />
          <ActionNotice notice={notice} />
        </aside>

        <section className="pods-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pod fleet</p>
              <h2>10-pod network</h2>
            </div>
            <PodSelectionToolbar
              onSelectAll={() => setSelectedPods(new Set(pods.map((pod) => pod.podId)))}
              onClearSelection={() => setSelectedPods(new Set())}
            />
          </div>
          <div className="pod-grid">
            {pods.map((pod) => (
              <PodManagerCard
                key={pod.podId}
                pod={pod}
                isSelected={selectedPods.has(pod.podId)}
                isBusy={isBusy}
                onSelectionChange={changeSelection}
                onNameSave={handleNameSave}
                onPathChange={handleNetworkPathChange}
                onSync={handleSync}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
