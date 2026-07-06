import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiCheckCircle,
  FiCloud,
  FiDatabase,
  FiDroplet,
  FiEdit3,
  FiHeart,
  FiHome,
  FiLifeBuoy,
  FiRadio,
  FiRefreshCw,
  FiShield,
  FiTool,
  FiTruck,
  FiUsers,
  FiWifi
} from "react-icons/fi";

import {
  fetchCoordinatorStatus,
  syncCoordinator,
  updateCoordinatorField,
  updateCoordinatorTask,
  updateNetworkPath
} from "./api";

const roleIcons = {
  hospital: FiHeart,
  shelter: FiHome,
  workforce: FiUsers,
  fire: FiShield,
  flood: FiLifeBuoy
};

const statusOptions = ["pending", "active", "assigned", "monitoring", "done"];

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

function formatTime(value) {
  if (!value) {
    return "just now";
  }

  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch (error) {
    return "just now";
  }
}

function fieldById(fields, fieldId) {
  return fields.find((field) => field.id === fieldId)?.value ?? 0;
}

function DashboardSpecialist({ data }) {
  const fields = data.fields || [];
  const dashboard = data.role?.dashboard;

  const cardsByDashboard = {
    hospital: [
      {
        icon: FiHeart,
        label: "Emergency capacity",
        value: `${fieldById(fields, "bedsAvailable")} beds`,
        detail: `${fieldById(fields, "criticalPatients")} critical patients in queue`
      },
      {
        icon: FiTruck,
        label: "Medical transport",
        value: `${fieldById(fields, "ambulancesReady")} ambulances`,
        detail: `${fieldById(fields, "oxygenCylinders")} oxygen cylinders available`
      },
      {
        icon: FiActivity,
        label: "Clinical team",
        value: `${fieldById(fields, "emergencyDoctors")} doctors`,
        detail: `${fieldById(fields, "medicineKits")} medicine kits staged`
      }
    ],
    shelter: [
      {
        icon: FiDroplet,
        label: "Water reserve",
        value: `${fieldById(fields, "waterStockLitres")} L`,
        detail: `${fieldById(fields, "sanitationKits")} sanitation kits available`
      },
      {
        icon: FiHome,
        label: "Camp load",
        value: `${fieldById(fields, "occupancy")} people`,
        detail: `${fieldById(fields, "blankets")} blankets ready`
      },
      {
        icon: FiDatabase,
        label: "Food runway",
        value: `${fieldById(fields, "foodPackets")} packets`,
        detail: `${fieldById(fields, "resourceShortageAlerts")} shortage alerts open`
      }
    ],
    workforce: [
      {
        icon: FiUsers,
        label: "Shift strength",
        value: `${fieldById(fields, "volunteersOnDuty")} on duty`,
        detail: `${fieldById(fields, "shiftCoverage")}% shift coverage`
      },
      {
        icon: FiTool,
        label: "Assignable pool",
        value: `${fieldById(fields, "volunteersAvailable")} available`,
        detail: `${fieldById(fields, "pendingAssignments")} assignments pending`
      },
      {
        icon: FiTruck,
        label: "Skilled crews",
        value: `${fieldById(fields, "transportCrews")} crews`,
        detail: `${fieldById(fields, "skilledMedics")} medics in roster`
      }
    ],
    fire: [
      {
        icon: FiAlertTriangle,
        label: "Active alerts",
        value: `${fieldById(fields, "activeRescueAlerts")} alerts`,
        detail: `${fieldById(fields, "criticalEvacuations")} critical evacuations`
      },
      {
        icon: FiTool,
        label: "Equipment status",
        value: `${fieldById(fields, "pumpsReady")} ready`,
        detail: `${fieldById(fields, "breathingKits")} breathing kits ready`
      },
      {
        icon: FiTruck,
        label: "Route risk",
        value: `${fieldById(fields, "blockedRoutes")} blocked`,
        detail: `${fieldById(fields, "waterTenderLevel")}% tender water level`
      }
    ],
    flood: [
      {
        icon: FiLifeBuoy,
        label: "Trapped cases",
        value: `${fieldById(fields, "trappedPeopleCases")} cases`,
        detail: `${fieldById(fields, "rescueTeamsActive")} rescue teams active`
      },
      {
        icon: FiTruck,
        label: "Boat readiness",
        value: `${fieldById(fields, "boatsAvailable")} boats`,
        detail: `${fieldById(fields, "lifeJackets")} life jackets staged`
      },
      {
        icon: FiCheckCircle,
        label: "Rescue progress",
        value: `${fieldById(fields, "completedRescues")} complete`,
        detail: `${fieldById(fields, "ropeKits")} rope kits ready`
      }
    ]
  };

  const cards = cardsByDashboard[dashboard] || cardsByDashboard.shelter;

  return (
    <section className="specialist-grid" aria-label="Specialized dashboard">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article className="specialist-card" key={card.label}>
            <span className="card-icon" aria-hidden="true">
              <Icon />
            </span>
            <div>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function EditableMetric({ field, onChange, pending }) {
  const [draft, setDraft] = useState(field.value);
  const timerRef = useRef(null);

  useEffect(() => {
    setDraft(field.value);
  }, [field.value]);

  function handleChange(event) {
    const nextValue = event.target.value;
    setDraft(nextValue);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onChange(field.id, nextValue);
    }, 350);
  }

  return (
    <label className="metric-editor">
      <span>
        <FiEdit3 aria-hidden="true" />
        {field.label}
      </span>
      <div className="metric-input-row">
        <input
          inputMode={field.inputType === "number" ? "numeric" : "text"}
          max={field.max}
          min={field.min}
          type={field.inputType === "number" ? "number" : "text"}
          value={draft}
          onChange={handleChange}
        />
        <em>{field.unit}</em>
      </div>
      <small>{pending ? "syncing change" : `cloud-synced ${formatTime(field.updatedAt)}`}</small>
    </label>
  );
}

function NetworkCard({ data, onTogglePath, busyPath }) {
  const network = data.network || {};
  const policy = network.networkState || {};
  const routeLabel =
    network.mode === "cloud"
      ? `${network.activePath}${network.activeCellTower ? ` via ${network.activeCellTower}` : ""}`
      : network.mode === "mesh-relay"
        ? `mesh via ${network.relayPod?.podId || "neighbor"}`
        : "local island";

  const pathButtons = [
    { id: "satellite", label: "Satellite", enabled: policy.satelliteEnabled, icon: FiCloud },
    { id: "cellular", label: "Cellular", enabled: policy.cellularEnabled, icon: FiRadio },
    { id: "mesh", label: "Pod mesh", enabled: policy.meshEnabled, icon: FiWifi }
  ];

  return (
    <section className="panel network-panel">
      <div className="panel-heading">
        <span className="section-icon" aria-hidden="true">
          <FiWifi />
        </span>
        <div>
          <p>Pod Network Management</p>
          <h2>{routeLabel}</h2>
        </div>
      </div>

      <div className="route-card">
        <strong>{network.mode || "checking"}</strong>
        <span>Satellite {network.satelliteStatus || "unknown"}</span>
        <span>Cellular {network.cellularStatus || "unknown"}</span>
      </div>

      <div className="policy-grid">
        {pathButtons.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={classNames("policy-toggle", item.enabled ? "enabled" : "disabled")}
              key={item.id}
              type="button"
              disabled={busyPath === item.id}
              onClick={() => onTogglePath(item.id, !item.enabled)}
              title={`${item.enabled ? "Disable" : "Enable"} ${item.label}`}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{item.enabled ? "enabled" : "off"}</strong>
            </button>
          );
        })}
      </div>

      <div className="coverage-list">
        <strong>Range</strong>
        <div>
          {(data.coverageNodes || []).map((node) => (
            <span key={node}>{node}</span>
          ))}
          {(data.connectedTowers || []).map((tower) => (
            <span key={tower}>{tower}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeedItem({ item }) {
  return (
    <article className={classNames("feed-item", item.severity)}>
      <div className="feed-topline">
        <strong>{item.title}</strong>
        <span>{item.severity}</span>
      </div>
      <p>{item.message}</p>
      <footer>
        <span>{item.location}</span>
        <span>{item.source} via {item.transport}</span>
        <span>{formatTime(item.receivedAt)}</span>
      </footer>
    </article>
  );
}

function TaskList({ tasks, onTaskChange }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <span className="section-icon" aria-hidden="true">
          <FiCheckCircle />
        </span>
        <div>
          <p>Coordinator Tasks</p>
          <h2>Role work queue</h2>
        </div>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <article className="task-row" key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <small>{task.detail}</small>
            </div>
            <select value={task.status} onChange={(event) => onTaskChange(task.id, event.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </article>
        ))}
      </div>
    </section>
  );
}

function IncidentList({ incidents }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <span className="section-icon" aria-hidden="true">
          <FiAlertTriangle />
        </span>
        <div>
          <p>Assigned Incidents</p>
          <h2>Priority watch</h2>
        </div>
      </div>
      <div className="incident-list">
        {incidents.map((incident) => (
          <article className={classNames("incident-row", incident.severity)} key={incident.id}>
            <span>{incident.id}</span>
            <strong>{incident.title}</strong>
            <em>{incident.status}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pendingFields, setPendingFields] = useState({});
  const [busyPath, setBusyPath] = useState("");
  const [syncMessage, setSyncMessage] = useState("Live coordinator channel ready.");

  const refresh = useCallback(async (signal) => {
    try {
      const result = await fetchCoordinatorStatus(signal);
      setData(result.data);
      setError("");
    } catch (nextError) {
      if (nextError.name !== "AbortError") {
        setError(nextError.message);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const interval = window.setInterval(() => refresh(controller.signal), 3500);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function handleFieldChange(fieldId, value) {
    setPendingFields((current) => ({ ...current, [fieldId]: true }));

    try {
      const result = await updateCoordinatorField(fieldId, value);
      setData((current) => ({
        ...current,
        fields: current.fields.map((field) =>
          field.id === fieldId ? result.data.field : field
        ),
        syncQueueCount: result.data.syncQueueCount
      }));
      setSyncMessage("Change queued and syncing with cloud.");
    } catch (nextError) {
      setSyncMessage(nextError.message);
    } finally {
      setPendingFields((current) => ({ ...current, [fieldId]: false }));
    }
  }

  async function handleTaskChange(taskId, status) {
    try {
      const result = await updateCoordinatorTask(taskId, status);
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === taskId ? result.data.task : task))
      }));
      setSyncMessage("Task update queued for cloud sync.");
    } catch (nextError) {
      setSyncMessage(nextError.message);
    }
  }

  async function handleTogglePath(pathName, enabled) {
    setBusyPath(pathName);
    try {
      await updateNetworkPath(pathName, enabled);
      await refresh();
    } catch (nextError) {
      setSyncMessage(nextError.message);
    } finally {
      setBusyPath("");
    }
  }

  async function handleManualSync() {
    setSyncMessage("Syncing coordinator data and pulling cloud messages...");
    try {
      const result = await syncCoordinator();
      const sync = result.data?.sync;
      const pull = result.data?.cloudPull;
      setSyncMessage(`${sync?.message || "Sync complete"} ${pull?.message || ""}`.trim());
      await refresh();
    } catch (nextError) {
      setSyncMessage(nextError.message);
    }
  }

  const RoleIcon = useMemo(() => {
    return roleIcons[data?.role?.id] || FiActivity;
  }, [data?.role?.id]);

  if (!data) {
    return (
      <main className="app-shell loading-shell">
        <FiRefreshCw aria-hidden="true" />
        <strong>{error || "Loading coordinator dashboard..."}</strong>
      </main>
    );
  }

  return (
    <main className={classNames("app-shell", `accent-${data.role.accent}`)}>
      <header className="command-header">
        <div className="identity-lockup">
          <span className="role-mark" aria-hidden="true">
            <RoleIcon />
          </span>
          <div>
            <p>{data.role.label}</p>
            <h1>{data.identity.coordinatorName}</h1>
            <small>{data.identity.region} | {data.identity.coordinatorId}</small>
          </div>
        </div>
        <div className="header-actions">
          <div className="sync-pill">
            <FiCloud aria-hidden="true" />
            <span>{syncMessage}</span>
          </div>
          <button className="icon-action" type="button" onClick={handleManualSync} title="Sync now">
            <FiRefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      <DashboardSpecialist data={data} />

      <section className="main-grid">
        <section className="panel metrics-panel">
          <div className="panel-heading">
            <span className="section-icon" aria-hidden="true">
              <FiDatabase />
            </span>
            <div>
              <p>Live Metrics</p>
              <h2>Editable cloud-synced fields</h2>
            </div>
          </div>
          <div className="metrics-grid">
            {data.fields.map((field) => (
              <EditableMetric
                field={field}
                key={field.id}
                pending={pendingFields[field.id]}
                onChange={handleFieldChange}
              />
            ))}
          </div>
        </section>

        <NetworkCard data={data} busyPath={busyPath} onTogglePath={handleTogglePath} />
      </section>

      <section className="lower-grid">
        <section className="panel feed-panel">
          <div className="panel-heading">
            <span className="section-icon" aria-hidden="true">
              <FiRadio />
            </span>
            <div>
              <p>Hazard And Request Intake</p>
              <h2>Cloud and nearby pod-mesh messages</h2>
            </div>
          </div>
          <div className="feed-list">
            {data.inbox.length ? (
              data.inbox.map((item) => <FeedItem item={item} key={item.id} />)
            ) : (
              <div className="empty-state">
                <FiWifi aria-hidden="true" />
                <strong>Listening for role-matched requests</strong>
                <span>Cloud API and nearby pods can post directly into this coordinator.</span>
              </div>
            )}
          </div>
        </section>

        <div className="right-stack">
          <TaskList tasks={data.tasks} onTaskChange={handleTaskChange} />
          <IncidentList incidents={data.incidents} />
        </div>
      </section>

      <section className="hazard-strip">
        <strong>Hazard updates</strong>
        {(data.hazardUpdates || []).slice(0, 4).map((item) => (
          <span className={classNames("hazard-chip", item.severity)} key={item.id}>
            {item.title}: {item.message}
          </span>
        ))}
      </section>
    </main>
  );
}
