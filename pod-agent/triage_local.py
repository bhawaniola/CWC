"""Island-mode triage: transparent keyword rules (the offline fallback tier).
In Tier 2 the control center re-triages with a cloud LLM when configured."""

RULES = [
    # (keyword, severity, category)
    ("unconscious", 10, "medical"), ("not breathing", 10, "medical"),
    ("heart", 9, "medical"), ("bleeding", 9, "medical"),
    ("insulin", 9, "medical"), ("medicine", 8, "medical"),
    ("pregnant", 8, "medical"), ("injured", 8, "medical"),
    ("trapped", 9, "rescue"), ("stuck", 8, "rescue"),
    ("collapsed", 9, "rescue"), ("drowning", 10, "rescue"),
    ("roof", 7, "rescue"), ("fire", 9, "rescue"),
    ("water", 5, "supplies"), ("food", 4, "supplies"),
    ("milk", 5, "supplies"), ("blanket", 3, "supplies"),
]
BOOSTERS = [("child", 1), ("baby", 1), ("elderly", 1), ("grandfather", 1),
            ("grandmother", 1), ("disabled", 1)]


def triage_local(text: str):
    t = text.lower()
    severity, category, matched = 2, "general", []
    for kw, sev, cat in RULES:
        if kw in t and sev > severity:
            severity, category = sev, cat
        if kw in t:
            matched.append(kw)
    for kw, boost in BOOSTERS:
        if kw in t:
            severity = min(10, severity + boost)
            matched.append(kw + " (vulnerable)")
    reason = "matched: " + ", ".join(matched) if matched else "no urgent keywords"
    return severity, category, reason
