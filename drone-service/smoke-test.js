const assert = require("assert");
const { MockDroneProvider } = require("./providers/mockDroneProvider");

const provider = new MockDroneProvider({ tickMs: 100000 });
const mission = provider.createMission({ type: "victim_search", target: { podId: "POD-04" } });
assert.equal(mission.status, "requested");
assert.equal(provider.approveMission(mission.id).status, "approved");
const launched = provider.launchMission(mission.id, "DRN-01");
assert.equal(launched.status, "launching");
assert.equal(launched.assignedDroneId, "DRN-01");
assert.equal(provider.action(mission.id, "pause").status, "paused");
assert.equal(provider.action(mission.id, "resume").status, "launching");
assert.equal(provider.action(mission.id, "return").status, "returning");
clearInterval(provider.timer);
console.log("drone-service smoke test passed");
