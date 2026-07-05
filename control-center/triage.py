"""Cloud triage: keyword rules, optionally upgraded by an LLM when
ANTHROPIC_API_KEY is set. Always explainable — reason travels with the score."""
import json
import os

import httpx

API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

PROMPT = (
    "You are a disaster-response triage assistant. Given a citizen help request, "
    'reply ONLY with JSON: {"severity": 1-10, "category": "medical|rescue|supplies|general", '
    '"reason": "<one short line naming the factors>"}. Request: '
)


async def triage(text, local_sev, local_cat, local_reason):
    if API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": API_KEY,
                             "anthropic-version": "2023-06-01"},
                    json={"model": MODEL, "max_tokens": 200,
                          "messages": [{"role": "user", "content": PROMPT + text}]})
                out = json.loads(r.json()["content"][0]["text"])
                return (int(out["severity"]), out["category"],
                        "AI: " + out["reason"])
        except Exception:
            pass                                   # fall back to rules
    return local_sev or 2, local_cat or "general", local_reason or "rules"
