import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Database,
  Droplets,
  Gauge,
  HeartPulse,
  Home,
  LifeBuoy,
  MapPin,
  Network,
  RadioTower,
  Search,
  Shield,
  Siren,
  Satellite,
  TrendingUp,
  Users,
  Waves,
  Wifi,
  WifiOff,
  Wrench,
  Zap
} from "lucide-react";

const navItems = [
  { path: "/dashboard", label: "Dashboard", Icon: Boxes },
  { path: "/requests", label: "Requests", Icon: ClipboardList, badge: "requests" },
  { path: "/pods", label: "Pods", Icon: RadioTower },
  { path: "/network", label: "Network", Icon: Network },
  { path: "/sensors", label: "Sensors", Icon: Activity },
  { path: "/resources", label: "Resources", Icon: Home },
  { path: "/volunteers", label: "Volunteers", Icon: Users },
  { path: "/alerts", label: "Alerts", Icon: Bell, badge: "alerts" }
];

const dummyLocations = [
  "Varuna Hills Zone 1",
  "Kothapalli Zone 3",
  "Mangalagiri Zone 2",
  "Nandigama Relief Hub",
  "Budameru River Basin",
  "Shelter Camp B",
  "Pod 03 Medical Camp",
  "Zone 2 SAR Route"
];

const dummyResources = [
  "Water stock 18450 litres",
  "Medical kits 324",
  "Shelter capacity 1250",
  "Active volunteers 128",
  "Insulin stock low",
  "Boat routing flood rescue"
];

const metricAssets = {
  activeRequests: "/assets/alert.png",
  criticalCases: ["/assets/critical.png", "/assets/critical.ong"],
  podsOnline: "/assets/cell_tower.png",
  currentMode: "/assets/mode.png"
};

const networkAssets = {
  satellite: "/assets/satellite.png",
  cellTower: "/assets/cell_tower.png",
  wifi: "/assets/wifi.png",
  noWifi: "/assets/nowifi.png"
};

async function api(path, opts) {
  const response = await fetch(path, opts);
  return response.json();
}

function useHashRoute() {
  const [route, setRouteState] = useState(() => location.hash.replace("#", "") || "/dashboard");

  useEffect(() => {
    const onHashChange = () => setRouteState(location.hash.replace("#", "") || "/dashboard");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = (nextRoute) => {
    location.hash = nextRoute;
    setRouteState(nextRoute);
  };

  return [route, setRoute];
}

function isCitizenRequest(request) {
  return request && request.category !== "EARLY-WARNING" && request.category !== "SECURITY";
}

function upsertById(list, item) {
  if (!item?.id) return list || [];
  const next = [...(list || [])];
  const index = next.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...item };
  } else {
    next.unshift(item);
  }
  return next;
}

function removeById(list, id) {
  return (list || []).filter((item) => item.id !== id);
}

function ago(iso) {
  if (!iso) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function cap(text) {
  return String(text || "Other")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function severity(request) {
  return Number(request?.triage?.severity || request?.severity || 0);
}

function requestTimeMs(request) {
  const value = request?.cloudReceivedAt || request?.createdAt || request?.receivedAt || request?.timestamp;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function isLastHour(request) {
  const ms = requestTimeMs(request);
  return ms > 0 && Date.now() - ms <= 60 * 60 * 1000;
}

function isCriticalRequest(request) {
  if (request?.isCritical === true || String(request?.criticality || "").toLowerCase() === "critical") {
    return true;
  }
  return severity(request) >= 8;
}

function fallbackSensorReadings() {
  const now = Date.now();
  return [
    {
      id: "sensor-water-budameru-01",
      label: "Budameru River Gauge",
      type: "water-level",
      value: 6.24,
      unit: "m",
      deltaLabel: "+0.38 m past 1h",
      status: "critical",
      locationName: "Budameru River Bridge",
      zone: "Zone 1",
      lastReadingAt: new Date(now - 90000).toISOString(),
      history: [4.82, 4.95, 5.18, 5.31, 5.55, 5.72, 5.98, 6.08, 6.24]
    },
    {
      id: "sensor-risk-budameru-01",
      label: "Flood Risk Index",
      type: "flood-risk",
      value: 0.82,
      unit: "score",
      deltaLabel: "+0.07 past 1h",
      status: "critical",
      locationName: "Varuna Hills Zone 1",
      zone: "Zone 1",
      lastReadingAt: new Date(now - 90000).toISOString(),
      history: [0.48, 0.52, 0.57, 0.61, 0.66, 0.72, 0.78, 0.8, 0.82]
    },
    {
      id: "sensor-rainfall-zone-1",
      label: "Rainfall Intensity",
      type: "rainfall",
      value: 42,
      unit: "mm/hr",
      deltaLabel: "+11 mm/hr past 1h",
      status: "warning",
      locationName: "Varuna Hills Ridge",
      zone: "Zone 1",
      lastReadingAt: new Date(now - 180000).toISOString(),
      history: [18, 21, 24, 28, 31, 35, 38, 40, 42]
    },
    {
      id: "sensor-soil-varuna-02",
      label: "Soil Saturation",
      type: "soil-moisture",
      value: 82,
      unit: "%",
      deltaLabel: "+6% past 1h",
      status: "warning",
      locationName: "Varuna Hills Slope",
      zone: "Zone 1",
      lastReadingAt: new Date(now - 240000).toISOString(),
      history: [63, 65, 68, 70, 73, 76, 78, 80, 82]
    }
  ];
}

function sensorTimeMs(sensor) {
  const value = sensor?.lastReadingAt || sensor?.sampledAt || sensor?.timestamp;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function sensorReadingsForOverview(overview, useFallback = true) {
  const readings = overview?.sensorReadings?.length ? overview.sensorReadings : useFallback ? fallbackSensorReadings() : [];
  return [...readings].sort((left, right) => sensorTimeMs(right) - sensorTimeMs(left));
}

function sensorValue(sensor) {
  if (!sensor) return "-";
  const raw = Number(sensor.value);
  const value = Number.isFinite(raw) && Math.abs(raw) < 100 ? raw.toFixed(raw % 1 ? 2 : 0) : sensor.value;
  return `${value}${sensor.unit && sensor.unit !== "score" ? ` ${sensor.unit}` : ""}`;
}

function sensorTone(sensor) {
  const status = String(sensor?.status || sensor?.risk || "").toLowerCase();
  if (status === "critical" || status === "danger" || status === "high") return "red";
  if (status === "warning" || status === "medium" || status === "elevated") return "orange";
  if (status === "stable" || status === "normal" || status === "low") return "teal";
  return "blue";
}

function sensorIcon(sensor) {
  const type = String(sensor?.type || "").toLowerCase();
  if (type.includes("water") || type.includes("rain")) return Droplets;
  if (type.includes("flow")) return Waves;
  if (type.includes("risk")) return Gauge;
  if (type.includes("soil")) return TrendingUp;
  return Activity;
}

function sensorPoints(sensor) {
  if (Array.isArray(sensor?.history) && sensor.history.length > 1) {
    return sensor.history.map(Number).filter(Number.isFinite);
  }
  const value = Number(sensor?.value || 0);
  return [value * 0.72, value * 0.78, value * 0.82, value * 0.9, value * 0.95, value].map((point) =>
    Number(point.toFixed(2))
  );
}

function sensorSummaryForOverview(overview, readings) {
  const summary = overview?.sensorSummary || {};
  const waterLevel = summary.waterLevel || readings.find((reading) => reading.type === "water-level") || readings[0];
  const rainfall = summary.rainfall || readings.find((reading) => reading.type === "rainfall");
  const riskReading = readings.find((reading) => reading.type === "flood-risk");
  const riskScore = Number.isFinite(Number(summary.riskScore))
    ? Number(summary.riskScore)
    : Number.isFinite(Number(riskReading?.value))
      ? Number(riskReading.value)
      : 0.82;
  const riskLabel = summary.riskLabel || (riskScore >= 0.75 ? "HIGH" : riskScore >= 0.5 ? "ELEVATED" : "NORMAL");

  return {
    ...summary,
    waterLevel,
    rainfall,
    riskScore,
    riskLabel,
    reportingSensors: summary.reportingSensors || readings.length,
    criticalCount:
      summary.criticalCount ??
      readings.filter((reading) => ["critical", "danger"].includes(String(reading.status).toLowerCase())).length,
    warningCount:
      summary.warningCount ??
      readings.filter((reading) => String(reading.status).toLowerCase() === "warning").length
  };
}

function severityLabel(request) {
  const value = severity(request);
  if (value >= 8) return "Critical";
  if (value >= 6) return "High";
  if (value >= 4) return "Medium";
  return "Low";
}

function deriveMode(infra = {}) {
  if (infra.satellite === "up") {
    return { key: "satellite", label: "SATELLITE", Icon: Satellite };
  }
  if (infra.celltower1 === "up" || infra.celltower2 === "up") {
    return { key: "cellular", label: "CELLULAR", Icon: Wifi };
  }
  return { key: "island", label: "ISLAND MODE", Icon: WifiOff };
}

function deriveNetworkHealth(overview, mode) {
  const counts = overview?.counts || {};
  const podsTotal = counts.podsTotal || 1;
  const onlineRatio = (counts.podsOnline || 0) / podsTotal;
  const queued = counts.queued || 0;

  if (mode.key === "island" || onlineRatio < 0.55) {
    return { label: "CRITICAL", tone: "danger", score: Math.round(onlineRatio * 100) };
  }
  if (queued > 0 || counts.islandPods > 0 || onlineRatio < 0.9) {
    return { label: "DEGRADED", tone: "warn", score: Math.round(onlineRatio * 100) };
  }
  return { label: "GOOD", tone: "ok", score: 98 };
}

function fallbackRequests() {
  const now = Date.now();
  return [
    {
      id: "REQ-2025-1287",
      category: "Medical",
      name: "Pregnant woman in labor",
      message: "Water entering home. Need immediate evacuation and medical assistance.",
      locationName: "Kothapalli, Zone 3",
      cloudReceivedAt: new Date(now - 120000).toISOString(),
      triage: { severity: 9, reason: "Labor pain" },
      requestTypes: ["Hospital", "Shelter"]
    },
    {
      id: "REQ-2025-1286",
      category: "Rescue",
      name: "Elderly patient breathing difficulty",
      message: "Asthma patient out of medication. Rescue transport requested.",
      locationName: "Nujacheruvu, Zone 1",
      cloudReceivedAt: new Date(now - 300000).toISOString(),
      triage: { severity: 7, reason: "Breathing issue" },
      requestTypes: ["Hospital", "Workforce"]
    },
    {
      id: "REQ-2025-1285",
      category: "Flooding",
      name: "Child with fever",
      message: "Child with high fever and rising water outside home.",
      locationName: "Mangalagiri, Zone 2",
      cloudReceivedAt: new Date(now - 480000).toISOString(),
      triage: { severity: 6, reason: "Fever" },
      requestTypes: ["Hospital", "Flood Rescue"]
    }
  ];
}

function Sparkline({ tone = "blue", points = [8, 14, 12, 20, 16, 25, 22, 31, 26, 38, 33] }) {
  const width = 116;
  const height = 50;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const coords = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / Math.max(1, max - min)) * (height - 10) - 5;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className={`spark-svg ${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={coords} />
    </svg>
  );
}

function IconTile({ Icon, tone = "blue", imageSrc, alt = "" }) {
  const imageSources = Array.isArray(imageSrc) ? imageSrc : imageSrc ? [imageSrc] : [];
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [imageSrc]);

  const activeImage = imageSources[imageIndex];

  return (
    <span className={`icon-tile ${tone} ${activeImage ? "has-image" : ""}`}>
      {activeImage ? (
        <img
          src={activeImage}
          alt={alt}
          onError={() => setImageIndex((current) => current + 1)}
        />
      ) : (
        <Icon size={24} strokeWidth={2.4} />
      )}
    </span>
  );
}

function StatusPill({ request }) {
  const label = severityLabel(request);
  return <span className={`pill ${label.toLowerCase()}`}>{label.toUpperCase()}</span>;
}

const TOP_ICON_TONE = {
  satellite: "text-brand-teal bg-[#eef9f7]",
  cellular: "text-brand-teal bg-[#eef9f7]",
  ok: "text-brand-teal bg-[#eef9f7]",
  island: "text-brand-orange bg-[#fff4ec]",
  warn: "text-brand-orange bg-[#fff4ec]",
  danger: "text-brand-red bg-[#fff1f3]"
};

function TopStat({ tone, Icon, label, value }) {
  return (
    <div className="flex min-w-[158px] items-center gap-2.5 border-r border-brand-line pr-[22px] max-[920px]:border-r-0">
      <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[13px] ${TOP_ICON_TONE[tone] || TOP_ICON_TONE.ok}`}>
        <Icon size={21} strokeWidth={2.2} />
      </span>
      <div>
        <small className="block text-[11px] font-bold uppercase leading-tight text-[#5d6d86]">{label}</small>
        <b className="mt-0.5 block text-[17px] font-extrabold uppercase leading-tight">{value}</b>
      </div>
    </div>
  );
}

function Header({ overview, search, setSearch, searchResults, setRoute }) {
  const mode = deriveMode(overview?.infra);
  const health = deriveNetworkHealth(overview, mode);

  return (
    <header className="flex min-h-[72px] items-center gap-[22px] border-b border-brand-line bg-white px-[30px] max-[920px]:h-auto max-[920px]:flex-wrap max-[920px]:px-3.5 max-[920px]:py-3.5">
      <TopStat tone="satellite" Icon={Activity} label="Pods online" value={`${overview?.counts?.podsOnline || 0} / ${overview?.counts?.podsTotal || 0}`} />
      <TopStat tone={mode.key} Icon={mode.Icon} label="Current mode" value={mode.label} />
      <TopStat tone={health.tone} Icon={Gauge} label="Network health" value={health.label} />

      <div className="relative ml-auto w-[min(440px,31vw)] max-[920px]:order-10 max-[920px]:w-full">
        <Search className="pointer-events-none absolute right-4 top-[11px] text-[#58708d]" size={22} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search pods, requests, locations..."
          className="h-11 w-full rounded-[11px] border border-[#d8e2ef] bg-white px-[18px] pr-12 text-sm text-[#334155] outline-none"
        />
        {search && (
          <div className="absolute inset-x-0 top-[60px] z-20 rounded-[10px] border border-brand-line bg-white p-2 shadow-card">
            {searchResults.length ? (
              searchResults.slice(0, 8).map((item) => (
                <button
                  className="grid w-full grid-cols-[78px_1fr] gap-x-2.5 gap-y-1 rounded-lg p-2.5 text-left hover:bg-[#f3f7fd]"
                  key={`${item.type}-${item.id}`}
                  onClick={() => setRoute(item.route)}
                >
                  <span className="row-span-2 text-xs font-extrabold uppercase text-brand-blue">{item.type}</span>
                  <b className="font-semibold">{item.title}</b>
                  <small className="text-brand-muted">{item.detail}</small>
                </button>
              ))
            ) : (
              <p className="p-2 text-sm text-brand-muted">No matches found</p>
            )}
          </div>
        )}
      </div>

      <button className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-white text-[#52677f]" aria-label="Alerts" onClick={() => setRoute("/alerts")}>
        <Bell size={23} />
        <span className="absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-red px-1 text-[10px] font-black text-white">
          {overview?.counts?.alerts || overview?.counts?.critical || 0}
        </span>
      </button>

      <div className="min-w-[128px] shrink-0 text-right">
        <b className="block text-sm">Admin User</b>
        <span className="block text-[11px] text-brand-muted">Command Center</span>
      </div>
    </header>
  );
}

function Sidebar({ route, setRoute, counts, mode }) {
  const isIsland = mode?.key === "island";
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-[radial-gradient(circle_at_25%_0%,rgba(15,140,255,0.23),transparent_30%),linear-gradient(180deg,#062246,#07182e)] px-4 py-[22px] text-[#e7f2ff] max-[920px]:w-full max-[920px]:flex-none">
      <div className="mb-7 flex items-center gap-2.5">
        <img src="/sanjeevani-logo.png" alt="SANJEEVANI" className="h-[54px] w-[54px] object-contain drop-shadow-[0_12px_16px_rgba(20,184,166,0.18)]" />
        <div>
          <h1 className="m-0 text-[22px] leading-none tracking-[0.02em] text-white">SANJEEVANI</h1>
          <small className="mt-[5px] block text-xs font-semibold text-[#3fd2d0]">Self-Healing Lifeline Network</small>
        </div>
      </div>

      <nav className="grid gap-[7px] max-[920px]:grid-cols-2">
        {navItems.map(({ path, label, Icon, badge }) => {
          const active = route === path;
          return (
            <button
              key={path}
              onClick={() => setRoute(path)}
              className={`flex min-h-[48px] items-center gap-3.5 rounded-[9px] px-3.5 text-left font-bold ${
                active ? "bg-gradient-to-br from-[#1768d8] to-[#0f63d4] text-white shadow-[0_14px_28px_rgba(23,104,216,0.28)]" : "bg-transparent text-[#d7e7f7]"
              }`}
            >
              <Icon size={21} />
              <span>{label}</span>
              {badge === "requests" && (
                <em className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand-red text-[11px] not-italic text-white">{counts.activeRequests || 0}</em>
              )}
              {badge === "alerts" && (
                <em className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand-red text-[11px] not-italic text-white">{counts.alerts || 0}</em>
              )}
            </button>
          );
        })}
      </nav>

      <section className="mt-[78px] flex min-h-[52px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#0e365f]/[0.66] px-4">
        <span className={`h-2.5 w-2.5 rounded-full ${isIsland ? "bg-[#fb923c]" : "bg-[#2dd4bf]"}`} />
        <b className="text-sm font-extrabold text-white">{isIsland ? "Island" : "Realtime"}</b>
      </section>
    </aside>
  );
}

function MetricCard({ Icon, tone, label, value, sub, points, imageSrc }) {
  const hasChart = Array.isArray(points) && points.length > 1;
  return (
    <section className={`metric-card ${hasChart ? "has-chart" : "plain-stat"} ${label === "Current Mode" ? "mode-stat" : ""}`}>
      <IconTile Icon={Icon} tone={tone} imageSrc={imageSrc} alt={`${label} diagram`} />
      <div>
        <span>{label}</span>
        <b>{value}</b>
        {sub && <small>{sub}</small>}
      </div>
      {hasChart && <Sparkline tone={tone} points={points} />}
    </section>
  );
}

function MapPanel({ title = "Pod & Shelter Locations", zones = false, onViewFullMap }) {
  return (
    <section className="panel map-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <button onClick={onViewFullMap}>View full map</button>
      </div>
      <div className={`map-canvas image-map ${zones ? "zones" : ""}`}>
        <img src="/assets/network-map.png" alt="SANJEEVANI network zone map" />
        {zones && (
          <>
            <strong className="zone z1">Zone 1</strong>
            <strong className="zone z2">Zone 2</strong>
            <strong className="zone z3">Zone 3</strong>
            <strong className="zone z4">Zone 4</strong>
          </>
        )}
      </div>
    </section>
  );
}

function RequestCard({ request, index }) {
  const label = severityLabel(request);
  const destination = request.locationName || request.location || request.podName || "Varuna Hills Zone 1";
  const requestTypes = request.requestTypes?.length
    ? request.requestTypes.slice(0, 3).join(", ")
    : cap(request.category || "Emergency");

  return (
    <article className="request-card">
      <div className="request-card-top">
        <span className={`request-rank ${label.toLowerCase()}`}>{index + 1}</span>
        <div>
          <b>{request.name || cap(request.category || "Emergency Request")}</b>
          <small>{String(request.id || "request").slice(0, 18)}</small>
        </div>
        <StatusPill request={request} />
      </div>
      <p>{request.message || request.details || "Emergency request routed to coordinators."}</p>
      <div className="request-meta-grid">
        <span><MapPin size={15} /> {destination}</span>
        <span><ClipboardList size={15} /> {requestTypes}</span>
        <span><CheckCircle2 size={15} /> {index % 2 ? "Assigned" : "In progress"}</span>
        <span><Activity size={15} /> {ago(request.cloudReceivedAt)}</span>
      </div>
    </article>
  );
}

function RecentRequests({ requests, total, setRoute }) {
  return (
    <section className="panel requests-panel recent-requests-panel">
      <div className="panel-head">
        <h3>Live Emergency Requests <span className="live-dot">Live</span></h3>
        <button onClick={() => setRoute("/requests")}>View all requests</button>
      </div>
      <div className="request-card-list">
        {requests.length ? requests.map((request, index) => <RequestCard key={request.id || index} request={request} index={index} />) : (
          <div className="empty-requests">
            <CheckCircle2 size={26} />
            <b>No active requests</b>
            <span>Incoming SOS events appear here in realtime.</span>
          </div>
        )}
      </div>
      <p className="table-note">Showing latest {requests.length} of {Math.max(requests.length, total || 0)} requests</p>
    </section>
  );
}

function NetworkQuickPanel({ overview, mode, setRoute }) {
  const infra = overview.infra || {};
  const satelliteConnected = infra.satellite === "up";
  const cellularConnected = infra.celltower1 === "up" || infra.celltower2 === "up";
  const islandActive = mode.key === "island";
  const items = [
    {
      label: "Satellite",
      Icon: Satellite,
      connected: satelliteConnected,
      value: satelliteConnected ? "Connected" : "Offline",
      tone: satelliteConnected ? "teal" : "red",
      imageSrc: satelliteConnected ? networkAssets.satellite : networkAssets.noWifi
    },
    {
      label: "Cellular Tower",
      Icon: RadioTower,
      connected: cellularConnected,
      value: cellularConnected ? "Connected" : "Offline",
      tone: cellularConnected ? "blue" : "red",
      imageSrc: cellularConnected ? networkAssets.cellTower : networkAssets.noWifi
    },
    {
      label: "Island Mode",
      Icon: WifiOff,
      connected: islandActive,
      value: islandActive ? "Yes" : "No",
      tone: islandActive ? "teal" : "violet",
      imageSrc: islandActive ? networkAssets.wifi : networkAssets.noWifi
    }
  ];

  return (
    <section className="panel network-quick-panel">
      <div className="panel-head">
        <h3>Pod Network Status</h3>
        <button onClick={() => setRoute("/network")}>View network</button>
      </div>
      <div className="network-quick-grid">
        {items.map(({ label, Icon, connected, value, tone, imageSrc }) => (
          <article className={`network-quick-card ${connected ? "connected" : "offline"}`} key={label}>
            <IconTile Icon={Icon} tone={tone} imageSrc={imageSrc} alt={`${label} status`} />
            <div>
              <b>{label}</b>
              <span><i />{value}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SensorReadingList({ readings, limit = 4 }) {
  return (
    <div className="sensor-feed-list">
      {readings.slice(0, limit).map((reading) => {
        const Icon = sensorIcon(reading);
        return (
          <article className={`sensor-feed-row ${sensorTone(reading)}`} key={reading.id || reading.sensorId}>
            <IconTile Icon={Icon} tone={sensorTone(reading)} />
            <div>
              <b>{reading.label || cap(reading.type || "Sensor")}</b>
              <small>{reading.locationName || reading.zone || "Network sensor"} · {ago(reading.lastReadingAt)}</small>
            </div>
            <strong>{sensorValue(reading)}</strong>
            <em>{cap(reading.status || reading.risk || "Normal")}</em>
          </article>
        );
      })}
    </div>
  );
}

function SensorFeedPanel({ overview, setRoute }) {
  const isLoading = overview?.isLoading && !overview?.sensorReadings?.length;
  const readings = sensorReadingsForOverview(overview, !isLoading);
  if (isLoading) {
    return (
      <section className="panel sensor-panel sensor-feed-panel">
        <div className="panel-head sensor-panel-head">
          <div>
            <h3>Early Warning - Sensor Feed</h3>
            <span className="panel-kicker"><Database size={14} /> Connecting to MongoDB feed</span>
          </div>
          <button onClick={() => setRoute("/sensors")}>View sensors</button>
        </div>
        <div className="sensor-loading">
          <Database size={24} />
          <b>Loading sensor readings</b>
          <span>Waiting for Command Center overview.</span>
        </div>
      </section>
    );
  }

  const summary = sensorSummaryForOverview(overview, readings);
  const waterLevel = summary.waterLevel;
  const riskPercent = Math.round(Math.min(1, Math.max(0, summary.riskScore || 0)) * 100);
  const sourceLabel = overview?.sensorSummary?.source === "mongodb" ? "MongoDB feed" : "Database feed";

  return (
    <section className="panel sensor-panel sensor-feed-panel">
      <div className="panel-head sensor-panel-head">
        <div>
          <h3>Early Warning - Sensor Feed</h3>
          <span className="panel-kicker"><Database size={14} /> {sourceLabel} · {summary.reportingSensors} sensors</span>
        </div>
        <button onClick={() => setRoute("/sensors")}>View sensors</button>
      </div>

      <div className="sensor-summary-grid">
        <article className="sensor-primary-card water">
          <IconTile Icon={Droplets} tone={sensorTone(waterLevel)} />
          <div>
            <span>Water Level</span>
            <b>{sensorValue(waterLevel)}</b>
            <small className={sensorTone(waterLevel)}>{waterLevel?.deltaLabel || "Reading stable"}</small>
          </div>
          <Sparkline tone={sensorTone(waterLevel)} points={sensorPoints(waterLevel)} />
        </article>

        <article className="sensor-primary-card risk">
          <IconTile Icon={Gauge} tone={summary.riskLabel === "HIGH" ? "red" : "orange"} />
          <div>
            <span>Flood Risk Index</span>
            <b>{summary.riskLabel}</b>
            <small>{summary.riskScore.toFixed(2)} / 1.00 · {summary.criticalCount} critical</small>
          </div>
          <div className="risk-meter" style={{ "--risk": `${riskPercent}%` }}>
            <span />
          </div>
        </article>
      </div>

      <SensorReadingList readings={readings} limit={3} />
    </section>
  );
}

function RequestTable({ requests }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Severity</th>
          <th>Category</th>
          <th>Location</th>
          <th>Status</th>
          <th>Sync Status</th>
          <th>Received</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request, index) => (
          <tr key={request.id || index}>
            <td><b>{String(request.id || "").slice(0, 14)}</b></td>
            <td><StatusPill request={request} /></td>
            <td><span className="category-dot">{cap(request.category).slice(0, 1)}</span>{cap(request.category)}</td>
            <td><b>{request.locationName || request.location || request.podName || "Varuna Hills Zone 1"}</b><small>Lat 17.4321 Long 78.3921</small></td>
            <td><span className="soft-pill blue">{index % 2 ? "Assigned" : "In Progress"}</span></td>
            <td><CheckCircle2 size={17} className="ok-icon" /> Synced</td>
            <td>{ago(request.cloudReceivedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildDashboardLogs(overview, requests) {
  const logs = [];
  const deliveries = overview.coordinatorDeliveries || [];
  const readings = sensorReadingsForOverview(overview, false);

  requests.forEach((request) => {
    logs.push({
      id: `request-${request.id}`,
      title: request.name || cap(request.category || "Emergency request"),
      detail: `${cap(request.category || "Request")} received at ${request.locationName || request.location || "field zone"}`,
      at: request.cloudReceivedAt || request.createdAt,
      Icon: Siren,
      tone: isCriticalRequest(request) ? "red" : "orange"
    });
  });

  deliveries.forEach((delivery) => {
    logs.push({
      id: `delivery-${delivery.id}`,
      title: `${delivery.targetCoordinatorName || "Coordinator"} ${delivery.status || "queued"}`,
      detail:
        delivery.status === "delivered"
          ? `Sent via ${delivery.deliveredVia || "network"}${delivery.deliveredLink ? ` / ${delivery.deliveredLink}` : ""}`
          : delivery.lastReason || "Waiting for satellite or matching tower",
      at: delivery.updatedAt || delivery.deliveredAt || delivery.queuedAt,
      Icon: delivery.status === "delivered" ? CheckCircle2 : WifiOff,
      tone: delivery.status === "delivered" ? "teal" : "orange"
    });
  });

  readings.forEach((reading) => {
    if (["critical", "warning", "high"].includes(String(reading.status || reading.risk || "").toLowerCase())) {
      logs.push({
        id: `sensor-${reading.id || reading.sensorId}`,
        title: `${reading.label || cap(reading.type || "Sensor")} ${cap(reading.status || reading.risk || "alert")}`,
        detail: `${sensorValue(reading)} at ${reading.locationName || reading.zone || "sensor zone"}`,
        at: reading.lastReadingAt,
        Icon: sensorIcon(reading),
        tone: sensorTone(reading)
      });
    }
  });

  (overview.alerts || []).forEach((alert) => {
    logs.push({
      id: `alert-${alert.id}`,
      title: `${cap(alert.hazard || "Alert")} broadcast`,
      detail: alert.message || "Signed alert sent across the network",
      at: alert.issuedAt,
      Icon: AlertTriangle,
      tone: "red"
    });
  });

  const infra = overview.infra || {};
  logs.push({
    id: "infra-mode",
    title: `Network mode: ${deriveMode(infra).label}`,
    detail:
      infra.satellite === "up"
        ? "Satellite path is carrying coordinator traffic"
        : infra.celltower1 === "up" || infra.celltower2 === "up"
          ? "Cellular fallback is active"
          : "Island mode queue is active",
    at: overview.generatedAt,
    Icon: Network,
    tone: deriveMode(infra).key === "island" ? "orange" : "teal"
  });

  return logs
    .filter((log) => log.at)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function ActivityFeed({ logs, setRoute }) {
  return (
    <section className="panel activity-panel">
      <div className="panel-head">
        <h3>Activity Feed</h3>
        <button onClick={() => setRoute("/alerts")}>Open alerts</button>
      </div>
      <div className="activity-feed-list">
        {logs.length ? logs.map(({ id, title, detail, at, Icon, tone }) => (
          <div className="activity-row" key={id}>
            <IconTile Icon={Icon} tone={tone} />
            <b>{title}</b>
            <small>{ago(at)}</small>
            <p>{detail}</p>
          </div>
        )) : (
          <div className="empty-requests">
            <CheckCircle2 size={26} />
            <b>No activity yet</b>
            <span>Requests, routes, sensors and alerts will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Dashboard({ overview, requests, setRoute }) {
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const mode = deriveMode(overview.infra);
  const displayRequests = requests.slice(0, 2);
  const activityLogs = buildDashboardLogs(overview, requests);
  const activeLastHour = overview.counts.activeRequestsLastHour ?? requests.filter(isLastHour).length;
  const criticalLastHour =
    overview.counts.criticalLastHour ?? requests.filter((request) => isLastHour(request) && isCriticalRequest(request)).length;
  const ModeIcon = mode.Icon;

  return (
    <div className="page dashboard-page">
      <div className="metric-grid">
        <MetricCard Icon={Siren} tone="red" label="Active Requests" value={activeLastHour} sub="Last 1 hour" imageSrc={metricAssets.activeRequests} />
        <MetricCard Icon={AlertTriangle} tone="orange" label="Critical Cases" value={criticalLastHour} sub="Last 1 hour" imageSrc={metricAssets.criticalCases} />
        <MetricCard Icon={RadioTower} tone="teal" label="Pods Online" value={`${overview.counts.podsOnline || 0} / ${overview.counts.podsTotal || 0}`} imageSrc={metricAssets.podsOnline} />
        <MetricCard Icon={ModeIcon} tone="violet" label="Current Mode" value={mode.label} imageSrc={metricAssets.currentMode} />
      </div>

      <div className="dashboard-grid">
        <RecentRequests requests={displayRequests} total={overview.counts.activeRequests} setRoute={setRoute} />

        <NetworkQuickPanel overview={overview} mode={mode} setRoute={setRoute} />

        <SensorFeedPanel overview={overview} setRoute={setRoute} />

        <MapPanel onViewFullMap={() => setFullMapOpen(true)} />

        <ActivityFeed logs={activityLogs} setRoute={setRoute} />
      </div>

      {fullMapOpen && (
        <div className="map-modal-backdrop" role="dialog" aria-modal="true">
          <section className="map-modal">
            <div className="panel-head">
              <h3>Pod & Shelter Locations</h3>
              <button onClick={() => setFullMapOpen(false)}>Close</button>
            </div>
            <div className="full-map-canvas">
              <img src="/assets/network-map.png" alt="SANJEEVANI full pod and shelter map" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const requestFilters = [
  { key: "all", label: "All", Icon: ClipboardList },
  { key: "medical", label: "Medical", Icon: HeartPulse },
  { key: "rescue", label: "Rescue", Icon: LifeBuoy },
  { key: "supplies", label: "Supplies", Icon: Droplets },
  { key: "shelter", label: "Shelter", Icon: Home }
];

function requestFilterKey(request) {
  const category = String(request.category || "").toLowerCase();
  if (/(medical|health|hospital)/.test(category)) return "medical";
  if (/(rescue|flood)/.test(category)) return "rescue";
  if (/(suppl|food|water|ration)/.test(category)) return "supplies";
  if (/shelter/.test(category)) return "shelter";

  const text = [
    request.category,
    request.name,
    request.message,
    request.triage?.reason,
    ...(request.requestTypes || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(medical|hospital|ambulance|doctor|medicine|oxygen|pregnant|breathing|patient)/.test(text)) {
    return "medical";
  }
  if (/(rescue|flood|boat|stranded|roof|evacuat|river|water rising)/.test(text)) {
    return "rescue";
  }
  if (/(suppl|food|water|blanket|ration|packet|delivery|dispatch|shortage)/.test(text)) {
    return "supplies";
  }
  if (/(shelter|camp|stay|safe stay|tent|transfer)/.test(text)) {
    return "shelter";
  }
  return "all";
}

function deliveryForRequest(deliveries, request) {
  const requestDeliveries = deliveries.filter((delivery) => delivery.requestId === request.id);
  if (requestDeliveries.length) {
    return requestDeliveries;
  }

  return (request.routing?.targets || []).map((target) => ({
    id: `${request.id}:${target.id}`,
    requestId: request.id,
    targetCoordinatorName: target.name,
    targetRole: target.role,
    status: "planned",
    attempts: []
  }));
}

function routeLabelsForTarget(target) {
  const towerLabels = Array.isArray(target?.towers) && target.towers.length ? target.towers : [];
  return ["Satellite", ...towerLabels].join(" + ");
}

function deliveryRoute(delivery) {
  if (delivery.deliveredVia) {
    return `${cap(delivery.deliveredVia)}${delivery.deliveredLink ? ` / ${delivery.deliveredLink}` : ""}`;
  }

  const latest = Array.isArray(delivery.attempts) ? delivery.attempts[delivery.attempts.length - 1] : null;
  if (latest?.transport || latest?.linkName) {
    return `${cap(latest.transport || "route")} ${latest.linkName ? `/ ${latest.linkName}` : ""}`.trim();
  }

  return delivery.status === "queued" ? "Command Center queue" : "Satellite + matching tower";
}

function deliveryTransport(delivery) {
  const latest = Array.isArray(delivery.attempts) ? delivery.attempts[delivery.attempts.length - 1] : null;
  if (delivery.deliveredVia || delivery.deliveredLink) {
    return deliveryRoute(delivery);
  }
  return latest?.transport || latest?.linkName || (delivery.status === "queued" ? "waiting for link" : "auto");
}

function deliveryReason(delivery) {
  const latest = Array.isArray(delivery.attempts) ? delivery.attempts[delivery.attempts.length - 1] : null;
  return delivery.lastReason || latest?.reason || (delivery.status === "queued" ? "Stored locally until satellite or matching cell tower is online." : "");
}

function RequestsPage({ requests, deliveries, deleteRequest, retryDeliveries, focusRequestId, onRequestSeen }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const sortedRequests = [...requests].sort((left, right) => requestTimeMs(right) - requestTimeMs(left));
  const filterCounts = requestFilters.reduce((counts, filter) => {
    counts[filter.key] =
      filter.key === "all"
        ? sortedRequests.length
        : sortedRequests.filter((request) => requestFilterKey(request) === filter.key).length;
    return counts;
  }, {});
  const shown =
    activeFilter === "all"
      ? sortedRequests
      : sortedRequests.filter((request) => requestFilterKey(request) === activeFilter);

  useEffect(() => {
    if (!focusRequestId) return;
    setActiveFilter("all");
    const scrollTimer = setTimeout(() => {
      const target = document.getElementById(`request-${focusRequestId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("focus-pulse");
        setTimeout(() => target.classList.remove("focus-pulse"), 1800);
      }
      onRequestSeen?.(focusRequestId);
    }, 80);

    return () => clearTimeout(scrollTimer);
  }, [focusRequestId, onRequestSeen]);

  return (
    <div className="page requests-only-page">
      <section className="panel requests-workbench">
        <div className="request-toolbar">
          <button className="ghost-button" onClick={retryDeliveries}>Retry queued deliveries</button>
        </div>
        <div className="request-filter-bar">
          {requestFilters.map(({ key, label, Icon }) => (
            <button
              className={activeFilter === key ? "active" : ""}
              key={key}
              onClick={() => setActiveFilter(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              <b>{filterCounts[key] || 0}</b>
            </button>
          ))}
        </div>

        <div className="request-board">
          {shown.length ? shown.map((request) => {
            const requestDeliveries = deliveryForRequest(deliveries, request);
            const delivered = requestDeliveries.filter((delivery) => delivery.status === "delivered").length;
            const total = requestDeliveries.length;
            const classification = request.routing?.classification;
            const departmentLabels = classification?.departments?.map((item) => item.label) || request.requestTypes || [];
            const targets = request.routing?.targets || [];

            return (
              <article className="request-detail-card" id={`request-${request.id}`} key={request.id}>
                <header>
                  <div>
                    <span className="req-id">{String(request.id || "").slice(0, 22)}</span>
                    <h3>{request.name || cap(request.category || "Emergency Request")}</h3>
                    <p>{request.message || "Emergency request routed to coordinators."}</p>
                  </div>
                  <StatusPill request={request} />
                </header>

                <div className="request-detail-grid">
                  <div><span>Filter Type</span><b>{cap(requestFilterKey(request))}</b></div>
                  <div><span>Location</span><b>{request.locationName || request.location || "Varuna Hills"}</b></div>
                  <div><span>Departments</span><b>{departmentLabels.join(", ") || "Auto triage"}</b></div>
                  <div><span>Coordinator Delivery</span><b>{delivered} / {total || 0} sent</b></div>
                </div>

                <div className="routing-summary">
                  <div>
                    <span>Routing logic</span>
                    <b>{classification?.summary || request.triage?.reason || "Classified from category and emergency text"}</b>
                    <small>Satellite first, then matching cellular tower, otherwise stored at Command Center queue.</small>
                  </div>
                  <div>
                    <span>Target coordinators</span>
                    <b>{targets.map((target) => target.name).join(", ") || "Waiting for backend route"}</b>
                    <small>{targets.length ? "Matched from department rules and tower coverage." : "Route will appear when the request is classified."}</small>
                  </div>
                </div>

                <div className="coordinator-status-list">
                  {requestDeliveries.length ? requestDeliveries.map((delivery) => {
                    const target = targets.find((item) => item.id === delivery.targetCoordinatorId) || {};
                    return (
                      <span className={`coordinator-chip ${delivery.status}`} key={delivery.id}>
                        <b>{delivery.targetCoordinatorName || delivery.targetCoordinatorId}</b>
                        <em>{delivery.status || "planned"}</em>
                        <small>{deliveryTransport(delivery)}</small>
                        <i>{routeLabelsForTarget({ towers: delivery.targetTowers || target.towers })}</i>
                        {deliveryReason(delivery) ? <strong>{deliveryReason(delivery)}</strong> : null}
                      </span>
                    );
                  }) : (
                    <span className="coordinator-chip planned">
                      <b>Routing pending</b>
                      <em>planned</em>
                      <small>auto</small>
                    </span>
                  )}
                </div>

                <footer>
                  <span>Received {ago(request.cloudReceivedAt)}</span>
                  <button onClick={() => deleteRequest(request.id)}>Delete</button>
                </footer>
              </article>
            );
          }) : (
            <div className="empty-requests">
              <CheckCircle2 size={26} />
              <b>No requests in this filter</b>
              <span>Incoming user requests will appear here in realtime.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function podStatusTone(pod) {
  if (!pod.reachable || pod.mode === "offline") return "red";
  if (pod.mode === "island" || pod.queuedRequests > 0) return "orange";
  return "teal";
}

function PodsPage({ overview }) {
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const mode = deriveMode(overview.infra);
  const pods = overview.pods?.length ? overview.pods : Array.from({ length: overview.counts.podsTotal || 10 }, (_, index) => ({
    podId: `POD-${String(index + 1).padStart(2, "0")}`,
    podName: `Pod ${index + 1}`,
    reachable: index < (overview.counts.podsOnline || 0),
    mode: mode.key === "island" ? "island" : "cloud",
    activePath: mode.key,
    queuedRequests: 0,
    hazardAlertCount: 0
  }));
  const onlinePods = pods.filter((pod) => pod.reachable && pod.mode !== "offline").length;
  const islandPods = pods.filter((pod) => pod.mode === "island").length;
  const queuedPods = pods.reduce((sum, pod) => sum + Number(pod.queuedRequests || 0), 0);

  return (
    <div className="page pods-page">
      <div className="page-head">
        <div>
          <h2>Pods</h2>
          <p>Live pod status, active network path, queue state, and zone coverage.</p>
        </div>
        <span className="live-dot">Live</span>
      </div>

      <div className="pod-summary-grid">
        <MetricCard Icon={RadioTower} tone="teal" label="Pods Online" value={`${onlinePods} / ${pods.length}`} imageSrc={metricAssets.podsOnline} />
        <MetricCard Icon={mode.Icon} tone={mode.key === "island" ? "orange" : "blue"} label="Active Path" value={mode.label} imageSrc={mode.key === "island" ? networkAssets.noWifi : networkAssets.satellite} />
        <MetricCard Icon={WifiOff} tone="violet" label="Island Pods" value={islandPods} />
        <MetricCard Icon={ClipboardList} tone="orange" label="Queued SOS" value={queuedPods} />
      </div>

      <div className="pods-layout">
        <section className="panel pods-list-panel">
          <div className="panel-head">
            <h3>Pod Information</h3>
            <span>{pods.length} pods registered</span>
          </div>
          <div className="pod-card-grid">
            {pods.map((pod) => {
              const tone = podStatusTone(pod);
              const activePath = pod.activePath || (pod.satelliteStatus === "up" ? "satellite" : pod.cellularStatus === "up" ? "cellular" : "island");
              return (
                <article className={`pod-info-card ${tone}`} key={pod.podId}>
                  <IconTile Icon={RadioTower} tone={tone} imageSrc={tone === "red" ? networkAssets.noWifi : networkAssets.cellTower} alt={`${pod.podId} status`} />
                  <div>
                    <b>{pod.podId}</b>
                    <span>{pod.podName || "Field Pod"}</span>
                  </div>
                  <em>{pod.reachable ? cap(pod.mode || "online") : "Offline"}</em>
                  <p><span>Active path</span><strong>{cap(activePath)}</strong></p>
                  <p><span>Cell tower</span><strong>{pod.activeCellTower || "Auto"}</strong></p>
                  <p><span>Queued SOS</span><strong>{pod.queuedRequests || 0}</strong></p>
                  <p><span>Alerts</span><strong>{pod.hazardAlertCount || 0}</strong></p>
                </article>
              );
            })}
          </div>
        </section>

        <MapPanel title="Pod Network Map" onViewFullMap={() => setFullMapOpen(true)} />
      </div>

      {fullMapOpen && (
        <div className="map-modal-backdrop" role="dialog" aria-modal="true">
          <section className="map-modal">
            <div className="panel-head">
              <h3>Pod Network Map</h3>
              <button onClick={() => setFullMapOpen(false)}>Close</button>
            </div>
            <div className="full-map-canvas">
              <img src="/assets/network-map.png" alt="SANJEEVANI full pod network map" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function NetworkPage({ overview, infraAction, restoreAll }) {
  const infra = overview.infra || {};
  const details = infra.details || {};
  const coverage = infra.towerCoverage || {};
  const mode = deriveMode(infra);
  const pods = overview.pods || [];
  const onlinePods = pods.filter((pod) => pod.reachable && pod.mode !== "offline").length;
  const queuedRequests = pods.reduce((sum, pod) => sum + Number(pod.queuedRequests || 0), 0);
  const deliveries = overview.coordinatorDeliveries || [];
  const deliveredCount = deliveries.filter((delivery) => delivery.status === "delivered").length;
  const queuedCount = deliveries.filter((delivery) => delivery.status === "queued").length;
  const satelliteOnline = infra.satellite === "up";
  const tower1Online = infra.celltower1 === "up";
  const tower2Online = infra.celltower2 === "up";
  const cellularOnline = tower1Online || tower2Online;
  const networkCards = [
    {
      label: "Satellite Uplink",
      status: satelliteOnline ? "Connected" : "Down",
      detail: satelliteOnline ? "Primary route to all coordinators" : "Requests use cellular or queue",
      Icon: Satellite,
      imageSrc: satelliteOnline ? networkAssets.satellite : networkAssets.noWifi,
      ok: satelliteOnline
    },
    {
      label: "Celltower 1",
      status: tower1Online ? "Connected" : "Down",
      detail: "FireDept, Hospital1, ShelterCampB",
      Icon: RadioTower,
      imageSrc: tower1Online ? networkAssets.cellTower : networkAssets.noWifi,
      ok: tower1Online
    },
    {
      label: "Celltower 2",
      status: tower2Online ? "Connected" : "Down",
      detail: "WorkForceCamp1, WorkForceCamp2, ShelterCamp2",
      Icon: RadioTower,
      imageSrc: tower2Online ? networkAssets.cellTower : networkAssets.noWifi,
      ok: tower2Online
    },
    {
      label: "Island Mode",
      status: mode.key === "island" ? "Active" : "Standby",
      detail: mode.key === "island" ? "Cloud routes are queued locally" : "Realtime delivery available",
      Icon: WifiOff,
      imageSrc: mode.key === "island" ? networkAssets.wifi : networkAssets.noWifi,
      ok: mode.key !== "island"
    }
  ];
  const routeFacts = [
    ["Active path", mode.label],
    ["Pods online", `${onlinePods} / ${overview.counts.podsTotal || pods.length || 10}`],
    ["Queued SOS", queuedRequests],
    ["Delivered coordinator routes", deliveredCount],
    ["Queued coordinator routes", queuedCount],
    ["Cellular fallback", cellularOnline ? "Available" : "Unavailable"]
  ];
  const eventRows = [
    {
      title: satelliteOnline ? "Satellite uplink carrying priority traffic" : "Satellite unavailable",
      text: satelliteOnline ? "Cloud can broadcast to every matching coordinator." : "Only reachable tower coordinators receive realtime traffic.",
      tone: satelliteOnline ? "teal" : "red"
    },
    {
      title: tower1Online ? "Celltower 1 coverage online" : "Celltower 1 coverage offline",
      text: "FireDept, Hospital1 and ShelterCampB are mapped to this tower.",
      tone: tower1Online ? "blue" : "orange"
    },
    {
      title: tower2Online ? "Celltower 2 coverage online" : "Celltower 2 coverage offline",
      text: "WorkForceCamp1, WorkForceCamp2 and ShelterCamp2 are mapped to this tower.",
      tone: tower2Online ? "blue" : "orange"
    },
    {
      title: queuedCount ? "Queued coordinator deliveries waiting" : "No coordinator backlog",
      text: queuedCount ? "Stored at Command Center until satellite or matching tower returns." : "All current coordinator routes are settled.",
      tone: queuedCount ? "orange" : "teal"
    }
  ];

  return (
    <div className="page network-map-page">
      <div className="page-head">
        <div>
          <h2>Network Map</h2>
          <p>Live connection paths, tower coverage and coordinator reachability across the zone.</p>
        </div>
        <span className="live-dot">Live</span>
      </div>

      <div className="network-map-layout">
        <section className="panel network-map-panel">
          <div className="panel-head">
            <h3>SANJEEVANI Zone Network</h3>
            <span>{mode.label}</span>
          </div>
          <div className="network-zone-map">
            <img src="/assets/network-map.png" alt="SANJEEVANI zone network map" />
            <span className={`map-signal satellite ${satelliteOnline ? "online" : "down"}`}><Satellite size={15} /> Satellite</span>
            <span className={`map-signal tower-one ${tower1Online ? "online" : "down"}`}><RadioTower size={15} /> Tower 1</span>
            <span className={`map-signal tower-two ${tower2Online ? "online" : "down"}`}><RadioTower size={15} /> Tower 2</span>
            <span className={`map-signal command ${mode.key === "island" ? "warn" : "online"}`}><Network size={15} /> Command Center</span>
          </div>
          <div className="network-map-facts">
            {routeFacts.map(([label, value]) => (
              <span key={label}>
                <small>{label}</small>
                <b>{value}</b>
              </span>
            ))}
          </div>
        </section>

        <aside className="network-map-side">
          <section className="panel">
            <div className="panel-head">
              <h3>Connection Status</h3>
              <button onClick={restoreAll}>Restore all</button>
            </div>
            <div className="network-map-card-grid">
              {networkCards.map(({ label, status: cardStatus, detail, Icon, imageSrc, ok }) => (
                <article className={`network-map-card ${ok ? "ok-card" : "bad-card"}`} key={label}>
                  <IconTile Icon={Icon} tone={ok ? "teal" : "red"} imageSrc={imageSrc} alt={`${label} status`} />
                  <div>
                    <b>{label}</b>
                    <span>{cardStatus}</span>
                    <small>{detail}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Simulator Controls</h3></div>
            <div className="sim-controls network-map-controls">
              <button onClick={() => infraAction("satellite", "fail")}>Fail Satellite</button>
              <button onClick={() => infraAction("satellite", "restore")}>Restore Satellite</button>
              <button onClick={() => infraAction("celltower-1", "fail")}>Fail Tower 1</button>
              <button onClick={() => infraAction("celltower-1", "restore")}>Restore Tower 1</button>
              <button onClick={() => infraAction("celltower-2", "fail")}>Fail Tower 2</button>
              <button onClick={() => infraAction("celltower-2", "restore")}>Restore Tower 2</button>
            </div>
          </section>
        </aside>
      </div>

      <div className="network-map-bottom">
        <section className="panel">
          <div className="panel-head"><h3>Cell Tower Coordinator Range</h3></div>
          <div className="tower-coverage-grid">
            {Object.entries(coverage).map(([towerId, coordinators]) => {
              const online = towerId === "CELLTOWER-1" ? tower1Online : tower2Online;
              return (
                <article className={`tower-coverage-card ${online ? "online" : "down"}`} key={towerId}>
                  <header>
                    <IconTile Icon={RadioTower} tone={online ? "blue" : "red"} imageSrc={online ? networkAssets.cellTower : networkAssets.noWifi} alt={`${towerId} coverage`} />
                    <div>
                      <b>{towerId}</b>
                      <span>{online ? "Realtime cellular route" : "Coverage unavailable"}</span>
                    </div>
                  </header>
                  <div>
                    {coordinators.map((coordinator) => (
                      <span key={coordinator.id}>{coordinator.name}</span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Route Decisions</h3></div>
          <div className="network-event-list">
            {eventRows.map((event) => (
              <article className={`network-event ${event.tone}`} key={event.title}>
                <IconTile Icon={event.tone === "red" ? AlertTriangle : Activity} tone={event.tone} />
                <div>
                  <b>{event.title}</b>
                  <span>{event.text}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ResourcesPage() {
  const coordinatorResources = [
    {
      name: "Hospital1",
      role: "Medical",
      zone: "Celltower 1",
      Icon: HeartPulse,
      tone: "red",
      resources: [
        ["Ambulances", 5, 8],
        ["Medical Kits", 184, 250],
        ["Oxygen Cylinders", 42, 60],
        ["Beds Ready", 31, 45]
      ]
    },
    {
      name: "FloodRescueDept",
      role: "Rescue",
      zone: "Satellite",
      Icon: LifeBuoy,
      tone: "blue",
      resources: [
        ["Rescue Boats", 7, 10],
        ["Life Jackets", 116, 160],
        ["Rope Kits", 28, 40],
        ["Portable Radios", 19, 25]
      ]
    },
    {
      name: "ShelterCampB",
      role: "Shelter",
      zone: "Celltower 1",
      Icon: Home,
      tone: "teal",
      resources: [
        ["Open Beds", 240, 420],
        ["Food Packets", 2680, 4000],
        ["Blankets", 740, 1200],
        ["Water Cans", 860, 1400]
      ]
    },
    {
      name: "WorkForceCamp1",
      role: "Workforce",
      zone: "Celltower 2",
      Icon: Users,
      tone: "violet",
      resources: [
        ["Field Workers", 38, 52],
        ["Drivers", 9, 14],
        ["Utility Trucks", 6, 9],
        ["Power Banks", 320, 800]
      ]
    }
  ];

  const workforceGroups = [
    {
      coordinator: "WorkForceCamp1",
      coverage: "Zone 1, Zone 2",
      active: 38,
      volunteers: [
        ["Rohit Sharma", "Evacuation", "Shelter transfer - Zone 1", "On Duty"],
        ["Neha Verma", "Logistics", "Food packet delivery", "On Duty"],
        ["Arjun Nair", "Search & Rescue", "Boat loading support", "Available"],
        ["Karan Patel", "Communications", "Tower relay support", "On Duty"]
      ]
    },
    {
      coordinator: "WorkForceCamp2",
      coverage: "Zone 2, Zone 3",
      active: 31,
      volunteers: [
        ["Priya Iyer", "First Aid", "Shelter Camp B", "On Break"],
        ["Meera Joshi", "Logistics", "Blanket dispatch", "Available"],
        ["Dev Kumar", "Driver", "Ambulance support route", "On Duty"],
        ["Sameer Khan", "Field Support", "Flood rescue staging", "Available"]
      ]
    }
  ];

  const totals = coordinatorResources.flatMap((group) => group.resources);
  const totalStock = totals.reduce((sum, [, current]) => sum + current, 0);
  const totalCapacity = totals.reduce((sum, [, , capacity]) => sum + capacity, 0);
  const totalVolunteers = workforceGroups.reduce((sum, group) => sum + group.active, 0);
  const avgStock = Math.round((totalStock / totalCapacity) * 100);

  return (
    <div className="page">
      <div className="page-head"><div><h2>Resources & Volunteers</h2><p>Coordinator-wise resource stock and workforce availability.</p></div><span className="live-dot">Live</span></div>
      <div className="resource-layout">
        <main>
          <div className="metric-grid compact">
            <MetricCard Icon={Boxes} tone="blue" label="Resource Groups" value={coordinatorResources.length} sub={`${avgStock}% average stock`} />
            <MetricCard Icon={HeartPulse} tone="red" label="Medical Units" value="262" sub="kits, beds, oxygen" />
            <MetricCard Icon={Home} tone="teal" label="Shelter Supplies" value="4,520" sub="beds, food, blankets" />
            <MetricCard Icon={Users} tone="violet" label="Active Workforce" value={totalVolunteers} sub="mapped to camps" />
          </div>
          <ResourceCoordinatorGrid groups={coordinatorResources} />
        </main>
        <aside>
          <WorkforceCoordinatorPanel groups={workforceGroups} />
        </aside>
      </div>
    </div>
  );
}

function ResourceCoordinatorGrid({ groups }) {
  return (
    <section className="panel resource-coordinator-panel">
      <div className="panel-head"><h3>Coordinator Resource Map</h3><span>{groups.length} coordinators</span></div>
      <div className="resource-coordinator-grid">
        {groups.map(({ name, role, zone, Icon, tone, resources }) => (
          <article className="resource-coordinator-card" key={name}>
            <header>
              <IconTile Icon={Icon} tone={tone} />
              <div><b>{name}</b><span>{role} · {zone}</span></div>
            </header>
            {resources.map(([label, current, capacity]) => {
              const percent = Math.round((current / capacity) * 100);
              return (
                <div className="resource-stock-row" key={label}>
                  <span>{label}</span>
                  <b>{current} / {capacity}</b>
                  <div className="bar"><span style={{ width: `${percent}%` }} /></div>
                  <small>{percent}%</small>
                </div>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkforceCoordinatorPanel({ groups }) {
  return (
    <section className="panel workforce-panel">
      <div className="panel-head"><h3>Workforce Coordinators</h3><span>{groups.reduce((sum, group) => sum + group.active, 0)} active</span></div>
      <div className="workforce-group-list">
        {groups.map((group) => (
          <article className="workforce-group" key={group.coordinator}>
            <header>
              <IconTile Icon={Users} tone="violet" />
              <div><b>{group.coordinator}</b><span>{group.coverage}</span></div>
              <strong>{group.active}</strong>
            </header>
            {group.volunteers.map(([name, skill, assignment, status], index) => (
              <div className="volunteer-row" key={name}>
                <span>{name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                <div><b>{name}</b><small>{skill} · {assignment}</small></div>
                <em className={status === "On Duty" ? "on" : status === "Available" ? "available" : "break"}>{status}</em>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

function SensorsPage({ overview }) {
  const readings = sensorReadingsForOverview(overview);
  const summary = sensorSummaryForOverview(overview, readings);
  const waterLevel = summary.waterLevel;
  const rainfall = summary.rainfall || readings.find((reading) => reading.type === "rainfall");

  return (
    <div className="page">
      <div className="page-head"><div><h2>Sensor Intelligence</h2><p>Flood risk, water level and safety telemetry from connected pods.</p></div><span className="live-dot">Live</span></div>
      <div className="metric-grid">
        <MetricCard Icon={Droplets} tone={sensorTone(waterLevel)} label="Water Level" value={sensorValue(waterLevel)} sub={waterLevel?.deltaLabel || "Reading stable"} points={sensorPoints(waterLevel)} />
        <MetricCard Icon={Gauge} tone={summary.riskLabel === "HIGH" ? "red" : "orange"} label="Flood Risk Index" value={summary.riskLabel} sub={`${summary.riskScore.toFixed(2)} / 1.00`} points={sensorPoints(readings.find((reading) => reading.type === "flood-risk"))} />
        <MetricCard Icon={AlertTriangle} tone="orange" label="Sensor Alerts" value={summary.criticalCount + summary.warningCount} sub={`${summary.criticalCount} critical zones`} points={[2, 3, 4, 4, 7, 6, 9, 12]} />
        <MetricCard Icon={RadioTower} tone="teal" label="Sensors Reporting" value={summary.reportingSensors} sub={overview.sensorSummary?.source === "mongodb" ? "MongoDB feed" : "Database feed"} points={sensorPoints(rainfall)} />
      </div>
      <div className="sensor-layout">
        <section className="panel sensor-detail-panel">
          <div className="panel-head"><h3>Latest Sensor Readings</h3></div>
          <SensorReadingList readings={readings} limit={readings.length} />
        </section>
        <MapPanel title="Flood Sensor Map" />
      </div>
    </div>
  );
}

function AlertsPage({ overview, broadcast, unseenRequests, onOpenRequest }) {
  const alerts = overview.alerts?.length ? overview.alerts : [{ id: "alert-1", hazard: "Flood", message: "Flood escalation in Budameru basin.", issuedAt: new Date().toISOString() }];
  const security = overview.securityEvents?.length ? overview.securityEvents : [{ id: "sec-1", message: "No forged or replayed alerts detected.", cloudReceivedAt: new Date().toISOString() }];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Alerts</h2>
          <p>Unseen requests, signed EOC broadcasts and security events across the network.</p>
        </div>
        <button className="primary-button" onClick={broadcast}>Broadcast Alert</button>
      </div>
      <div className="alert-layout alert-log-layout">
        <section className="panel">
          <div className="panel-head">
            <h3>New Request Log</h3>
            <span>{unseenRequests.length} unseen</span>
          </div>
          {unseenRequests.length ? unseenRequests.map((entry) => (
            <button className="event-row clickable-event unseen-request-event" key={entry.id} onClick={() => onOpenRequest(entry.requestId)}>
              <IconTile Icon={Siren} tone={entry.severity === "critical" ? "red" : "orange"} />
              <b>{entry.title}</b>
              <span>{ago(entry.receivedAt)}</span>
              <p>{entry.message}</p>
              <small>{entry.location}</small>
            </button>
          )) : (
            <div className="empty-requests alert-empty">
              <CheckCircle2 size={26} />
              <b>No unseen requests</b>
              <span>New incoming SOS requests will be logged here.</span>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Signed Alerts Sent</h3></div>
          {alerts.map((alert) => (
            <div className="event-row" key={alert.id}>
              <IconTile Icon={AlertTriangle} tone="red" />
              <b>{cap(alert.hazard || "alert")}</b>
              <span>{ago(alert.issuedAt)}</span>
              <p>{alert.message}</p>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Shield Security Events</h3></div>
          {security.map((event) => (
            <div className="event-row" key={event.id}>
              <IconTile Icon={Shield} tone="blue" />
              <b>Security</b>
              <span>{ago(event.cloudReceivedAt)}</span>
              <p>{event.message}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function requestLogEntry(request) {
  return {
    id: `unseen-${request.id}`,
    requestId: request.id,
    title: request.name || cap(request.category || "New emergency request"),
    message: request.message || request.details || "New request received at Command Center.",
    location: request.locationName || request.location || request.podName || "Unknown location",
    severity: severityLabel(request).toLowerCase(),
    receivedAt: request.cloudReceivedAt || request.createdAt || new Date().toISOString()
  };
}

function App() {
  const [route, setRoute] = useHashRoute();
  const [overview, setOverview] = useState(null);
  const [requests, setRequests] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [unseenRequestLogs, setUnseenRequestLogs] = useState([]);
  const [focusedRequestId, setFocusedRequestId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    api("/api/overview").then((result) => {
      if (!mounted || !result.success) return;
      setOverview(result.data);
      setRequests((result.data.requests || []).filter(isCitizenRequest));
      setDeliveries(result.data.coordinatorDeliveries || []);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const socket = io({ transports: ["websocket"] });
    socket.on("command-center:update", (event) => {
      const type = event.type || "cloud:update";
      const payload = event.payload || {};
      if (type === "request:created" || type === "request:updated" || type === "request:routed") {
        if (isCitizenRequest(payload)) {
          setRequests((current) => upsertById(current, payload));
          if (type === "request:created") {
            setUnseenRequestLogs((current) => upsertById(current, requestLogEntry(payload)).slice(0, 20));
          }
        }
      }
      if (type === "request:deleted") {
        const requestId = payload.id || payload.requestId;
        setRequests((current) => removeById(current, requestId));
        setDeliveries((current) => current.filter((delivery) => delivery.requestId !== requestId));
        setUnseenRequestLogs((current) => current.filter((entry) => entry.requestId !== requestId));
      }
      if (type === "coordinator-delivery:updated") {
        setDeliveries((current) => upsertById(current, payload));
      }
      if (type === "sensor:updated") {
        setOverview((current) => {
          if (!current) return current;
          const sensorReadings = upsertById(current.sensorReadings || [], payload);
          return {
            ...current,
            sensorReadings,
            sensorSummary: payload.summary || sensorSummaryForOverview(current, sensorReadings)
          };
        });
      }
      if (type === "alert:created") {
        setOverview((current) => current ? { ...current, alerts: upsertById(current.alerts || [], payload), counts: { ...current.counts, alerts: (current.counts.alerts || 0) + 1 } } : current);
      }
    });
    return () => socket.disconnect();
  }, []);

  const markRequestSeen = useCallback((requestId) => {
    setUnseenRequestLogs((current) => current.filter((entry) => entry.requestId !== requestId));
  }, []);

  const openRequestFromAlert = useCallback((requestId) => {
    if (!requestId) return;
    setFocusedRequestId(requestId);
    setRoute("/requests");
    markRequestSeen(requestId);
  }, [markRequestSeen, setRoute]);

  const derivedOverview = useMemo(() => {
    const base = overview || {
      isLoading: true,
      counts: { activeRequests: 0, critical: 0, podsOnline: 0, podsTotal: 0, queued: 0, alerts: 0, islandPods: 0 },
      infra: {},
      pods: [],
      alerts: [],
      earlyWarnings: [],
      securityEvents: [],
      sensorReadings: [],
      sensorSummary: null
    };
    const citizenRequests = requests.length ? requests : (base.requests || []).filter(isCitizenRequest);
    const recentRequests = citizenRequests.filter(isLastHour);
    return {
      ...base,
      isLoading: Boolean(base.isLoading),
      requests: citizenRequests.slice(0, 12),
      coordinatorDeliveries: deliveries,
      counts: {
        ...base.counts,
        activeRequests: citizenRequests.length,
        activeRequestsLastHour: recentRequests.length,
        critical: citizenRequests.filter(isCriticalRequest).length,
        criticalLastHour: recentRequests.filter(isCriticalRequest).length,
        queuedCoordinatorDeliveries: deliveries.filter((delivery) => delivery.status !== "delivered").length,
        alerts: (base.counts.alerts || 0) + unseenRequestLogs.length
      }
    };
  }, [overview, requests, deliveries, unseenRequestLogs]);

  const displayRequests = requests.length ? requests : fallbackRequests();
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const podItems = (derivedOverview.pods || []).map((pod) => ({
      id: pod.podId,
      type: "Pod",
      title: `${pod.podId} ${pod.podName || ""}`,
      detail: `${pod.mode || "unknown"} ${pod.activePath || ""}`,
      route: "/pods"
    }));
    const requestItems = displayRequests.map((request) => ({
      id: request.id,
      type: "Request",
      title: request.name || request.category || request.id,
      detail: `${request.message || ""} ${request.locationName || request.location || ""}`,
      route: "/requests"
    }));
    const sensorItems = sensorReadingsForOverview(derivedOverview, !derivedOverview.isLoading).map((sensor) => ({
      id: sensor.id,
      type: "Sensor",
      title: sensor.label || cap(sensor.type),
      detail: `${sensorValue(sensor)} ${sensor.locationName || ""} ${sensor.status || ""}`,
      route: "/sensors"
    }));
    const locationItems = dummyLocations.map((location) => ({ id: location, type: "Location", title: location, detail: "Operational map location", route: "/dashboard" }));
    const resourceItems = dummyResources.map((resource) => ({ id: resource, type: "Resource", title: resource, detail: "Relief operations data", route: "/resources" }));
    return [...podItems, ...requestItems, ...sensorItems, ...locationItems, ...resourceItems].filter((item) => `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(q));
  }, [search, derivedOverview, displayRequests]);

  const deleteRequest = async (id) => {
    if (!id) return;
    const result = await api(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (result.success) {
      setRequests((current) => removeById(current, id));
      setDeliveries((current) => current.filter((delivery) => delivery.requestId !== id));
    }
  };

  const retryDeliveries = async () => {
    await api("/api/coordinator-deliveries/retry", { method: "POST" });
  };

  const infraAction = async (target, action) => {
    await api(`/api/infra/${target}/${action}`, { method: "POST" });
    const result = await api("/api/overview");
    if (result.success) setOverview(result.data);
  };

  const restoreAll = async () => {
    await api("/api/infra/restore-all", { method: "POST" });
    const result = await api("/api/overview");
    if (result.success) setOverview(result.data);
  };

  const broadcast = async () => {
    await api("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hazard: "drill", message: "Signed EOC test alert. No action needed." })
    });
  };

  const page = () => {
    if (route === "/requests") return <RequestsPage requests={displayRequests} deliveries={deliveries} deleteRequest={deleteRequest} retryDeliveries={retryDeliveries} focusRequestId={focusedRequestId} onRequestSeen={markRequestSeen} />;
    if (route === "/pods") return <PodsPage overview={derivedOverview} />;
    if (route === "/network") return <NetworkPage overview={derivedOverview} infraAction={infraAction} restoreAll={restoreAll} />;
    if (route === "/resources" || route === "/volunteers") return <ResourcesPage />;
    if (route === "/sensors") return <SensorsPage overview={derivedOverview} />;
    if (route === "/alerts") return <AlertsPage overview={derivedOverview} broadcast={broadcast} unseenRequests={unseenRequestLogs} onOpenRequest={openRequestFromAlert} />;
    return <Dashboard overview={derivedOverview} requests={displayRequests} setRoute={setRoute} />;
  };

  return (
    <div className="flex min-h-screen max-[920px]:flex-col">
      <Sidebar route={route} setRoute={setRoute} counts={derivedOverview.counts} mode={deriveMode(derivedOverview.infra)} />
      <main className="min-w-0 flex-1">
        <Header overview={derivedOverview} search={search} setSearch={setSearch} searchResults={searchResults} setRoute={setRoute} />
        <section className="px-[34px] pb-9 pt-7">{page()}</section>
      </main>
    </div>
  );
}

export default App;
