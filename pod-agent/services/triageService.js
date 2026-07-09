const CRITICAL_KEYWORDS = [
  "unconscious",
  "bleeding",
  "insulin",
  "pregnant",
  "trapped",
  "chest pain",
  "heart attack",
  "stroke",
  "cannot breathe",
  // "breath" is a substring of breathe/breathing/breathless, so one entry
  // covers "can't breathe", "breathing difficulty", "breathless", etc.
  "breath",
  "oxygen",
  "suffocat",
  "drowning",
  "collapse",
  "electrocut",
  "snake bite",
  "seizure",
  "बेहोश",
  "खून",
  "इंसुलिन",
  "सांस",
  "गर्भवती",
  "రక్తం",
  "ఇన్సులిన్",
  "శ్వాస",
  "இரத்தம்",
  "இன்சுலின்",
  "மூச்சு",
  "ರಕ್ತ",
  "ಇನ್ಸುಲಿನ್",
  "ಉಸಿರ",
  "രക്തം",
  "ഇൻസുലിൻ",
  "ശ്വാസം",
  "রক্ত",
  "ইনসুলিন",
  "শ্বাস",
  "લોહી",
  "ઇન્સ્યુલિન",
  "શ્વાસ",
  "ਖੂਨ",
  "ਇਨਸੁਲਿਨ",
  "ਸਾਹ",
  "خون",
  "انسولین",
  "سانس",
  "ରକ୍ତ",
  "ଇନସୁଲିନ",
  "ଶ୍ୱାସ"
];

const ESSENTIAL_KEYWORDS = [
  "food",
  "water",
  "medicine",
  "shelter",
  "milk",
  "blanket",
  "ration",
  "भोजन",
  "पानी",
  "दवा",
  "आश्रय",
  "ఆహారం",
  "నీరు",
  "మందు",
  "ఆశ్రయం",
  "உணவு",
  "தண்ணீர்",
  "மருந்து",
  "தங்குமிடம்",
  "ಆಹಾರ",
  "ನೀರು",
  "ಔಷಧ",
  "ಆಶ್ರಯ",
  "ഭക്ഷണം",
  "വെള്ളം",
  "മരുന്ന്",
  "ആശ്രയം",
  "খাবার",
  "পানি",
  "ওষুধ",
  "আশ্রয়",
  "ખોરાક",
  "પાણી",
  "દવા",
  "આશ્રય",
  "ਖਾਣਾ",
  "ਪਾਣੀ",
  "ਦਵਾਈ",
  "ਸ਼ੈਲਟਰ",
  "خوراک",
  "پانی",
  "دوا",
  "پناہ",
  "ଖାଦ୍ୟ",
  "ପାଣି",
  "ଔଷଧ",
  "ଆଶ୍ରୟ"
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
