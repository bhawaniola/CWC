import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiBriefcase,
  FiCheckCircle,
  FiClock,
  FiCloud,
  FiDatabase,
  FiDroplet,
  FiEdit3,
  FiHeart,
  FiHome,
  FiInbox,
  FiLifeBuoy,
  FiMap,
  FiMapPin,
  FiRadio,
  FiRefreshCw,
  FiSend,
  FiShield,
  FiTool,
  FiTruck,
  FiUserCheck,
  FiUsers,
  FiWifi,
  FiZap
} from "react-icons/fi";

import {
  fetchCoordinatorStatus,
  syncCoordinator,
  updateCoordinatorField,
  updateCoordinatorTask,
  updateInboxRequest,
  updateNetworkPath
} from "./api";
import sanjeevaniLogo from "./assets/sanjeevani-logo.png";

const roleIcons = {
  hospital: FiHeart,
  shelter: FiHome,
  workforce: FiUsers,
  fire: FiShield,
  flood: FiLifeBuoy
};

const statusOptions = ["pending", "active", "assigned", "monitoring", "done"];

const ambulanceSeed = [
  {
    id: "AMB-104",
    type: "ALS",
    crew: "Dr. Meera + Kiran",
    location: "District Hospital",
    status: "ready",
    oxygen: 92
  },
  {
    id: "AMB-117",
    type: "BLS",
    crew: "Rafiq + Neha",
    location: "North Gate triage",
    status: "ready",
    oxygen: 76
  },
  {
    id: "AMB-122",
    type: "ICU",
    crew: "Ananya + Suresh",
    location: "Mobile ICU bay",
    status: "ready",
    oxygen: 88
  },
  {
    id: "AMB-136",
    type: "BLS",
    crew: "Standby crew",
    location: "Fuel and supply line",
    status: "maintenance",
    oxygen: 40
  }
];

const workforceSeed = [
  {
    id: "WF-021",
    name: "Asha Nair",
    skill: "Medic",
    zone: "North shelter",
    status: "available"
  },
  {
    id: "WF-034",
    name: "Rohan Das",
    skill: "Logistics",
    zone: "Supply yard",
    status: "available"
  },
  {
    id: "WF-047",
    name: "Mehul Shah",
    skill: "Driver",
    zone: "Ambulance bay",
    status: "available"
  },
  {
    id: "WF-052",
    name: "Farah Khan",
    skill: "Registration",
    zone: "Shelter desk",
    status: "available"
  },
  {
    id: "WF-063",
    name: "Tenzin Dorji",
    skill: "Rescue support",
    zone: "Bridge point",
    status: "available"
  },
  {
    id: "WF-078",
    name: "Kavya Rao",
    skill: "Food line",
    zone: "Community kitchen",
    status: "assigned",
    assignedTo: "Main school shelter"
  }
];

const shelterTargets = [
  { id: "shelter-school", label: "Main school shelter", capacity: 420, load: 276 },
  { id: "shelter-temple", label: "Temple relief hall", capacity: 220, load: 154 },
  { id: "shelter-stadium", label: "Indoor stadium camp", capacity: 700, load: 398 }
];

const stagingPoints = [
  { id: "staging-north", label: "North bridge point" },
  { id: "staging-market", label: "Old market road" },
  { id: "staging-hospital", label: "Hospital gate 2" }
];

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

function normalizeOperationEvent(item, fallbackLocation, type = "inbox") {
  const route = item.deliveryRoute || item.raw?.deliveryRoute || {};
  const routing = item.raw?.routing || {};
  const target = routing.targetCoordinator || {};
  const matchedDepartments =
    item.matchedDepartments ||
    routing.classification?.departments?.map((department) => department.label || department.role).filter(Boolean) ||
    item.raw?.requestTypes ||
    [];

  return {
    id: item.id,
    title: item.title || "Coordinator request",
    message: item.message || item.detail || item.status || "Awaiting coordinator action.",
    location: item.location || fallbackLocation || "Regional command zone",
    severity: item.severity || "medium",
    source: item.source || (type === "incident" ? "incident desk" : "coordinator"),
    transport: item.transport || (type === "incident" ? "local" : "mesh"),
    targetCoordinatorName: item.targetCoordinatorName || target.name || "",
    targetRole: item.targetRole || target.role || "",
    deliveryRoute: route,
    deliveryId: item.deliveryId || routing.deliveryId || "",
    routingSummary: item.routingSummary || routing.classification?.summary || "",
    matchedDepartments,
    receivedAt: item.receivedAt || item.updatedAt,
    type
  };
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
    <label className={classNames("metric-editor", field.shortageLevel && `stock-${field.shortageLevel}`)}>
      <span>
        <FiEdit3 aria-hidden="true" />
        {field.label}
        {field.shortageLevel ? (
          <b className={classNames("stock-chip", field.shortageLevel)}>
            {field.shortageLevel === "out-of-stock" ? "OUT OF STOCK" : "LOW STOCK"}
          </b>
        ) : null}
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

function FeedItem({ item, selected, busy, onSelect, onAction }) {
  // Another coordinator's claim, synced down from the Command Center. Shown
  // as advice, never a lock: with links dark the claim can't arrive, and a
  // second team responding is always allowed — better two than none.
  const peerClaims = Array.isArray(item.peerResolutions) ? item.peerResolutions : [];
  const peerClaim =
    peerClaims.find((entry) => entry.status === "resolved") ||
    peerClaims.find((entry) => entry.status === "acknowledged") ||
    null;
  const peerName = peerClaim?.coordinatorName || peerClaim?.coordinatorId || "";

  return (
    <article
      className={classNames(
        "feed-item",
        item.severity,
        selected && "selected",
        item.workStatus === "acknowledged" && "acknowledged",
        peerClaim && "peer-claimed"
      )}
      onClick={() => onSelect(item)}
    >
      <div className="feed-topline">
        <strong>{item.title}</strong>
        <span>{item.severity}</span>
      </div>
      {peerClaim ? (
        <p className={classNames("peer-claim-line", peerClaim.status)}>
          <FiUserCheck aria-hidden="true" />
          <b>{peerClaim.status === "resolved" ? "Handled" : "Claimed"} by {peerName}</b>
          {peerClaim.status === "resolved"
            ? " — case closed by that team."
            : " — team already responding; stand down unless contacted."}
          {peerClaim.at ? ` (${formatTime(peerClaim.at)})` : ""}
        </p>
      ) : null}
      <p>{item.message}</p>
      {item.aiTriage?.reason ? (
        <p className={classNames("ai-triage-line", item.aiTriage.upgraded && "upgraded")}>
          <FiZap aria-hidden="true" />
          <b>{item.aiTriage.upgraded ? "AI upgraded" : "AI"}</b>
          {item.aiTriage.reason}
        </p>
      ) : null}
      {(item.targetCoordinatorName || item.routingSummary || item.matchedDepartments?.length) ? (
        <div className="feed-route-meta">
          {item.targetCoordinatorName ? <span>Target: {item.targetCoordinatorName}</span> : null}
          {item.deliveryRoute?.transport ? (
            <span>
              Route: {item.deliveryRoute.transport}
              {item.deliveryRoute.linkName ? ` / ${item.deliveryRoute.linkName}` : ""}
            </span>
          ) : null}
          {item.matchedDepartments?.length ? <span>Type: {item.matchedDepartments.join(", ")}</span> : null}
        </div>
      ) : null}
      <footer>
        <span>{item.location}</span>
        <span>{item.source} via {item.transport}</span>
        <span>
          received {formatTime(item.receivedAt)}
          {item.originatedAt && formatTime(item.originatedAt) !== formatTime(item.receivedAt)
            ? ` (sent ${formatTime(item.originatedAt)})`
            : ""}
        </span>
      </footer>
      <div className="feed-actions">
        {item.workStatus === "acknowledged" ? (
          <em className="work-chip">
            <FiCheckCircle aria-hidden="true" />
            acknowledged {formatTime(item.acknowledgedAt)}
          </em>
        ) : (
          <button
            className="action-chip"
            disabled={busy}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAction(item, "acknowledged");
            }}
          >
            Acknowledge
          </button>
        )}
        <button
          className="action-chip resolve"
          disabled={busy}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction(item, "resolved");
          }}
        >
          <FiCheckCircle aria-hidden="true" />
          Mark handled
        </button>
      </div>
    </article>
  );
}

function HistoryList({ history }) {
  if (!history.length) {
    return (
      <div className="empty-state">
        <FiClock aria-hidden="true" />
        <strong>No handled requests yet</strong>
        <span>Requests you mark as handled are archived here and reported to the Command Center.</span>
      </div>
    );
  }

  return (
    <div className="history-list">
      {history.map((item) => (
        <article className={classNames("history-row", item.severity)} key={`${item.id}-${item.resolvedAt}`}>
          <div className="history-topline">
            <strong>{item.title}</strong>
            <span className="history-when">
              <FiCheckCircle aria-hidden="true" />
              handled {formatTime(item.resolvedAt)}
            </span>
          </div>
          <p>{item.message}</p>
          <footer>
            <span>{item.location}</span>
            <span>arrived via {item.transport}</span>
            <span>received {formatTime(item.receivedAt)}</span>
          </footer>
        </article>
      ))}
    </div>
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

function IncidentList({ incidents, selectedEventId, onSelectIncident }) {
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
          <button
            className={classNames("incident-row", incident.severity, selectedEventId === incident.id && "selected")}
            key={incident.id}
            type="button"
            onClick={() => onSelectIncident(incident)}
          >
            <span>{incident.id}</span>
            <strong>{incident.title}</strong>
            <em>{incident.status}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function OperationsBoard({
  ambulanceRoster,
  events,
  operationLog,
  selectedAmbulanceId,
  selectedEvent,
  selectedEventId,
  selectedShelterId,
  selectedStagingPointId,
  selectedWorkerIds,
  workerRoster,
  onAssignWorkers,
  onDispatchAmbulance,
  onSelectAmbulance,
  onSelectEvent,
  onSelectShelter,
  onSelectStagingPoint,
  onToggleWorker
}) {
  const availableAmbulances = ambulanceRoster.filter((ambulance) => ambulance.status === "ready").length;
  const availableWorkers = workerRoster.filter((worker) => worker.status === "available").length;
  const activeTarget =
    selectedEvent ||
    events[0] || {
      id: "regional-standby",
      title: "Regional standby",
      message: "No active requests in the current queue.",
      location: "Command zone",
      severity: "info",
      source: "coordinator",
      transport: "local",
      receivedAt: new Date().toISOString()
    };
  const selectedShelter = shelterTargets.find((target) => target.id === selectedShelterId) || shelterTargets[0];
  const selectedPoint =
    stagingPoints.find((point) => point.id === selectedStagingPointId) || stagingPoints[0];

  return (
    <section className="operations-grid" aria-label="Coordinator operations">
      <section className="panel dispatch-panel">
        <div className="panel-heading">
          <span className="section-icon" aria-hidden="true">
            <FiMapPin />
          </span>
          <div>
            <p>Event Assignment</p>
            <h2>Active dispatch target</h2>
          </div>
        </div>

        <div className={classNames("target-card", activeTarget.severity)}>
          <div>
            <span>{activeTarget.severity}</span>
            <h3>{activeTarget.title}</h3>
            <p>{activeTarget.message}</p>
          </div>
          <strong>
            <FiMapPin aria-hidden="true" />
            {activeTarget.location}
          </strong>
        </div>

        <div className="target-list">
          {events.slice(0, 4).map((event) => (
            <button
              className={classNames("target-option", selectedEventId === event.id && "selected")}
              key={`${event.type}-${event.id}`}
              type="button"
              onClick={() => onSelectEvent(event)}
            >
              <span className={classNames("severity-dot", event.severity)} />
              <strong>{event.title}</strong>
              <small>{event.location}</small>
            </button>
          ))}
        </div>

        <div className="resource-stat-row">
          <span>
            <strong>{availableAmbulances}</strong>
            <small>Ambulances ready</small>
          </span>
          <span>
            <strong>{availableWorkers}</strong>
            <small>Workers free</small>
          </span>
          <span>
            <strong>{selectedWorkerIds.length}</strong>
            <small>Workers selected</small>
          </span>
        </div>
      </section>

      <section className="panel ambulance-panel">
        <div className="panel-heading compact">
          <span className="section-icon" aria-hidden="true">
            <FiTruck />
          </span>
          <div>
            <p>Ambulance Control</p>
            <h2>Numbered fleet</h2>
          </div>
        </div>

        <div className="ambulance-list">
          {ambulanceRoster.map((ambulance) => (
            <button
              className={classNames(
                "ambulance-option",
                ambulance.status,
                selectedAmbulanceId === ambulance.id && "selected"
              )}
              disabled={ambulance.status !== "ready"}
              key={ambulance.id}
              type="button"
              onClick={() => onSelectAmbulance(ambulance.id)}
            >
              <span>
                <strong>{ambulance.id}</strong>
                <em>{ambulance.type}</em>
              </span>
              <small>{ambulance.crew}</small>
              <footer>
                <span>{ambulance.location}</span>
                <span>{ambulance.oxygen}% O2</span>
              </footer>
            </button>
          ))}
        </div>

        <button
          className="primary-action danger-action"
          disabled={!selectedAmbulanceId || activeTarget.id === "regional-standby"}
          type="button"
          onClick={onDispatchAmbulance}
        >
          <FiSend aria-hidden="true" />
          Dispatch ambulance
        </button>
      </section>

      <section className="panel workforce-panel">
        <div className="panel-heading compact">
          <span className="section-icon" aria-hidden="true">
            <FiUserCheck />
          </span>
          <div>
            <p>Workforce Control</p>
            <h2>Shelter assignment</h2>
          </div>
        </div>

        <div className="assignment-controls">
          <label>
            <span>Shelter</span>
            <select value={selectedShelterId} onChange={(event) => onSelectShelter(event.target.value)}>
              {shelterTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Send via</span>
            <select value={selectedStagingPointId} onChange={(event) => onSelectStagingPoint(event.target.value)}>
              {stagingPoints.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="worker-list">
          {workerRoster.map((worker) => (
            <button
              className={classNames(
                "worker-option",
                worker.status,
                selectedWorkerIds.includes(worker.id) && "selected"
              )}
              disabled={worker.status !== "available"}
              key={worker.id}
              type="button"
              onClick={() => onToggleWorker(worker.id)}
            >
              <span>
                <strong>{worker.name}</strong>
                <em>{worker.id}</em>
              </span>
              <small>{worker.skill}</small>
              <footer>
                <span>{worker.assignedTo || worker.zone}</span>
                <span>{worker.status}</span>
              </footer>
            </button>
          ))}
        </div>

        <button
          className="primary-action"
          disabled={selectedWorkerIds.length === 0}
          type="button"
          onClick={onAssignWorkers}
        >
          <FiBriefcase aria-hidden="true" />
          Assign to {selectedShelter.label}
        </button>

        <div className="destination-chip">
          <FiMap aria-hidden="true" />
          <span>{selectedPoint.label}</span>
        </div>
      </section>

      <section className="panel operations-log-panel">
        <div className="panel-heading compact">
          <span className="section-icon" aria-hidden="true">
            <FiClock />
          </span>
          <div>
            <p>Movement Log</p>
            <h2>Recent actions</h2>
          </div>
        </div>

        <div className="operation-log">
          {operationLog.map((entry) => (
            <article className={classNames("log-row", entry.tone)} key={entry.id}>
              <span>{formatTime(entry.time)}</span>
              <div>
                <strong>{entry.title}</strong>
                <small>{entry.detail}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pendingFields, setPendingFields] = useState({});
  const [busyPath, setBusyPath] = useState("");
  const [syncMessage, setSyncMessage] = useState("Live coordinator channel ready.");
  const [ambulances, setAmbulances] = useState(ambulanceSeed);
  const [workers, setWorkers] = useState(workforceSeed);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState("AMB-104");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState([]);
  const [selectedShelterId, setSelectedShelterId] = useState(shelterTargets[0].id);
  const [selectedStagingPointId, setSelectedStagingPointId] = useState(stagingPoints[0].id);
  const [activeTab, setActiveTab] = useState("operations");
  const [unseenInbox, setUnseenInbox] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [busyRequestId, setBusyRequestId] = useState("");
  const seenInboxIdsRef = useRef(null);
  const syncMessageTimerRef = useRef(null);

  // Action feedback ("Water selected...", "Task update queued...") is
  // transient — show it for a few seconds, then fall back to the idle
  // status so the header never displays stale text.
  useEffect(() => {
    if (syncMessage === "Live coordinator channel ready.") {
      return undefined;
    }
    window.clearTimeout(syncMessageTimerRef.current);
    syncMessageTimerRef.current = window.setTimeout(() => {
      setSyncMessage("Live coordinator channel ready.");
    }, 6000);
    return () => window.clearTimeout(syncMessageTimerRef.current);
  }, [syncMessage]);
  const [operationLog, setOperationLog] = useState([
    {
      id: "log-standby",
      time: new Date().toISOString(),
      title: "Resource desk online",
      detail: "Ambulance and worker rosters loaded for coordinator actions.",
      tone: "info"
    }
  ]);

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

  // Watch the inbox between polls: badge the Incoming tab and raise a toast
  // whenever a request arrives, so nothing lands silently below the fold.
  useEffect(() => {
    const inbox = data?.inbox || [];

    if (seenInboxIdsRef.current === null) {
      seenInboxIdsRef.current = new Set(inbox.map((item) => item.id));
      return;
    }

    const fresh = inbox.filter((item) => !seenInboxIdsRef.current.has(item.id));
    if (!fresh.length) {
      return;
    }

    for (const item of fresh) {
      seenInboxIdsRef.current.add(item.id);
    }

    if (activeTab !== "intake") {
      setUnseenInbox((count) => count + fresh.length);
    }

    setToasts((current) =>
      [
        ...fresh.map((item) => ({
          id: `toast-${item.id}`,
          title: item.title || "Incoming request",
          message: item.message || "",
          severity: item.severity || "medium",
          transport: item.transport || "mesh"
        })),
        ...current
      ].slice(0, 3)
    );

    for (const item of fresh) {
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== `toast-${item.id}`));
      }, 7000);
    }
  }, [data, activeTab]);

  const operationEvents = useMemo(() => {
    if (!data) {
      return [];
    }

    const region = data.identity?.region || "Regional command zone";
    const inboxEvents = (data.inbox || []).map((item) => normalizeOperationEvent(item, region));
    const incidentEvents = (data.incidents || []).map((incident) =>
      normalizeOperationEvent(incident, region, "incident")
    );

    return [...inboxEvents, ...incidentEvents];
  }, [data]);

  const selectedEvent = useMemo(() => {
    return operationEvents.find((event) => event.id === selectedEventId) || operationEvents[0] || null;
  }, [operationEvents, selectedEventId]);

  useEffect(() => {
    if (operationEvents.length && !operationEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(operationEvents[0].id);
    }
  }, [operationEvents, selectedEventId]);

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

  async function handleInboxAction(item, status) {
    setBusyRequestId(item.id);
    try {
      const result = await updateInboxRequest(item.id, status);
      setData((current) => ({
        ...current,
        inbox: result.data.inbox,
        history: result.data.history
      }));
      setSyncMessage(result.message);
    } catch (nextError) {
      setSyncMessage(nextError.message);
    } finally {
      setBusyRequestId("");
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

  function appendOperationLog(entry) {
    setOperationLog((current) =>
      [
        {
          id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: new Date().toISOString(),
          tone: "info",
          ...entry
        },
        ...current
      ].slice(0, 7)
    );
  }

  async function adjustCoordinatorField(fieldIds, delta) {
    if (!data) {
      return;
    }

    const field = data.fields.find((item) => fieldIds.includes(item.id));
    if (!field) {
      return;
    }

    const currentValue = Number(field.value);
    if (!Number.isFinite(currentValue)) {
      return;
    }

    const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
    const max = Number.isFinite(Number(field.max)) ? Number(field.max) : Number.MAX_SAFE_INTEGER;
    const nextValue = Math.min(max, Math.max(min, currentValue + delta));

    if (nextValue !== currentValue) {
      await handleFieldChange(field.id, nextValue);
    }
  }

  async function handleDispatchAmbulance() {
    const target = selectedEvent;
    const ambulance = ambulances.find((item) => item.id === selectedAmbulanceId);

    if (!target || !ambulance || ambulance.status !== "ready") {
      setSyncMessage("Select a ready ambulance and active target.");
      return;
    }

    setAmbulances((current) =>
      current.map((item) =>
        item.id === ambulance.id
          ? {
              ...item,
              status: "dispatched",
              location: target.location,
              assignedTo: target.title
            }
          : item
      )
    );

    const nextReady = ambulances.find((item) => item.id !== ambulance.id && item.status === "ready");
    setSelectedAmbulanceId(nextReady?.id || "");
    appendOperationLog({
      title: `${ambulance.id} dispatched`,
      detail: `${target.title} | ${target.location}`,
      tone: target.severity === "critical" || target.severity === "high" ? "urgent" : "info"
    });
    setSyncMessage(`${ambulance.id} assigned to ${target.location}. Ambulance availability reduced.`);
    await adjustCoordinatorField(["ambulancesReady"], -1);
  }

  function handleToggleWorker(workerId) {
    const worker = workers.find((item) => item.id === workerId);
    if (!worker || worker.status !== "available") {
      return;
    }

    setSelectedWorkerIds((current) =>
      current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId]
    );
  }

  async function handleAssignWorkers() {
    const selectedShelter =
      shelterTargets.find((target) => target.id === selectedShelterId) || shelterTargets[0];
    const selectedPoint =
      stagingPoints.find((point) => point.id === selectedStagingPointId) || stagingPoints[0];
    const pickedWorkers = workers.filter(
      (worker) => selectedWorkerIds.includes(worker.id) && worker.status === "available"
    );

    if (!pickedWorkers.length) {
      setSyncMessage("Select available workers before assigning shelter support.");
      return;
    }

    setWorkers((current) =>
      current.map((worker) =>
        selectedWorkerIds.includes(worker.id) && worker.status === "available"
          ? {
              ...worker,
              status: "assigned",
              assignedTo: selectedShelter.label,
              destination: selectedPoint.label
            }
          : worker
      )
    );
    setSelectedWorkerIds([]);
    appendOperationLog({
      title: `${pickedWorkers.length} worker(s) assigned`,
      detail: `${selectedShelter.label} via ${selectedPoint.label}`,
      tone: "success"
    });
    setSyncMessage(`${pickedWorkers.length} worker(s) sent to ${selectedShelter.label}.`);
    await adjustCoordinatorField(["volunteersAvailable"], -pickedWorkers.length);
    await adjustCoordinatorField(["pendingAssignments"], -pickedWorkers.length);
  }

  function handleSelectEvent(event) {
    setSelectedEventId(event.id);
    setSyncMessage(`${event.title} selected for resource assignment.`);
  }

  function handleSelectIncident(incident) {
    const region = data?.identity?.region || "Regional command zone";
    handleSelectEvent(normalizeOperationEvent(incident, region, "incident"));
  }

  const RoleIcon = useMemo(() => {
    return roleIcons[data?.role?.id] || FiActivity;
  }, [data?.role?.id]);

  const shortageFields = useMemo(
    () => (data?.fields || []).filter((field) => field.shortageLevel),
    [data?.fields]
  );

  function openTab(tabId) {
    setActiveTab(tabId);
    if (tabId === "intake") {
      setUnseenInbox(0);
    }
  }

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
          <span className="logo-mark">
            <img src={sanjeevaniLogo} alt="SANJEEVANI" />
          </span>
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
          <div className="command-kpis">
            <span>
              <FiDatabase aria-hidden="true" />
              Queue {data.syncQueueCount || 0}
            </span>
            <span>
              <FiMapPin aria-hidden="true" />
              {(data.coverageNodes || []).length || 1} zones
            </span>
          </div>
          <div className="sync-pill">
            <FiCloud aria-hidden="true" />
            <span>{syncMessage}</span>
          </div>
          <button className="icon-action" type="button" onClick={handleManualSync} title="Sync now">
            <FiRefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="Coordinator sections">
        <button
          className={classNames("tab-button", activeTab === "operations" && "active")}
          type="button"
          onClick={() => openTab("operations")}
        >
          <FiTruck aria-hidden="true" />
          Operations
        </button>
        <button
          className={classNames("tab-button", activeTab === "intake" && "active")}
          type="button"
          onClick={() => openTab("intake")}
        >
          <FiInbox aria-hidden="true" />
          Incoming requests
          <em className="tab-count">{data.inbox.length}</em>
          {unseenInbox > 0 ? <b className="tab-badge">{unseenInbox} new</b> : null}
        </button>
        <button
          className={classNames("tab-button", activeTab === "resources" && "active")}
          type="button"
          onClick={() => openTab("resources")}
        >
          <FiDatabase aria-hidden="true" />
          Resources &amp; network
          {shortageFields.length > 0 ? <b className="tab-badge warning">{shortageFields.length}</b> : null}
        </button>
        <button
          className={classNames("tab-button", activeTab === "history" && "active")}
          type="button"
          onClick={() => openTab("history")}
        >
          <FiClock aria-hidden="true" />
          Past history
          <em className="tab-count">{(data.history || []).length}</em>
        </button>
      </nav>

      {shortageFields.length > 0 ? (
        <button className="shortage-banner" type="button" onClick={() => openTab("resources")}>
          <FiAlertTriangle aria-hidden="true" />
          <span>
            {shortageFields.map((field) => field.label).join(", ")}{" "}
            {shortageFields.length === 1 ? "is" : "are"} low or out of stock — Command Center notified so new
            requests can be rerouted.
          </span>
        </button>
      ) : null}

      {(data.hazardUpdates || []).length > 0 ? (
        <section className="hazard-strip">
          <strong>Hazard updates</strong>
          {(data.hazardUpdates || []).slice(0, 4).map((item) => (
            <span className={classNames("hazard-chip", item.severity)} key={item.id}>
              {item.title}: {item.message}
            </span>
          ))}
        </section>
      ) : null}

      {activeTab === "operations" ? (
        <>
          <DashboardSpecialist data={data} />

          <OperationsBoard
            ambulanceRoster={ambulances}
            events={operationEvents}
            operationLog={operationLog}
            selectedAmbulanceId={selectedAmbulanceId}
            selectedEvent={selectedEvent}
            selectedEventId={selectedEventId}
            selectedShelterId={selectedShelterId}
            selectedStagingPointId={selectedStagingPointId}
            selectedWorkerIds={selectedWorkerIds}
            workerRoster={workers}
            onAssignWorkers={handleAssignWorkers}
            onDispatchAmbulance={handleDispatchAmbulance}
            onSelectAmbulance={setSelectedAmbulanceId}
            onSelectEvent={handleSelectEvent}
            onSelectShelter={setSelectedShelterId}
            onSelectStagingPoint={setSelectedStagingPointId}
            onToggleWorker={handleToggleWorker}
          />
        </>
      ) : null}

      {activeTab === "intake" ? (
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
                data.inbox.map((item) => (
                  <FeedItem
                    busy={busyRequestId === item.id}
                    item={item}
                    key={item.id}
                    selected={selectedEventId === item.id}
                    onAction={handleInboxAction}
                    onSelect={handleSelectEvent}
                  />
                ))
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
            <IncidentList
              incidents={data.incidents}
              selectedEventId={selectedEventId}
              onSelectIncident={handleSelectIncident}
            />
          </div>
        </section>
      ) : null}

      {activeTab === "resources" ? (
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
      ) : null}

      {activeTab === "history" ? (
        <section className="panel history-panel">
          <div className="panel-heading">
            <span className="section-icon" aria-hidden="true">
              <FiClock />
            </span>
            <div>
              <p>Past History</p>
              <h2>Handled requests — reported to Command Center</h2>
            </div>
          </div>
          <HistoryList history={data.history || []} />
        </section>
      ) : null}

      {toasts.length > 0 ? (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <button
              className={classNames("toast", toast.severity)}
              key={toast.id}
              type="button"
              onClick={() => {
                openTab("intake");
                setToasts((current) => current.filter((item) => item.id !== toast.id));
              }}
            >
              <strong>
                <FiInbox aria-hidden="true" />
                {toast.title}
              </strong>
              <span>{toast.message}</span>
              <small>via {toast.transport} — click to open</small>
            </button>
          ))}
        </div>
      ) : null}
    </main>
  );
}
