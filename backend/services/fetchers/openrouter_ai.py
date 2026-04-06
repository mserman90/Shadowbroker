"""OpenRouter LLM API integration for OSINT AI analysis.
Provides AI-powered threat assessment, event summarization, and geopolitical analysis.
API: https://openrouter.ai/
"""
import os
import json
import time
import logging
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# Default model: free tier capable, fast for OSINT summaries
DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct:free"

# Rate limiting: max 1 AI analysis per 60 seconds
_last_ai_call = 0
_MIN_INTERVAL = 60

SYSTEM_PROMPT = """You are ShadowBroker OSINT Analyst — an expert in geopolitical intelligence, 
conflict analysis, and open-source intelligence. Analyze the provided event data and produce 
a concise, factual intelligence brief. Focus on: key actors, locations, severity, and 
strategic implications. Output in 3-5 sentences maximum. Do not speculate beyond the data."""


def analyze_events(events: list, context: str = "") -> dict:
    """Send OSINT event data to OpenRouter LLM for analysis.
    Returns: {summary: str, model: str, tokens_used: int}
    """
    global _last_ai_call

    if not OPENROUTER_API_KEY:
        return {"summary": "AI analysis unavailable (OPENROUTER_API_KEY not configured).",
                "model": None, "tokens_used": 0}

    now = time.time()
    if now - _last_ai_call < _MIN_INTERVAL:
        remaining = int(_MIN_INTERVAL - (now - _last_ai_call))
        return {"summary": f"AI rate limited. Next analysis available in {remaining}s.",
                "model": None, "tokens_used": 0}

    try:
        # Build compact event summary for token efficiency
        event_text = ""
        for i, ev in enumerate(events[:10]):  # Max 10 events per analysis
            event_text += (
                f"{i+1}. [{ev.get('date','?')}] {ev.get('country','?')}: "
                f"{ev.get('conflict_name', ev.get('title', 'Unknown event'))} "
                f"(Deaths: {ev.get('deaths_best', '?')})"
                f"\n"
            )

        user_message = f"""
Analyze these recent OSINT events{' - ' + context if context else ''}:

{event_text}

Provide a concise intelligence assessment.
"""

        payload = {
            "model": DEFAULT_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_message},
            ],
            "max_tokens": 300,
            "temperature": 0.3,
        }

        resp = fetch_with_curl(
            f"{OPENROUTER_BASE}/chat/completions",
            method="POST",
            json_data=payload,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "HTTP-Referer": "https://github.com/tangobravoiki/Shadowbroker",
                "X-Title": "ShadowBroker OSINT",
                "Content-Type": "application/json",
            },
            timeout=30,
        )

        _last_ai_call = time.time()

        if resp.status_code == 200:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            model_used = data.get("model", DEFAULT_MODEL)
            logger.info(f"OpenRouter AI analysis complete ({usage.get('total_tokens',0)} tokens, model: {model_used})")
            return {
                "summary": content,
                "model": model_used,
                "tokens_used": usage.get("total_tokens", 0),
            }
        else:
            logger.warning(f"OpenRouter API returned {resp.status_code}: {resp.text[:200]}")
            return {"summary": f"AI analysis failed (HTTP {resp.status_code}).",
                    "model": None, "tokens_used": 0}

    except Exception as e:
        logger.error(f"OpenRouter AI analysis error: {e}")
        return {"summary": f"AI analysis error: {str(e)[:100]}",
                "model": None, "tokens_used": 0}


def get_threat_assessment(region: str, events: list) -> dict:
    """Generate a threat assessment for a specific region."""
    return analyze_events(events, context=f"Focus on {region} regional threat assessment")


def summarize_news_feed(articles: list) -> dict:
    """Summarize SIGINT news feed articles into an intelligence brief."""
    news_events = [
        {"title": a.get("title", ""), "date": a.get("published", ""),
         "country": a.get("source", ""), "conflict_name": a.get("title", ""),
         "deaths_best": "N/A"}
        for a in articles[:10]
    ]
    return analyze_events(news_events, context="SIGINT news feed summary")

# Backward-compat alias — data_fetcher.py re-exports this name
analyze_with_ai = analyze_events
