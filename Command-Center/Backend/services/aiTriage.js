const axios = require("axios");

// SANJEEVANI AI triage: a small local LLM (Ollama container) re-reads every
// citizen SOS after it is already stored, queued, and delivered. The AI is an
// enhancer, never a gatekeeper — nothing in the pipeline waits for it, and a
// failed AI call leaves the keyword triage untouched. The model runs inside
// the cluster, so the AI keeps working even with zero external internet —
// it degrades exactly like the rest of the network.
const OLLAMA_URL = String(process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/+$/, "");
const AI_MODEL = process.env.AI_TRIAGE_MODEL || "qwen2.5:3b";
const AI_ENABLED = String(process.env.AI_TRIAGE_ENABLED || "true").toLowerCase() !== "false";
const AI_TIMEOUT_MS = Number(process.env.AI_TRIAGE_TIMEOUT_MS || 60000);

const RESPONDER_ROLES = ["hospital", "flood", "shelter", "workforce", "fire"];

const TRIAGE_SYSTEM_PROMPT = [
  "You are the triage officer of a disaster-response Emergency Operations Center.",
  "You receive one citizen SOS message. The message may be in any language.",
  "Reply with ONLY a JSON object, no other text, with exactly these keys:",
  '{"severity": <integer 1-10>, "roles": [<responder roles>], "category": "<one short word>", "reason": "<one short English sentence>"}',
  "",
  "severity: 9-10 = life-threatening right now (cardiac/stroke symptoms, drowning,",
  "trapped, heavy bleeding, not breathing, childbirth). 7-8 = urgent, could become",
  "life-threatening in hours (rising water, fire nearby, missing person, no critical",
  "medicine). 4-6 = essential needs (food, drinking water, shelter, evacuation help).",
  "1-3 = general assistance or information.",
  "Watch for implied emergencies without alarm words: 'chest feels heavy', 'lips",
  "turning blue', 'water reached the bed' are all severe.",
  `roles: 1-3 of ${JSON.stringify(RESPONDER_ROLES)}. hospital = medical. flood = water`,
  "rescue. fire = fire/smoke/gas. shelter = food/water/housing. workforce = manpower,",
  "transport, evacuation, debris.",
  "reason: one plain-English sentence a dispatcher can read in two seconds."
].join("\n");

function nowIso() {
  return new Date().toISOString();
}

// Deliberately does NOT include the keyword triage's severity: a small model
// anchors on any number it is shown and just agrees with it. The AI must
// judge the message fresh; the upgrade-only merge reconciles the two after.
function requestTextForAi(request) {
  return [
    request.name && `Requester: ${request.name}`,
    request.age && `Age: ${request.age}`,
    request.category && `Category chosen by citizen: ${request.category}`,
    `Message: ${request.message || request.detail || request.details || "(no message text)"}`,
    (request.location || request.locationName) && `Location: ${request.locationName || request.location}`
  ]
    .filter(Boolean)
    .join("\n");
}

async function callOllama(messages, { asJson = true, numPredict = 220, temperature = 0.1 } = {}) {
  const response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    {
      model: AI_MODEL,
      messages,
      stream: false,
      ...(asJson ? { format: "json" } : {}),
      options: { temperature, num_predict: numPredict }
    },
    { timeout: AI_TIMEOUT_MS }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }
  return content;
}

function validateTriageVerdict(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const severity = Math.min(10, Math.max(1, Math.round(Number(parsed.severity))));
  if (!Number.isFinite(severity)) {
    throw new Error(`AI returned a non-numeric severity: ${JSON.stringify(parsed.severity)}`);
  }

  const roles = (Array.isArray(parsed.roles) ? parsed.roles : [parsed.roles])
    .map((role) => String(role || "").toLowerCase().trim())
    .filter((role) => RESPONDER_ROLES.includes(role))
    .slice(0, 3);

  return {
    severity,
    roles,
    category: String(parsed.category || "").slice(0, 40),
    reason: String(parsed.reason || "").trim().slice(0, 240)
  };
}

// Returns a validated verdict, or throws. The caller decides what a failure
// means (always: keep the keyword triage and move on).
async function triageRequest(request) {
  if (!AI_ENABLED) {
    throw new Error("AI triage is disabled (AI_TRIAGE_ENABLED=false).");
  }

  const startedAt = Date.now();
  const content = await callOllama([
    { role: "system", content: TRIAGE_SYSTEM_PROMPT },
    { role: "user", content: requestTextForAi(request) }
  ]);

  const verdict = validateTriageVerdict(content);
  return {
    ...verdict,
    model: AI_MODEL,
    evaluatedAt: nowIso(),
    tookMs: Date.now() - startedAt
  };
}

const SITREP_SYSTEM_PROMPT = [
  "You are the duty officer of a disaster-response Emergency Operations Center.",
  "You receive a JSON snapshot of the network. Write a short situation report",
  "(SITREP) in plain English that an operator can read aloud in 30 seconds.",
  "Use exactly these four sections, each 1-3 short sentences:",
  "SITUATION: overall picture — open requests, how many critical, network mode.",
  "CRITICAL: the most urgent open cases and where they are. Name locations.",
  "RESOURCES: coordinator shortages and what they block. Say 'No shortages reported' if none.",
  "ACTIONS: 2-3 concrete recommendations, most urgent first.",
  "Only state facts present in the snapshot. Never invent numbers or places."
].join("\n");

async function generateSitrep(snapshot) {
  if (!AI_ENABLED) {
    throw new Error("AI triage is disabled (AI_TRIAGE_ENABLED=false).");
  }

  const startedAt = Date.now();
  const content = await callOllama(
    [
      { role: "system", content: SITREP_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(snapshot) }
    ],
    { asJson: false, numPredict: 450, temperature: 0.2 }
  );

  return {
    report: content.trim(),
    model: AI_MODEL,
    generatedAt: nowIso(),
    tookMs: Date.now() - startedAt
  };
}

async function aiHealth() {
  if (!AI_ENABLED) {
    return { enabled: false, status: "disabled", model: AI_MODEL, url: OLLAMA_URL };
  }

  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 2500 });
    const models = (response.data?.models || []).map((model) => model.name);
    const modelReady = models.some((name) => name === AI_MODEL || name.startsWith(`${AI_MODEL}:`));
    return {
      enabled: true,
      status: modelReady ? "ready" : "model-not-pulled",
      model: AI_MODEL,
      availableModels: models,
      url: OLLAMA_URL
    };
  } catch (error) {
    return { enabled: true, status: "unreachable", model: AI_MODEL, url: OLLAMA_URL, error: error.message };
  }
}

module.exports = {
  AI_MODEL,
  AI_ENABLED,
  RESPONDER_ROLES,
  triageRequest,
  generateSitrep,
  aiHealth
};
