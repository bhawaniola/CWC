import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Cloud,
  Crosshair,
  Database,
  Droplets,
  Gauge,
  HeartPulse,
  Home,
  LifeBuoy,
  MapPin,
  MapPinned,
  Network,
  Package,
  Pause,
  Plane,
  Play,
  RadioTower,
  RotateCcw,
  Router,
  Search,
  Shield,
  Siren,
  Satellite,
  Sparkles,
  TrendingUp,
  Users,
  Video,
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
  { path: "/drones", label: "Aerial Ops", Icon: Plane, badge: "drones" },
  { path: "/resources", label: "Resources", Icon: Home },
  { path: "/volunteers", label: "Volunteers", Icon: Users },
  { path: "/alerts", label: "Alerts", Icon: Bell, badge: "alerts" }
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
  if (!request) return false;
  // Coordinator lifecycle events (field updates, shortages, resolutions)
  // belong in the activity feed, not the emergency request list.
  if (String(request.requestKind || "").startsWith("coordinator-") || request.coordinatorId) return false;
  return request.category !== "EARLY-WARNING" && request.category !== "SECURITY";
}

function requestStatus(request) {
  const resolutions = Array.isArray(request?.resolutions) ? request.resolutions : [];
  if (resolutions.some((item) => item.status === "resolved")) {
    return { label: "Resolved", tone: "green" };
  }
  if (resolutions.some((item) => item.status === "acknowledged")) {
    return { label: "Acknowledged", tone: "teal" };
  }
  if ((request?.routing?.targets || []).length) {
    return { label: "Assigned", tone: "blue" };
  }
  return { label: "In Progress", tone: "blue" };
}

function isResolvedRequest(request) {
  return (Array.isArray(request?.resolutions) ? request.resolutions : []).some(
    (item) => item.status === "resolved"
  );
}

function latestResolutionAt(request) {
  return (Array.isArray(request?.resolutions) ? request.resolutions : []).reduce(
    (latest, item) => (item.at && (!latest || item.at > latest) ? item.at : latest),
    ""
  );
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

      <div
        className="relative ml-auto w-[min(440px,31vw)] max-[920px]:order-10 max-[920px]:w-full"
        onBlur={(event) => {
          // Close the dropdown when focus leaves the search area entirely.
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setSearch("");
          }
        }}
      >
        <Search className="pointer-events-none absolute right-4 top-[11px] text-[#58708d]" size={22} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearch("");
              event.currentTarget.blur();
            }
          }}
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
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setRoute(item.route);
                    setSearch("");
                  }}
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
        {(overview?.counts?.alerts || 0) > 0 && (
          <span className="absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-red px-1 text-[10px] font-black text-white">
            {overview?.counts?.alerts}
          </span>
        )}
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
              {badge === "requests" && (counts.activeRequests || 0) > 0 && (
                <em className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand-red text-[11px] not-italic text-white">{counts.activeRequests}</em>
              )}
              {badge === "alerts" && (counts.alerts || 0) > 0 && (
                <em className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand-red text-[11px] not-italic text-white">{counts.alerts}</em>
              )}
              {badge === "drones" && (counts.activeDroneMissions || 0) > 0 && (
                <em className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#3fd2d0] text-[11px] not-italic text-[#062246]">{counts.activeDroneMissions}</em>
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

// Percent positions of every painted icon on /assets/network-map.png
// (1492x1054). Keys match the live ids used by pods, coordinator
// deliveries and infra status, so map markers plug straight into the
// same data the rest of the dashboard already receives.
const MAP_NODES = {
  "POD-01": { x: 39.1, y: 11.0, kind: "pod", label: "Pod 1" },
  "POD-02": { x: 52.9, y: 9.7, kind: "pod", label: "Pod 2" },
  "POD-03": { x: 68.5, y: 9.7, kind: "pod", label: "Pod 3" },
  "POD-04": { x: 22.1, y: 42.9, kind: "pod", label: "Pod 4" },
  "POD-05": { x: 36.6, y: 41.5, kind: "pod", label: "Pod 5" },
  "POD-06": { x: 79.0, y: 42.8, kind: "pod", label: "Pod 6" },
  "POD-07": { x: 26.5, y: 75.9, kind: "pod", label: "Pod 7" },
  "POD-08": { x: 43.4, y: 84.0, kind: "pod", label: "Pod 8" },
  "POD-09": { x: 74.3, y: 73.1, kind: "pod", label: "Pod 9" },
  "POD-10": { x: 74.3, y: 89.3, kind: "pod", label: "Pod 10" },
  "FIRE-01": { x: 48.4, y: 30.6, kind: "coordinator", role: "fire", label: "Fire Dept" },
  "HOSPITAL-01": { x: 75.7, y: 22.2, kind: "coordinator", role: "hospital", label: "Hospital 1" },
  "HOSPITAL-02": { x: 22.1, y: 59.7, kind: "coordinator", role: "hospital", label: "Hospital 2" },
  "SHELTER-A": { x: 30.2, y: 22.7, kind: "coordinator", role: "shelter", label: "Shelter Camp A" },
  "SHELTER-B": { x: 64.5, y: 38.3, kind: "coordinator", role: "shelter", label: "Shelter Camp B" },
  "SHELTER-C": { x: 56.5, y: 73.3, kind: "coordinator", role: "shelter", label: "Shelter Camp C" },
  "WORKFORCE-01": { x: 36.3, y: 61.6, kind: "coordinator", role: "workforce", label: "Workforce Camp 1" },
  "WORKFORCE-02": { x: 64.1, y: 59.4, kind: "coordinator", role: "workforce", label: "Workforce Camp 2" },
  "FLOOD-01": { x: 78.0, y: 57.5, kind: "coordinator", role: "flood", label: "Flood Rescue Dept" },
  "CELLTOWER-1": { x: 52.3, y: 29.0, kind: "tower", label: "Cell Tower 1" },
  "CELLTOWER-2": { x: 46.1, y: 66.5, kind: "tower", label: "Cell Tower 2" },
  "BASE": { x: 50.9, y: 46.4, kind: "base", label: "Main Base Center" }
};

const SOS_PULSE_LIMIT = 10;
const BEAM_LIMIT = 14;

function sosSeverityColor(value) {
  if (value >= 8) return "#dc2626";
  if (value >= 6) return "#ea580c";
  if (value >= 4) return "#f59e0b";
  return "#eab308";
}

function LiveMap({ overview, requests, showLegend = true }) {
  const [failed, setFailed] = useState(false);
  const pods = overview?.pods || [];
  const deliveries = overview?.coordinatorDeliveries || [];
  const infra = overview?.infra || {};
  const podById = new Map(pods.map((pod) => [String(pod.podId || "").toUpperCase(), pod]));

  const sourceRequests = (requests && requests.length ? requests : overview?.requests) || [];
  const activeSos = sourceRequests
    .filter((request) => isCitizenRequest(request) && !isResolvedRequest(request))
    .sort((a, b) => requestTimeMs(b) - requestTimeMs(a))
    .slice(0, SOS_PULSE_LIMIT);

  const sosByPod = new Map();
  for (const request of activeSos) {
    const key = String(request.podId || "").toUpperCase();
    if (!MAP_NODES[key]) continue;
    const entry = sosByPod.get(key) || { count: 0, maxSeverity: 0 };
    entry.count += 1;
    entry.maxSeverity = Math.max(entry.maxSeverity, severity(request));
    sosByPod.set(key, entry);
  }

  const requestPodById = new Map(
    activeSos.map((request) => [request.id, String(request.podId || "").toUpperCase()])
  );
  const beams = [];
  const busyCoordinators = new Set();
  for (const delivery of deliveries) {
    if (beams.length >= BEAM_LIMIT) break;
    const from = MAP_NODES[requestPodById.get(delivery.requestId)];
    const toKey = String(
      delivery.targetCoordinatorId || delivery.coordinatorId || String(delivery.id || "").split(":")[1] || ""
    ).toUpperCase();
    const to = MAP_NODES[toKey];
    if (!from || !to) continue;
    const settled = ["delivered", "resolved"].includes(delivery.status);
    beams.push({ id: delivery.id || `${delivery.requestId}:${toKey}`, from, to, settled });
    if (!settled) busyCoordinators.add(toKey);
  }

  if (failed) {
    return (
      <div className="map-fallback">
        <MapPin size={26} />
        <b>Map is loading or unavailable</b>
        <span>Refresh the page; the zone map image will reappear.</span>
      </div>
    );
  }

  return (
    <div className="live-map-wrap">
      <div className="live-map">
        <img src="/assets/network-map.png" alt="SANJEEVANI live zone map" onError={() => setFailed(true)} />
        <svg className="live-map-beams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {beams.map((beam) => (
            <line
              key={beam.id}
              x1={beam.from.x}
              y1={beam.from.y}
              x2={beam.to.x}
              y2={beam.to.y}
              className={`beam ${beam.settled ? "settled" : "moving"}`}
            />
          ))}
        </svg>
        {Object.entries(MAP_NODES).map(([id, node]) => {
          if (node.kind === "pod") {
            const pod = podById.get(id);
            const tone = pod ? podStatusTone(pod) : "teal";
            const sos = sosByPod.get(id);
            const status = pod ? (pod.reachable ? cap(pod.mode || "online") : "Offline") : "Awaiting data";
            const queued = Number(pod?.queuedRequests || 0);
            const hint = `${node.label} — ${status}${queued ? ` · ${queued} queued SOS` : ""}${sos ? ` · ${sos.count} active SOS` : ""}`;
            return (
              <span key={id} className="live-node" style={{ left: `${node.x}%`, top: `${node.y}%` }} title={hint}>
                {sos && <i className="sos-pulse" style={{ color: sosSeverityColor(sos.maxSeverity) }} />}
                <i className={`node-ring pod ${tone}`} />
                {sos && sos.count > 1 && <b className="sos-count">{sos.count}</b>}
              </span>
            );
          }
          if (node.kind === "tower") {
            const up = (id === "CELLTOWER-1" ? infra.celltower1 : infra.celltower2) === "up";
            return (
              <span key={id} className="live-node" style={{ left: `${node.x}%`, top: `${node.y}%` }} title={`${node.label} — ${up ? "Online" : "DOWN"}`}>
                <i className={`node-ring tower ${up ? "teal" : "red"}`} />
              </span>
            );
          }
          if (node.kind === "base") {
            return (
              <span key={id} className="live-node" style={{ left: `${node.x}%`, top: `${node.y}%` }} title={`${node.label} — Command Center`}>
                <i className="node-ring base" />
              </span>
            );
          }
          const busy = busyCoordinators.has(id);
          return (
            <span key={id} className="live-node" style={{ left: `${node.x}%`, top: `${node.y}%` }} title={`${node.label}${busy ? " — receiving SOS route" : ""}`}>
              <i className={`node-ring coordinator role-${node.role} ${busy ? "busy" : ""}`} />
            </span>
          );
        })}
      </div>
      {showLegend && (
        <div className="live-map-legend">
          <span><i className="legend-dot teal" /> Online</span>
          <span><i className="legend-dot orange" /> Island / queued</span>
          <span><i className="legend-dot red" /> Offline</span>
          <span><i className="legend-dot pulse" /> Active SOS</span>
          <span><i className="legend-beam moving" /> Routing</span>
          <span><i className="legend-beam settled" /> Delivered</span>
        </div>
      )}
    </div>
  );
}

function MapPanel({ title = "Pod & Shelter Locations", onViewFullMap, overview, requests }) {
  return (
    <section className="panel map-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {onViewFullMap && <button onClick={onViewFullMap}>View full map</button>}
      </div>
      <div className="map-canvas image-map">
        <LiveMap overview={overview} requests={requests} />
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
          <small>{cap(request.category || "Emergency")} request</small>
        </div>
        <StatusPill request={request} />
      </div>
      <p>{request.message || request.details || "Emergency request routed to coordinators."}</p>
      {request.aiTriage?.status === "complete" && (
        <p className={`ai-triage-line ${request.aiTriage.upgraded ? "upgraded" : ""}`}>
          <Sparkles size={13} />
          <b>
            {request.aiTriage.upgraded
              ? `AI upgraded ${request.aiTriage.previousSeverity} → ${request.aiTriage.severity}`
              : "AI confirmed"}
          </b>
          {" — "}
          {request.aiTriage.reason}
        </p>
      )}
      <div className="request-meta-grid">
        <span><MapPin size={15} /> {destination}</span>
        <span><ClipboardList size={15} /> {requestTypes}</span>
        <span><CheckCircle2 size={15} /> {requestStatus(request).label}</span>
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
            <td><b>#{String(request.id || "").replace(/-/g, "").slice(-6).toUpperCase()}</b></td>
            <td><StatusPill request={request} /></td>
            <td><span className="category-dot">{cap(request.category).slice(0, 1)}</span>{cap(request.category)}</td>
            <td><b>{request.locationName || request.location || request.podName || "Varuna Hills Zone 1"}</b><small>Lat 17.4321 Long 78.3921</small></td>
            <td><span className={`soft-pill ${requestStatus(request).tone}`}>{requestStatus(request).label}</span></td>
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
    const settled = ["delivered", "resolved"].includes(delivery.status);
    logs.push({
      id: `delivery-${delivery.id}`,
      title: `${delivery.targetCoordinatorName || "Coordinator"} ${delivery.status || "queued"}`,
      detail:
        delivery.status === "resolved"
          ? delivery.lastReason || "Coordinator resolved this request in the field"
          : delivery.status === "delivered"
            ? `Coordinator confirmed receipt via ${delivery.deliveredVia || "network"}${delivery.deliveredLink ? ` / ${delivery.deliveredLink}` : ""}`
            : delivery.status === "rejected"
              ? delivery.lastReason || "Coordinator declined: request does not match its role"
              : delivery.lastReason || "Waiting for satellite or matching tower",
      at: delivery.updatedAt || delivery.deliveredAt || delivery.queuedAt,
      Icon: settled ? CheckCircle2 : delivery.status === "rejected" ? AlertTriangle : WifiOff,
      tone: settled ? "teal" : delivery.status === "rejected" ? "red" : "orange"
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
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    // The dashboard shows a pulse, not an archive: freshest 8, and the
    // "Open alerts" button leads to the full log.
    .slice(0, 8);
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

function SitrepPanel() {
  const [sitrep, setSitrep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    api("/api/sitrep")
      .then((result) => {
        if (mounted && result?.data?.report) setSitrep(result.data);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/sitrep", { method: "POST" });
      if (result?.success && result.data?.report) {
        setSitrep(result.data);
      } else {
        setError(result?.message || "AI model is still loading — try again in a minute.");
      }
    } catch (requestError) {
      setError("AI model unreachable — rule-based operations continue unaffected.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel sitrep-panel">
      <div className="panel-head">
        <h3><Sparkles size={16} /> AI Situation Report</h3>
        <button onClick={generate} disabled={loading}>
          {loading ? "Analyzing network…" : sitrep ? "Regenerate" : "Generate SITREP"}
        </button>
      </div>
      {error && <p className="sitrep-error">{error}</p>}
      {sitrep ? (
        <>
          <pre className="sitrep-text">{sitrep.report}</pre>
          <p className="sitrep-meta">
            {sitrep.model} · generated {ago(sitrep.generatedAt)} in {Math.round((sitrep.tookMs || 0) / 1000)}s ·
            {` ${sitrep.facts?.open ?? 0} open / ${sitrep.facts?.critical ?? 0} critical`}
          </p>
        </>
      ) : !error && (
        <div className="sitrep-empty">
          <Sparkles size={24} />
          <b>No report yet</b>
          <span>The local AI reads every open request, shortage, and sensor alert and writes a 30-second briefing. Runs fully offline inside the cluster.</span>
        </div>
      )}
    </section>
  );
}

function Dashboard({ overview, requests, setRoute }) {
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const mode = deriveMode(overview.infra);
  const displayRequests = requests.filter((request) => !isResolvedRequest(request)).slice(0, 4);
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
        <div className="dashboard-col">
          <RecentRequests requests={displayRequests} total={overview.counts.activeRequests} setRoute={setRoute} />
          <SitrepPanel />
          <SensorFeedPanel overview={overview} setRoute={setRoute} />
        </div>

        <div className="dashboard-col">
          <NetworkQuickPanel overview={overview} mode={mode} setRoute={setRoute} />
          <MapPanel onViewFullMap={() => setFullMapOpen(true)} overview={overview} requests={requests} />
          <ActivityFeed logs={activityLogs} setRoute={setRoute} />
        </div>
      </div>

      {fullMapOpen && (
        <div className="map-modal-backdrop" role="dialog" aria-modal="true">
          <section className="map-modal">
            <div className="panel-head">
              <h3>Pod & Shelter Locations</h3>
              <button onClick={() => setFullMapOpen(false)}>Close</button>
            </div>
            <div className="full-map-canvas">
              <LiveMap overview={overview} requests={requests} />
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

function RequestsPage({ requests, deliveries, deleteRequest, retryDeliveries, focusRequestId, onRequestSeen, onDroneMission }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [view, setView] = useState("active");
  // Cards open collapsed: the board reads as a scannable queue, and the
  // routing/receipt detail lives behind a per-card Details toggle.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = (id) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const sortedRequests = [...requests].sort((left, right) => requestTimeMs(right) - requestTimeMs(left));
  const openRequests = sortedRequests.filter((request) => !isResolvedRequest(request));
  const historyRequests = sortedRequests.filter(isResolvedRequest);
  const viewRequests = view === "history" ? historyRequests : openRequests;
  const filterCounts = requestFilters.reduce((counts, filter) => {
    counts[filter.key] =
      filter.key === "all"
        ? viewRequests.length
        : viewRequests.filter((request) => requestFilterKey(request) === filter.key).length;
    return counts;
  }, {});
  const shown =
    activeFilter === "all"
      ? viewRequests
      : viewRequests.filter((request) => requestFilterKey(request) === activeFilter);

  useEffect(() => {
    if (!focusRequestId) return;
    setActiveFilter("all");
    setView(
      requests.some((request) => request.id === focusRequestId && isResolvedRequest(request))
        ? "history"
        : "active"
    );
    const scrollTimer = setTimeout(() => {
      const target = document.getElementById(`request-${focusRequestId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("focus-pulse");
        setTimeout(() => target.classList.remove("focus-pulse"), 1800);
      }
      // A card someone jumped to from an alert should arrive fully open.
      setExpandedIds((prev) => new Set(prev).add(focusRequestId));
      onRequestSeen?.(focusRequestId);
    }, 80);

    return () => clearTimeout(scrollTimer);
  }, [focusRequestId, onRequestSeen]);

  return (
    <div className="page requests-only-page">
      <section className="panel requests-workbench">
        <div className="request-toolbar">
          <div className="view-switch">
            <button className={view === "active" ? "active" : ""} onClick={() => setView("active")}>
              <Siren size={16} />
              Active
              <b>{openRequests.length}</b>
            </button>
            <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
              <CheckCircle2 size={16} />
              Past history
              <b>{historyRequests.length}</b>
            </button>
          </div>
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
            const delivered = requestDeliveries.filter((delivery) =>
              ["delivered", "resolved"].includes(delivery.status)
            ).length;
            const total = requestDeliveries.length;
            const classification = request.routing?.classification;
            const departmentLabels = classification?.departments?.map((item) => item.label) || request.requestTypes || [];
            const targets = request.routing?.targets || [];

            const lifecycle = requestStatus(request);
            const expanded = expandedIds.has(request.id);

            return (
              <article
                className={`request-detail-card ${isResolvedRequest(request) ? "resolved" : ""} ${expanded ? "" : "collapsed"}`}
                id={`request-${request.id}`}
                key={request.id}
              >
                <header>
                  <div>
                    <span className="req-id">#{String(request.id || "").replace(/-/g, "").slice(-6).toUpperCase()}</span>
                    <h3>{request.name || cap(request.category || "Emergency Request")}</h3>
                    <p className={expanded ? "" : "clamped"}>{request.message || "Emergency request routed to coordinators."}</p>
                  </div>
                  <div className="request-pills">
                    <span className={`soft-pill ${lifecycle.tone}`}>{lifecycle.label}</span>
                    <StatusPill request={request} />
                  </div>
                </header>

                <div className="request-summary-line">
                  <span>
                    {cap(requestFilterKey(request))} · {request.locationName || request.location || "Varuna Hills"} ·{" "}
                    {delivered}/{total || 0} delivered · received {ago(request.cloudReceivedAt)}
                  </span>
                  <button className="details-toggle" onClick={() => toggleExpanded(request.id)}>
                    {expanded ? "Hide details" : "Details"}
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {expanded ? (
                  <>
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
                  </>
                ) : null}

                {request.routing?.saturatedRoles?.length ? (
                  <div className="saturation-note">
                    <AlertTriangle size={16} />
                    <div>
                      <b>
                        Last-resort delivery — every{" "}
                        {request.routing.saturatedRoles.join(" and ")} coordinator reported out of
                        stock
                      </b>
                      <small>
                        Delivered anyway so the case is never silent. Operator action needed:
                        restock a team or activate an external facility.
                      </small>
                    </div>
                  </div>
                ) : null}

                {request.aiTriage && (expanded || request.aiTriage.upgraded) ? (
                  <div
                    className={`ai-verdict ${
                      request.aiTriage.status === "complete"
                        ? request.aiTriage.upgraded
                          ? "upgraded"
                          : "confirmed"
                        : "unavailable"
                    }`}
                  >
                    <Sparkles size={16} />
                    {request.aiTriage.status === "complete" ? (
                      <div>
                        <b>
                          AI triage: severity {request.aiTriage.severity}
                          {request.aiTriage.upgraded
                            ? ` — upgraded from ${request.aiTriage.previousSeverity}`
                            : " — confirms rule-based verdict"}
                        </b>
                        <small>
                          {request.aiTriage.reason}
                          {request.aiTriage.roles?.length ? ` · roles: ${request.aiTriage.roles.join(", ")}` : ""}
                          {` · ${request.aiTriage.model}`}
                        </small>
                      </div>
                    ) : (
                      <div>
                        <b>Rule-based triage active</b>
                        <small>AI model unavailable — the keyword verdict stands and nothing was blocked.</small>
                      </div>
                    )}
                  </div>
                ) : null}

                {expanded ? (
                  <>
                    <div className="coordinator-status-list">
                      {requestDeliveries.length ? requestDeliveries.map((delivery) => {
                        const target = targets.find((item) => item.id === delivery.targetCoordinatorId) || {};
                        return (
                          <span className={`coordinator-chip ${delivery.status}`} key={delivery.id}>
                            <b>{delivery.targetCoordinatorName || delivery.targetCoordinatorId}</b>
                            <em>
                              {delivery.resolutionStatus === "acknowledged" && delivery.status !== "resolved"
                                ? "acknowledged"
                                : delivery.status || "planned"}
                            </em>
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

                    {!isResolvedRequest(request) ? (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#bcd9f6] bg-[#eef7ff] p-4">
                        <div>
                          <b className="block text-sm text-[#123b67]">Need an aerial view?</b>
                          <small className="text-[#5e7590]">Create a linked drone mission using this incident and pod location.</small>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-xl bg-[#1768d8] px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(23,104,216,.22)]"
                          onClick={() => onDroneMission?.(request)}
                        >
                          <Plane size={16} /> Request drone
                        </button>
                      </div>
                    ) : null}

                    <footer>
                      <span>
                        Received {ago(request.cloudReceivedAt)}
                        {request.resolutionSummary ? ` · ${request.resolutionSummary}` : ""}
                        {isResolvedRequest(request) && latestResolutionAt(request)
                          ? ` · closed ${ago(latestResolutionAt(request))}`
                          : ""}
                      </span>
                      <button onClick={() => deleteRequest(request.id)}>Delete</button>
                    </footer>
                  </>
                ) : null}
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

        <MapPanel title="Pod Network Map" onViewFullMap={() => setFullMapOpen(true)} overview={overview} />
      </div>

      {fullMapOpen && (
        <div className="map-modal-backdrop" role="dialog" aria-modal="true">
          <section className="map-modal">
            <div className="panel-head">
              <h3>Pod Network Map</h3>
              <button onClick={() => setFullMapOpen(false)}>Close</button>
            </div>
            <div className="full-map-canvas">
              <LiveMap overview={overview} />
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
            <LiveMap overview={overview} showLegend={false} />
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

const RESOURCE_ROLE_PRESENTATION = {
  hospital: { Icon: HeartPulse, tone: "red" },
  shelter: { Icon: Home, tone: "teal" },
  workforce: { Icon: Users, tone: "violet" },
  fire: { Icon: Siren, tone: "orange" },
  flood: { Icon: LifeBuoy, tone: "blue" }
};

function resourceRolePresentation(role) {
  return RESOURCE_ROLE_PRESENTATION[String(role || "").toLowerCase()] || { Icon: Boxes, tone: "blue" };
}

function numericResourceFields(entry) {
  return (entry.fields || []).filter((field) => Number.isFinite(Number(field.value)));
}

function latestFieldUpdateAt(entry) {
  const times = (entry.fields || [])
    .map((field) => new Date(field.updatedAt || 0).getTime())
    .filter((ms) => ms > 0);
  const reported = new Date(entry.reportedAt || 0).getTime();
  const latest = Math.max(reported, ...(times.length ? times : [0]));
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function ResourcesPage() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      api("/api/coordinator-resources")
        .then((result) => {
          if (mounted && result.success) setSnapshot(result.data);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 8000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const coordinators = snapshot?.coordinators || [];
  const reporting = coordinators.filter((entry) => entry.reported && (entry.fields || []).length);
  const workforceEntries = coordinators.filter(
    (entry) => String(entry.role || "").toLowerCase() === "workforce"
  );
  const resourceEntries = coordinators.filter(
    (entry) => String(entry.role || "").toLowerCase() !== "workforce"
  );

  const stockFields = reporting.flatMap((entry) =>
    numericResourceFields(entry).filter(
      (field) => Number.isFinite(Number(field.max)) && Number(field.max) > 0
    )
  );
  const avgStock = stockFields.length
    ? Math.round(
        (stockFields.reduce(
          (sum, field) => sum + Math.min(1, Number(field.value) / Number(field.max)),
          0
        ) /
          stockFields.length) *
          100
      )
    : 0;
  const shortageFields = reporting.flatMap((entry) =>
    (entry.fields || []).filter((field) => field.shortageLevel)
  );
  const outOfStockCount = shortageFields.filter(
    (field) => field.shortageLevel === "out-of-stock"
  ).length;

  const workforceFieldTotal = (fieldId) =>
    workforceEntries.reduce(
      (sum, entry) =>
        sum + (Number((entry.fields || []).find((field) => field.id === fieldId)?.value) || 0),
      0
    );
  const volunteersOnDuty = workforceFieldTotal("volunteersOnDuty");
  const volunteersAvailable = workforceFieldTotal("volunteersAvailable");

  const lastReportAt = reporting
    .map((entry) => latestFieldUpdateAt(entry))
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Resources & Volunteers</h2>
          <p>Live stock reported by each coordinator over its own uplink ladder.</p>
        </div>
        <span className="live-dot">Live</span>
      </div>
      {!snapshot ? (
        <section className="panel">
          <div className="panel-head"><h3>Loading coordinator reports…</h3></div>
        </section>
      ) : reporting.length === 0 ? (
        <section className="panel">
          <div className="panel-head"><h3>Waiting for coordinator reports</h3></div>
          <p className="resource-empty-note">
            No coordinator has synced its resource state yet. Snapshots arrive automatically a
            few seconds after each coordinator boots, and again whenever a field team edits its
            stock — if a coordinator&apos;s uplink is down, its report lands when a link returns.
          </p>
        </section>
      ) : (
        <div className="resource-layout">
          <main>
            <div className="metric-grid compact">
              <MetricCard
                Icon={Boxes}
                tone="blue"
                label="Reporting Coordinators"
                value={`${reporting.length}/${coordinators.length}`}
                sub={`${avgStock}% average stock`}
              />
              <MetricCard
                Icon={AlertTriangle}
                tone="red"
                label="Shortage Flags"
                value={shortageFields.length}
                sub={`${outOfStockCount} out of stock`}
              />
              <MetricCard
                Icon={Users}
                tone="violet"
                label="Volunteers On Duty"
                value={volunteersOnDuty}
                sub={`${volunteersAvailable} more available`}
              />
              <MetricCard
                Icon={Activity}
                tone="teal"
                label="Last Report"
                value={lastReportAt ? ago(lastReportAt) : "—"}
                sub="synced from the field"
              />
            </div>
            <ResourceCoordinatorGrid groups={resourceEntries} />
          </main>
          <aside>
            <WorkforceCoordinatorPanel groups={workforceEntries} />
          </aside>
        </div>
      )}
    </div>
  );
}

const SHORTAGE_BAR_COLORS = {
  "out-of-stock": "#e11d48",
  "low-stock": "#f97316"
};

function ResourceStockRow({ field }) {
  const value = Number(field.value);
  const max = Number(field.max);
  const hasCapacity = Number.isFinite(max) && max > 0;
  const percent = hasCapacity ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : null;
  const barColor = SHORTAGE_BAR_COLORS[field.shortageLevel];
  return (
    <div className="resource-stock-row">
      <span>
        {field.label}
        {field.shortageLevel ? (
          <em className={`stock-flag ${field.shortageLevel}`}>
            {field.shortageLevel === "out-of-stock" ? "out of stock" : "low"}
          </em>
        ) : null}
      </span>
      <b>
        {Number.isFinite(value) ? value : "—"}
        {hasCapacity ? ` / ${max}` : ""} {field.unit || ""}
      </b>
      <div className="bar">
        <span
          style={{
            width: `${percent === null ? 0 : percent}%`,
            ...(barColor ? { background: barColor } : {})
          }}
        />
      </div>
      <small>{percent === null ? "—" : `${percent}%`}</small>
    </div>
  );
}

function ResourceCoordinatorCard({ entry }) {
  const [showAll, setShowAll] = useState(false);
  const { Icon, tone } = resourceRolePresentation(entry.role);
  const updatedAt = latestFieldUpdateAt(entry);
  // Shortage-flagged rows sort first so collapsing can never hide a problem.
  const fields = [...(entry.fields || [])].sort(
    (left, right) => (right.shortageLevel ? 1 : 0) - (left.shortageLevel ? 1 : 0)
  );
  const visible = showAll ? fields : fields.slice(0, 3);
  const hidden = fields.length - visible.length;

  return (
    <article className="resource-coordinator-card">
      <header>
        <IconTile Icon={Icon} tone={tone} />
        <div>
          <b>{entry.coordinatorName}</b>
          <span>
            {entry.roleLabel || cap(entry.role || "coordinator")}
            {updatedAt ? ` · updated ${ago(updatedAt)}` : ""}
          </span>
        </div>
      </header>
      {entry.reported && fields.length ? (
        <>
          {visible.map((field) => <ResourceStockRow field={field} key={field.id} />)}
          {fields.length > 3 ? (
            <button className="details-toggle subtle" onClick={() => setShowAll((prev) => !prev)}>
              {showAll ? "Show less" : `Show ${hidden} more`}
              {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : null}
        </>
      ) : (
        <p className="resource-empty-note">Awaiting first stock report from this coordinator.</p>
      )}
    </article>
  );
}

function ResourceCoordinatorGrid({ groups }) {
  return (
    <section className="panel resource-coordinator-panel">
      <div className="panel-head"><h3>Coordinator Resource Map</h3><span>{groups.length} coordinators</span></div>
      <div className="resource-coordinator-grid">
        {groups.map((entry) => (
          <ResourceCoordinatorCard entry={entry} key={entry.coordinatorId} />
        ))}
      </div>
    </section>
  );
}

function WorkforceCoordinatorPanel({ groups }) {
  const totalActive = groups.reduce(
    (sum, entry) =>
      sum + (Number((entry.fields || []).find((field) => field.id === "volunteersOnDuty")?.value) || 0),
    0
  );
  return (
    <section className="panel workforce-panel">
      <div className="panel-head"><h3>Workforce Coordinators</h3><span>{totalActive} on duty</span></div>
      <div className="workforce-group-list">
        {groups.length === 0 && (
          <p className="resource-empty-note">No workforce coordinator registered.</p>
        )}
        {groups.map((entry) => {
          const onDuty = Number(
            (entry.fields || []).find((field) => field.id === "volunteersOnDuty")?.value
          );
          return (
            <article className="workforce-group" key={entry.coordinatorId}>
              <header>
                <IconTile Icon={Users} tone="violet" />
                <div>
                  <b>{entry.coordinatorName}</b>
                  <span>
                    {(entry.coverageNodes || []).join(", ") || entry.location || "Coverage pending"}
                  </span>
                </div>
                <strong>{Number.isFinite(onDuty) ? onDuty : "—"}</strong>
              </header>
              {entry.reported && (entry.fields || []).length ? (
                entry.fields.map((field) => <ResourceStockRow field={field} key={field.id} />)
              ) : (
                <p className="resource-empty-note">Awaiting first report from this coordinator.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

const droneMissionTypes = [
  { value: "flood_survey", label: "Flood Survey" },
  { value: "victim_search", label: "Victim Search" },
  { value: "bridge_inspection", label: "Bridge Inspection" },
  { value: "medical_payload", label: "Medical Payload Drop" },
  { value: "aerial_relay", label: "Aerial Network Relay" }
];

const activeDroneStates = new Set(["launching", "en_route", "on_station", "paused", "returning"]);

function droneStatusTone(status) {
  if (["ready", "completed", "approved"].includes(status)) return "bg-[#e4faf3] text-[#087c67]";
  if (["launching", "en_route", "on_station", "returning"].includes(status)) return "bg-[#e5f0ff] text-[#1768d8]";
  if (["emergency_landed", "failed"].includes(status)) return "bg-[#ffe7eb] text-[#c72f4c]";
  return "bg-[#fff3d8] text-[#a76300]";
}

function missionLabel(type) {
  return droneMissionTypes.find((item) => item.value === type)?.label || cap(type || "Mission");
}

function AerialOperationsPage() {
  const [drones, setDrones] = useState([]);
  const [missions, setMissions] = useState([]);
  const [providerReachable, setProviderReachable] = useState(true);
  const [missionType, setMissionType] = useState("flood_survey");
  const [targetPod, setTargetPod] = useState("POD-04");
  const [selectedDroneId, setSelectedDroneId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [fleetResult, missionResult] = await Promise.all([api("/api/drones"), api("/api/drone-missions")]);
    if (fleetResult.success) setDrones(fleetResult.data || []);
    if (missionResult.success) setMissions(missionResult.data || []);
    setProviderReachable(fleetResult.providerReachable !== false && missionResult.providerReachable !== false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  const createMission = async () => {
    setBusy("create");
    setNotice(null);
    const result = await api("/api/drone-missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: missionType,
        target: { podId: targetPod },
        assignedDroneId: selectedDroneId || undefined,
        requestedBy: { role: "command-center", name: "EOC Admin" }
      })
    });
    setBusy("");
    setNotice({ ok: result.success, text: result.success ? `${result.data.id} created and awaiting approval.` : result.message });
    if (result.success) await load();
  };

  const missionAction = async (mission, action) => {
    setBusy(`${mission.id}:${action}`);
    setNotice(null);
    const result = await api(`/api/drone-missions/${encodeURIComponent(mission.id)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "launch" && selectedDroneId ? { droneId: selectedDroneId } : {})
    });
    setBusy("");
    setNotice({ ok: result.success, text: result.success ? `${mission.id}: ${cap(action)} accepted.` : result.message });
    if (result.success) await load();
  };

  const activeMissions = missions.filter((mission) => activeDroneStates.has(mission.status));
  const selectedMission = activeMissions[0] || missions[0];
  const videoDrone = drones.find((drone) => drone.id === selectedMission?.assignedDroneId) || drones.find((drone) => drone.status !== "charging") || drones[0];
  const readyDrones = drones.filter((drone) => drone.status === "ready").length;
  const relayMission = missions.find((mission) => mission.type === "aerial_relay" && mission.relayActive);

  return (
    <div className="page space-y-5">
      <div className="page-head">
        <div>
          <h2>Aerial Operations</h2>
          <p>Shared drone command, telemetry, emergency payloads, and aerial network restoration.</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${providerReachable ? "bg-[#e4faf3] text-[#087c67]" : "bg-[#ffe7eb] text-[#c72f4c]"}`}>
          <span className={`h-2 w-2 rounded-full ${providerReachable ? "bg-[#16b99a]" : "bg-[#e23b5b]"}`} />
          {providerReachable ? "DRONE SERVICE ONLINE" : "DRONE SERVICE OFFLINE"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[650px]:grid-cols-1">
        {[
          ["Fleet", drones.length, `${readyDrones} ready`, Plane, "#1768d8"],
          ["Active missions", activeMissions.length, `${missions.length} total`, Crosshair, "#8b5cf6"],
          ["Average battery", drones.length ? `${Math.round(drones.reduce((sum, drone) => sum + Number(drone.battery || 0), 0) / drones.length)}%` : "—", "live telemetry", BatteryCharging, "#16a085"],
          ["Aerial relay", relayMission ? "ONLINE" : "STANDBY", relayMission ? `${relayMission.target?.podId} via ${relayMission.assignedDroneId}` : "no relay deployed", Router, "#e48b18"]
        ].map(([label, value, sub, Icon, color]) => (
          <section className="rounded-2xl border border-[#dfe8f2] bg-white p-5 shadow-[0_10px_25px_rgba(25,60,100,.06)]" key={label}>
            <div className="mb-4 flex items-center justify-between"><span className="text-sm font-bold text-[#6b8198]">{label}</span><span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: color }}><Icon size={19} /></span></div>
            <b className="block text-2xl text-[#102f52]">{value}</b><small className="text-[#7c91a6]">{sub}</small>
          </section>
        ))}
      </div>

      {notice ? <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${notice.ok ? "border-[#a7e8d8] bg-[#eafaf5] text-[#087c67]" : "border-[#ffc3cf] bg-[#fff0f3] text-[#bd2f4a]"}`}>{notice.text}</div> : null}

      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)] gap-5 max-[1050px]:grid-cols-1">
        <section className="rounded-2xl border border-[#dfe8f2] bg-white p-5 shadow-[0_10px_25px_rgba(25,60,100,.06)]">
          <div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 text-lg text-[#102f52]">Launch a mission</h3><p className="mt-1 text-sm text-[#71879d]">Every mission starts pending and needs explicit EOC approval.</p></div><MapPinned className="text-[#1768d8]" /></div>
          <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#6b8198]">Mission type
              <select className="rounded-xl border border-[#cbd8e5] bg-white px-3 py-3 text-sm font-bold normal-case tracking-normal text-[#183a5f]" value={missionType} onChange={(event) => setMissionType(event.target.value)}>
                {droneMissionTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#6b8198]">Target pod
              <select className="rounded-xl border border-[#cbd8e5] bg-white px-3 py-3 text-sm font-bold normal-case tracking-normal text-[#183a5f]" value={targetPod} onChange={(event) => setTargetPod(event.target.value)}>
                {Array.from({ length: 10 }, (_, index) => `POD-${String(index + 1).padStart(2, "0")}`).map((pod) => <option value={pod} key={pod}>{pod}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#6b8198]">Preferred aircraft
              <select className="rounded-xl border border-[#cbd8e5] bg-white px-3 py-3 text-sm font-bold normal-case tracking-normal text-[#183a5f]" value={selectedDroneId} onChange={(event) => setSelectedDroneId(event.target.value)}>
                <option value="">Auto assign</option>
                {drones.map((drone) => <option value={drone.id} key={drone.id}>{drone.id} · {Math.round(drone.battery)}% · {cap(drone.status)}</option>)}
              </select>
            </label>
          </div>
          <button disabled={busy === "create" || !providerReachable} onClick={createMission} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#1768d8] to-[#0d7bdc] px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"><Plane size={17} />{busy === "create" ? "Creating…" : "Create mission request"}</button>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#173f63] bg-[#061827] shadow-[0_12px_30px_rgba(6,24,39,.22)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white"><div className="flex items-center gap-2"><Video size={17} className="text-[#65f3dc]" /><b>{videoDrone?.id || "No aircraft"} live feed</b></div><span className="text-xs font-black text-[#ff7184]">● LIVE</span></div>
          {videoDrone?.videoUrl ? <iframe title={`${videoDrone.id} simulated live feed`} src={videoDrone.videoUrl} className="h-[260px] w-full border-0" /> : <div className="grid h-[260px] place-items-center text-sm text-[#80a0b8]">Video becomes available when the provider is online.</div>}
        </section>
      </div>

      <section className="rounded-2xl border border-[#dfe8f2] bg-white p-5 shadow-[0_10px_25px_rgba(25,60,100,.06)]">
        <div className="mb-4 flex items-center justify-between"><div><h3 className="m-0 text-lg text-[#102f52]">Drone fleet</h3><p className="mt-1 text-sm text-[#71879d]">Provider-normalized aircraft, payload, and signal state.</p></div><span className="live-dot">Live</span></div>
        <div className="grid grid-cols-3 gap-4 max-[1050px]:grid-cols-1">
          {drones.map((drone) => (
            <article className="rounded-2xl border border-[#dce7f1] bg-[#f8fbfe] p-4" key={drone.id}>
              <div className="flex items-start justify-between"><div><b className="block text-lg text-[#123b67]">{drone.id}</b><small className="text-[#72879d]">{drone.location?.label || drone.connectedPodId}</small></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${droneStatusTone(drone.status)}`}>{cap(drone.status)}</span></div>
              <div className="my-4 h-2 overflow-hidden rounded-full bg-[#dce6ef]"><span className={`block h-full rounded-full ${drone.battery < 35 ? "bg-[#e23b5b]" : "bg-[#18b99b]"}`} style={{ width: `${Math.max(0, Math.min(100, drone.battery))}%` }} /></div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><span className="text-[#758ba0]">Battery</span><b className="text-right text-[#183a5f]">{Math.round(drone.battery)}%</b><span className="text-[#758ba0]">Altitude</span><b className="text-right text-[#183a5f]">{Math.round(drone.altitude)} m</b><span className="text-[#758ba0]">Signal</span><b className="text-right text-[#183a5f]">{Math.round(drone.signal)}%</b><span className="text-[#758ba0]">Payload</span><b className="text-right text-[#183a5f]">{cap(drone.payload?.type)}</b></div>
            </article>
          ))}
          {!drones.length ? <div className="col-span-full rounded-xl border border-dashed border-[#c8d6e4] p-8 text-center text-[#71879d]">No aircraft reported by the drone provider.</div> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[#dfe8f2] bg-white p-5 shadow-[0_10px_25px_rgba(25,60,100,.06)]">
        <div className="mb-4"><h3 className="m-0 text-lg text-[#102f52]">Mission control</h3><p className="mt-1 text-sm text-[#71879d]">Approval, flight milestones, findings, payload, and network-relay state.</p></div>
        <div className="grid gap-3">
          {missions.map((mission) => {
            const actionBusy = busy.startsWith(`${mission.id}:`);
            return (
              <article className="rounded-2xl border border-[#dce7f1] p-4" key={mission.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><b className="text-[#123b67]">{missionLabel(mission.type)}</b><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${droneStatusTone(mission.status)}`}>{cap(mission.status)}</span>{mission.relayActive ? <span className="rounded-full bg-[#e5f8ff] px-2.5 py-1 text-[11px] font-black text-[#087da4]">RELAY ONLINE</span> : null}</div><small className="mt-1 block text-[#72879d]">{mission.id} · {mission.target?.podId} / {mission.target?.label} · {mission.assignedDroneId || "unassigned"}{mission.incidentId ? ` · incident ${mission.incidentId}` : ""}</small></div><b className="text-sm text-[#1768d8]">{Math.round(mission.progress || 0)}%</b></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7eef5]"><span className="block h-full rounded-full bg-gradient-to-r from-[#1768d8] to-[#3fd2d0] transition-all" style={{ width: `${mission.progress || 0}%` }} /></div>
                {mission.findings?.length ? <div className="mt-3 rounded-xl bg-[#fff8e8] px-3 py-2 text-sm text-[#7f5b12]"><b>Latest finding:</b> {mission.findings[mission.findings.length - 1].message}</div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {mission.status === "requested" ? <button disabled={actionBusy} onClick={() => missionAction(mission, "approve")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1768d8] px-3 py-2 text-xs font-black text-white"><CheckCircle2 size={14} /> Approve</button> : null}
                  {mission.status === "approved" ? <button disabled={actionBusy} onClick={() => missionAction(mission, "launch")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#14977f] px-3 py-2 text-xs font-black text-white"><Play size={14} /> Launch</button> : null}
                  {["launching", "en_route", "on_station"].includes(mission.status) ? <button disabled={actionBusy} onClick={() => missionAction(mission, "pause")} className="inline-flex items-center gap-1.5 rounded-lg border border-[#cad8e5] px-3 py-2 text-xs font-black text-[#48647f]"><Pause size={14} /> Pause</button> : null}
                  {mission.status === "paused" ? <button disabled={actionBusy} onClick={() => missionAction(mission, "resume")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1768d8] px-3 py-2 text-xs font-black text-white"><Play size={14} /> Resume</button> : null}
                  {activeDroneStates.has(mission.status) && mission.status !== "returning" ? <button disabled={actionBusy} onClick={() => missionAction(mission, "return")} className="inline-flex items-center gap-1.5 rounded-lg border border-[#cad8e5] px-3 py-2 text-xs font-black text-[#48647f]"><RotateCcw size={14} /> Return home</button> : null}
                  {mission.type === "medical_payload" && mission.status === "on_station" && mission.payloadStatus !== "delivered" ? <button disabled={actionBusy} onClick={() => missionAction(mission, "drop-payload")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#8b5cf6] px-3 py-2 text-xs font-black text-white"><Package size={14} /> Release payload</button> : null}
                  {activeDroneStates.has(mission.status) ? <button disabled={actionBusy} onClick={() => { if (window.confirm("Emergency-land this aircraft?")) missionAction(mission, "emergency-land"); }} className="rounded-lg border border-[#ffc0cc] px-3 py-2 text-xs font-black text-[#c72f4c]">Emergency land</button> : null}
                </div>
              </article>
            );
          })}
          {!missions.length ? <div className="rounded-xl border border-dashed border-[#c8d6e4] p-8 text-center text-[#71879d]">No drone missions yet. Create a survey above or request one from an emergency card.</div> : null}
        </div>
      </section>
    </div>
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
        <MapPanel title="Flood Sensor Map" overview={overview} />
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
  const [alertsSeenAt, setAlertsSeenAt] = useState(() =>
    Number(localStorage.getItem("sanjeevani-alerts-seen-at") || 0)
  );

  // Opening the Alerts page marks everything currently there as seen — the
  // bell badge only counts what arrived AFTER the last visit, like any real
  // notification center. Persisted so a refresh doesn't resurrect old counts.
  useEffect(() => {
    if (route !== "/alerts") return;
    const now = Date.now();
    setAlertsSeenAt(now);
    localStorage.setItem("sanjeevani-alerts-seen-at", String(now));
  }, [route, unseenRequestLogs.length, overview?.alerts?.length]);

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
      if (type.startsWith("mission:")) {
        setOverview((current) => {
          if (!current || !payload?.id) return current;
          const droneMissions = upsertById(current.droneMissions || [], payload);
          return {
            ...current,
            droneMissions,
            counts: {
              ...current.counts,
              activeDroneMissions: droneMissions.filter((mission) => activeDroneStates.has(mission.status)).length
            }
          };
        });
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
    const openRequests = citizenRequests.filter((request) => !isResolvedRequest(request));
    const recentRequests = openRequests.filter(isLastHour);
    return {
      ...base,
      isLoading: Boolean(base.isLoading),
      requests: citizenRequests.slice(0, 12),
      coordinatorDeliveries: deliveries,
      counts: {
        ...base.counts,
        activeRequests: openRequests.length,
        resolvedRequests: citizenRequests.length - openRequests.length,
        activeRequestsLastHour: recentRequests.length,
        critical: openRequests.filter(isCriticalRequest).length,
        criticalLastHour: recentRequests.filter(isCriticalRequest).length,
        queuedCoordinatorDeliveries: deliveries.filter(
          (delivery) => !["delivered", "resolved", "rejected"].includes(delivery.status)
        ).length,
        alerts:
          unseenRequestLogs.filter(
            (entry) => new Date(entry.receivedAt || 0).getTime() > alertsSeenAt
          ).length +
          (base.alerts || []).filter(
            (alert) => new Date(alert.issuedAt || 0).getTime() > alertsSeenAt
          ).length
      }
    };
  }, [overview, requests, deliveries, unseenRequestLogs, alertsSeenAt]);

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
    // Search stays honest: only live pods, requests, and sensor readings —
    // no canned location/resource strings that nothing on a page backs up.
    return [...podItems, ...requestItems, ...sensorItems].filter((item) => `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(q));
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

  const requestDroneForIncident = async (request) => {
    const text = `${request.category || ""} ${request.message || ""}`.toLowerCase();
    const type = text.includes("medical") || text.includes("medicine") || text.includes("insulin")
      ? "medical_payload"
      : text.includes("bridge") || text.includes("road") || text.includes("fire")
        ? "bridge_inspection"
        : text.includes("trapped") || text.includes("roof") || text.includes("stranded")
          ? "victim_search"
          : "flood_survey";
    const result = await api("/api/drone-missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentId: request.id,
        type,
        target: {
          podId: request.podId || "POD-04",
          label: request.locationName || request.location || request.podName
        },
        requestedBy: { role: "command-center", name: "EOC Admin" }
      })
    });
    if (!result.success) {
      window.alert(result.message || "Unable to request a drone mission.");
      return;
    }
    setRoute("/drones");
  };

  const page = () => {
    if (route === "/requests") return <RequestsPage requests={displayRequests} deliveries={deliveries} deleteRequest={deleteRequest} retryDeliveries={retryDeliveries} focusRequestId={focusedRequestId} onRequestSeen={markRequestSeen} onDroneMission={requestDroneForIncident} />;
    if (route === "/pods") return <PodsPage overview={derivedOverview} />;
    if (route === "/network") return <NetworkPage overview={derivedOverview} infraAction={infraAction} restoreAll={restoreAll} />;
    if (route === "/resources" || route === "/volunteers") return <ResourcesPage />;
    if (route === "/sensors") return <SensorsPage overview={derivedOverview} />;
    if (route === "/drones") return <AerialOperationsPage />;
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
