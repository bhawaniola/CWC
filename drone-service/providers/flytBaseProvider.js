const axios = require("axios");
const { EventEmitter } = require("events");

// FlytBase deployments expose tenant-specific credentials and API contracts.
// This adapter keeps those details isolated from SANJEEVANI. Set the base URL
// and endpoint templates supplied for your FlytBase tenant; mock mode remains
// the safe default for the hackathon.
class FlytBaseProvider extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseUrl = String(options.baseUrl || process.env.FLYTBASE_API_BASE_URL || "").replace(/\/+$/, "");
    this.token = options.token || process.env.FLYTBASE_API_TOKEN || "";
    if (!this.baseUrl || !this.token) {
      throw new Error("DRONE_MODE=flytbase requires FLYTBASE_API_BASE_URL and FLYTBASE_API_TOKEN.");
    }
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: Number(process.env.FLYTBASE_TIMEOUT_MS || 10000),
      headers: { Authorization: `Bearer ${this.token}` }
    });
  }

  async listDrones() {
    const response = await this.client.get(process.env.FLYTBASE_DRONES_PATH || "/drones");
    return response.data?.items || response.data?.data || response.data || [];
  }

  async listMissions() {
    const response = await this.client.get(process.env.FLYTBASE_MISSIONS_PATH || "/missions");
    return response.data?.items || response.data?.data || response.data || [];
  }

  async getMission(id) {
    const response = await this.client.get(`${process.env.FLYTBASE_MISSIONS_PATH || "/missions"}/${encodeURIComponent(id)}`);
    return response.data?.data || response.data;
  }

  async getDrone(id) {
    const response = await this.client.get(`${process.env.FLYTBASE_DRONES_PATH || "/drones"}/${encodeURIComponent(id)}`);
    return response.data?.data || response.data;
  }

  async createMission(input) {
    const response = await this.client.post(process.env.FLYTBASE_MISSIONS_PATH || "/missions", input);
    return response.data?.data || response.data;
  }

  async approveMission(id) {
    return this.action(id, "approve");
  }

  async launchMission(id, preferredDroneId) {
    return this.action(id, "launch", { droneId: preferredDroneId });
  }

  async action(id, action, payload = {}) {
    const base = process.env.FLYTBASE_MISSIONS_PATH || "/missions";
    const response = await this.client.post(`${base}/${encodeURIComponent(id)}/actions`, { action, ...payload });
    return response.data?.data || response.data;
  }
}

module.exports = { FlytBaseProvider };
