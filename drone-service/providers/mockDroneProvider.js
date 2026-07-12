const { EventEmitter } = require("events");
const crypto = require("crypto");

const POD_COORDINATES = {
  "POD-01": { latitude: 16.5062, longitude: 80.648, label: "District Center" },
  "POD-02": { latitude: 16.5104, longitude: 80.6412, label: "Hospital Zone" },
  "POD-03": { latitude: 16.5148, longitude: 80.6351, label: "School Zone" },
  "POD-04": { latitude: 16.5191, longitude: 80.629, label: "Riverbank" },
  "POD-05": { latitude: 16.5228, longitude: 80.6227, label: "Evacuation Point" },
  "POD-06": { latitude: 16.527, longitude: 80.6168, label: "Remote Village" },
  "POD-07": { latitude: 16.5008, longitude: 80.6556, label: "Warehouse" },
  "POD-08": { latitude: 16.4964, longitude: 80.6617, label: "Medical Camp" },
  "POD-09": { latitude: 16.4921, longitude: 80.6678, label: "High Ground" },
  "POD-10": { latitude: 16.4878, longitude: 80.6739, label: "Mobile Relay" }
};

const ACTIVE_STATES = new Set(["launching", "en_route", "on_station", "paused", "returning"]);
const MISSION_TYPES = new Set([
  "flood_survey",
  "victim_search",
  "bridge_inspection",
  "medical_payload",
  "aerial_relay"
]);

function iso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}

class MockDroneProvider extends EventEmitter {
  constructor({ publicBaseUrl = "http://localhost:9600", tickMs = 2000 } = {}) {
    super();
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
    this.tickMs = tickMs;
    this.missions = [];
    this.drones = [
      this.makeDrone("DRN-01", 92, "POD-01", "thermal-camera", "ready"),
      this.makeDrone("DRN-02", 76, "POD-07", "medical-release", "ready"),
      this.makeDrone("DRN-03", 43, "POD-10", "mesh-relay", "charging")
    ];
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  makeDrone(id, battery, podId, payloadType, status) {
    const location = POD_COORDINATES[podId];
    return {
      id,
      name: `Sanjeevani ${id}`,
      provider: "mock",
      status,
      battery,
      altitude: 0,
      speed: 0,
      signal: status === "charging" ? 100 : 96,
      gps: "active",
      location: { ...location, podId },
      home: { ...location, podId },
      payload: {
        type: payloadType,
        status: payloadType === "medical-release" ? "loaded" : "ready"
      },
      missionId: null,
      connectedPodId: podId,
      videoUrl: `${this.publicBaseUrl}/video/${id}`,
      updatedAt: iso()
    };
  }

  listDrones() {
    return clone(this.drones);
  }

  listMissions() {
    return clone(this.missions);
  }

  getMission(id) {
    const mission = this.missions.find((item) => item.id === id);
    return mission ? clone(mission) : null;
  }

  getDrone(id) {
    const drone = this.drones.find((item) => item.id === id);
    return drone ? clone(drone) : null;
  }

  createMission(input = {}) {
    const type = String(input.type || "flood_survey").toLowerCase();
    if (!MISSION_TYPES.has(type)) {
      const error = new Error(`Unsupported mission type: ${type}`);
      error.status = 400;
      throw error;
    }

    const targetPodId = String(input.target?.podId || input.podId || "POD-04").toUpperCase();
    const knownTarget = POD_COORDINATES[targetPodId];
    const latitude = Number(input.target?.latitude ?? knownTarget?.latitude);
    const longitude = Number(input.target?.longitude ?? knownTarget?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const error = new Error("Mission target needs a known pod or valid latitude/longitude.");
      error.status = 400;
      throw error;
    }

    const mission = {
      id: input.id || `MSN-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      incidentId: input.incidentId || input.requestId || null,
      type,
      title: input.title || type.replace(/_/g, " "),
      target: {
        podId: targetPodId,
        latitude,
        longitude,
        label: input.target?.label || knownTarget?.label || input.location || "Custom coordinates"
      },
      requestedBy: input.requestedBy || { role: "command-center", name: "EOC Operator" },
      assignedDroneId: input.assignedDroneId || null,
      status: "requested",
      approvalStatus: "pending",
      progress: 0,
      findings: [],
      relayActive: false,
      payloadStatus: type === "medical_payload" ? "loaded" : "not-applicable",
      videoUrl: null,
      createdAt: iso(),
      updatedAt: iso()
    };
    this.missions.unshift(mission);
    this.emitMission(mission, "mission:requested");
    return clone(mission);
  }

  approveMission(id) {
    const mission = this.requireMission(id);
    if (mission.status !== "requested") return clone(mission);
    mission.status = "approved";
    mission.approvalStatus = "approved";
    mission.approvedAt = iso();
    mission.updatedAt = iso();
    this.emitMission(mission, "mission:approved");
    return clone(mission);
  }

  launchMission(id, preferredDroneId) {
    const mission = this.requireMission(id);
    if (!mission.approvalStatus || mission.approvalStatus !== "approved") {
      const error = new Error("Mission must be approved before launch.");
      error.status = 409;
      throw error;
    }
    if (ACTIVE_STATES.has(mission.status)) return clone(mission);

    const drone = this.selectDrone(preferredDroneId || mission.assignedDroneId, mission.type);
    if (!drone) {
      const error = new Error("No flight-ready drone is available.");
      error.status = 409;
      throw error;
    }
    if (drone.battery < 35) {
      const error = new Error(`${drone.id} battery is below the 35% launch threshold.`);
      error.status = 409;
      throw error;
    }

    mission.assignedDroneId = drone.id;
    mission.status = "launching";
    mission.progress = 2;
    mission.launchedAt = iso();
    mission.updatedAt = iso();
    mission.videoUrl = drone.videoUrl;
    mission.startLocation = clone(drone.location);
    drone.status = "launching";
    drone.missionId = mission.id;
    drone.connectedPodId = mission.target.podId;
    drone.updatedAt = iso();
    this.emitMission(mission, "mission:launched", drone);
    return clone(mission);
  }

  action(id, action) {
    const mission = this.requireMission(id);
    const drone = mission.assignedDroneId ? this.requireDrone(mission.assignedDroneId) : null;

    if (action === "pause" && ["launching", "en_route", "on_station"].includes(mission.status)) {
      mission.previousStatus = mission.status;
      mission.status = "paused";
      if (drone) {
        drone.status = "hovering";
        drone.speed = 0;
      }
    } else if (action === "resume" && mission.status === "paused") {
      mission.status = mission.previousStatus || "en_route";
      delete mission.previousStatus;
      if (drone) drone.status = mission.status;
    } else if (action === "return") {
      if (!["completed", "cancelled", "emergency_landed"].includes(mission.status)) {
        mission.status = "returning";
        mission.relayActive = false;
        if (drone) drone.status = "returning";
      }
    } else if (action === "emergency-land") {
      mission.status = "emergency_landed";
      mission.relayActive = false;
      mission.completedAt = iso();
      if (drone) {
        drone.status = "emergency_landed";
        drone.altitude = 0;
        drone.speed = 0;
        drone.missionId = null;
      }
    } else if (action === "drop-payload") {
      if (mission.type !== "medical_payload" || mission.status !== "on_station") {
        const error = new Error("Payload can only be released from an on-station medical mission.");
        error.status = 409;
        throw error;
      }
      mission.payloadStatus = "delivered";
      mission.findings.push({ type: "payload_delivered", message: "Emergency medical payload released.", at: iso() });
      if (drone) drone.payload.status = "released";
    } else if (!["pause", "resume", "return", "emergency-land", "drop-payload"].includes(action)) {
      const error = new Error(`Unsupported mission action: ${action}`);
      error.status = 400;
      throw error;
    }

    mission.updatedAt = iso();
    if (drone) drone.updatedAt = iso();
    this.emitMission(mission, `mission:${action}`, drone);
    return clone(mission);
  }

  selectDrone(preferredId, missionType) {
    if (preferredId) {
      const preferred = this.drones.find((item) => item.id === preferredId);
      if (preferred && preferred.status === "ready") return preferred;
    }
    const payloadPreference = missionType === "medical_payload" ? "medical-release" : missionType === "aerial_relay" ? "mesh-relay" : "thermal-camera";
    return (
      this.drones.find((item) => item.status === "ready" && item.payload.type === payloadPreference) ||
      this.drones.find((item) => item.status === "ready")
    );
  }

  requireMission(id) {
    const mission = this.missions.find((item) => item.id === id);
    if (!mission) {
      const error = new Error("Mission not found.");
      error.status = 404;
      throw error;
    }
    return mission;
  }

  requireDrone(id) {
    const drone = this.drones.find((item) => item.id === id);
    if (!drone) {
      const error = new Error("Drone not found.");
      error.status = 404;
      throw error;
    }
    return drone;
  }

  emitMission(mission, eventType, drone) {
    this.emit("event", {
      eventType,
      mission: clone(mission),
      drone: clone(drone || (mission.assignedDroneId ? this.drones.find((item) => item.id === mission.assignedDroneId) : null)),
      occurredAt: iso()
    });
  }

  tick() {
    for (const drone of this.drones) {
      if (drone.status === "charging") {
        drone.battery = clamp(drone.battery + 0.4, 0, 100);
        if (drone.battery >= 70) drone.status = "ready";
        drone.updatedAt = iso();
      }
    }

    for (const mission of this.missions) {
      if (!ACTIVE_STATES.has(mission.status) || mission.status === "paused") continue;
      const drone = this.drones.find((item) => item.id === mission.assignedDroneId);
      if (!drone) continue;

      const previousStatus = mission.status;
      drone.battery = clamp(drone.battery - (mission.type === "aerial_relay" ? 0.7 : 0.5), 0, 100);
      drone.signal = clamp(95 - Math.round(mission.progress / 9), 65, 100);

      if (mission.status === "launching") {
        mission.progress = clamp(mission.progress + 10, 0, 20);
        drone.altitude = Math.round(interpolate(0, 45, mission.progress / 20));
        drone.speed = 4;
        if (mission.progress >= 20) {
          mission.status = "en_route";
          drone.status = "en_route";
        }
      } else if (mission.status === "en_route") {
        mission.progress = clamp(mission.progress + 9, 20, 72);
        const fraction = (mission.progress - 20) / 52;
        drone.altitude = mission.type === "aerial_relay" ? 120 : 85;
        drone.speed = 12;
        drone.location.latitude = Number(interpolate(mission.startLocation.latitude, mission.target.latitude, fraction).toFixed(6));
        drone.location.longitude = Number(interpolate(mission.startLocation.longitude, mission.target.longitude, fraction).toFixed(6));
        if (mission.progress >= 72) {
          mission.status = "on_station";
          mission.arrivedAt = iso();
          drone.status = "on_station";
          drone.speed = 0;
          drone.location = { ...mission.target };
          if (mission.type === "aerial_relay") {
            mission.relayActive = true;
            mission.findings.push({ type: "relay_active", message: `${mission.target.podId} connected through aerial relay.`, at: iso() });
          } else if (mission.type === "victim_search") {
            mission.findings.push({ type: "victim_signal", message: "Thermal signature detected near the marked location.", at: iso() });
          } else if (mission.type === "bridge_inspection") {
            mission.findings.push({ type: "route_blocked", message: "Standing water detected on the eastern bridge approach.", at: iso() });
          }
        }
      } else if (mission.status === "on_station") {
        mission.progress = clamp(mission.progress + 4, 72, 88);
        drone.speed = 0;
        if (mission.type !== "aerial_relay" && mission.progress >= 88) {
          mission.status = "returning";
          drone.status = "returning";
        }
      } else if (mission.status === "returning") {
        mission.progress = clamp(mission.progress + 7, 88, 100);
        const fraction = (mission.progress - 88) / 12;
        drone.altitude = Math.max(0, Math.round(interpolate(70, 0, fraction)));
        drone.speed = fraction > 0.8 ? 3 : 11;
        drone.location.latitude = Number(interpolate(mission.target.latitude, drone.home.latitude, fraction).toFixed(6));
        drone.location.longitude = Number(interpolate(mission.target.longitude, drone.home.longitude, fraction).toFixed(6));
        if (mission.progress >= 100) {
          mission.status = "completed";
          mission.completedAt = iso();
          mission.relayActive = false;
          drone.status = drone.battery < 45 ? "charging" : "ready";
          drone.missionId = null;
          drone.connectedPodId = drone.home.podId;
          drone.location = clone(drone.home);
          drone.altitude = 0;
          drone.speed = 0;
        }
      }

      mission.updatedAt = iso();
      drone.updatedAt = iso();
      this.emitMission(mission, previousStatus === mission.status ? "mission:telemetry" : `mission:${mission.status}`, drone);
    }
  }
}

module.exports = { MockDroneProvider, MISSION_TYPES, POD_COORDINATES };
