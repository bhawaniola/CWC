const CRITICAL_KEYWORDS = [
  "unconscious",
  "bleeding",
  "insulin",
  "pregnant",
  "trapped",
  "chest pain",
  "heart attack",
  "stroke",
  "cannot breathe"
];

const ESSENTIAL_KEYWORDS = [
  "food",
  "water",
  "medicine",
  "shelter",
  "milk",
  "blanket",
  "ration"
];

function findKeyword(message, keywords) {
  const normalized = String(message || "").toLowerCase();
  return keywords.find((keyword) => normalized.includes(keyword));
}

function triageRequest({ category, message }) {
  const criticalKeyword = findKeyword(message, CRITICAL_KEYWORDS);

  if (criticalKeyword) {
    return {
      severity: 9,
      priority: "critical",
      category: "Medical/Rescue",
      reason: `Critical emergency keyword detected: ${criticalKeyword}`
    };
  }

  const essentialKeyword = findKeyword(message, ESSENTIAL_KEYWORDS);

  if (essentialKeyword) {
    return {
      severity: 6,
      priority: "medium",
      category: category || "Other",
      reason: `Essential supply/shelter need detected: ${essentialKeyword}`
    };
  }

  return {
    severity: 3,
    priority: "low",
    category: category || "Other",
    reason: "General assistance request"
  };
}

module.exports = {
  triageRequest
};
