"""UCDP (Uppsala Conflict Data Program) API fetcher.
Fetches recent georeferenced conflict events (GED) for OSINT overlay.
API: https://ucdpapi.pcr.uu.se/api/gedevents/25.1
No API key required.
"""
import time
import logging
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

UCDP_API_BASE = "https://ucdpapi.pcr.uu.se/api"
_last_fetch = 0
_FETCH_INTERVAL = 3600  # hourly (UCDP candidate data updates daily)

# UCDP conflict type labels
TYPE_OF_VIOLENCE = {
    1: "State-based",
    2: "Non-state",
    3: "One-sided",
}

@with_retry(max_retries=2, base_delay=5)
def fetch_ucdp_events():
    """Fetch recent UCDP Candidate Events (near-realtime, last 180 days)."""
    global _last_fetch
    now = time.time()
    if now - _last_fetch < _FETCH_INTERVAL:
        return

    events = []
    try:
        # UCDP Candidate: most recent georeferenced events (2024-present)
        url = f"{UCDP_API_BASE}/gedevents/25.1?pagesize=1000&page=1"
        resp = fetch_with_curl(url, timeout=20)
        if resp.status_code != 200:
            logger.warning(f"UCDP API returned {resp.status_code}")
            return

        data = resp.json()
        raw = data.get("Result", [])
        logger.info(f"UCDP: {len(raw)} events fetched")

        for ev in raw:
            try:
                lat = ev.get("latitude")
                lng = ev.get("longitude")
                if lat is None or lng is None:
                    continue
                if lat == 0 and lng == 0:
                    continue

                vtype = ev.get("type_of_violence", 0)
                deaths = (ev.get("best", 0) or 0)
                events.append({
                    "id": str(ev.get("id", "")),
                    "lat": float(lat),
                    "lng": float(lng),
                    "date": ev.get("date_start", ""),
                    "country": ev.get("country", ""),
                    "region": ev.get("region", ""),
                    "conflict_name": ev.get("conflict_name", "Unknown Conflict"),
                    "type_of_violence": vtype,
                    "violence_label": TYPE_OF_VIOLENCE.get(vtype, "Unknown"),
                    "side_a": ev.get("side_a", ""),
                    "side_b": ev.get("side_b", ""),
                    "deaths_best": deaths,
                    "deaths_low": ev.get("low", 0) or 0,
                    "deaths_high": ev.get("high", 0) or 0,
                    "source": "UCDP GED",
                    "type": "ucdp_conflict",
                })
            except (ValueError, TypeError, KeyError) as e:
                logger.debug(f"UCDP event parse error: {e}")
                continue

        _last_fetch = now
        logger.info(f"UCDP: {len(events)} georeferenced conflict events loaded")

    except Exception as e:
        logger.error(f"UCDP fetch error: {e}")

    with _data_lock:
        latest_data["ucdp_events"] = events
    if events:
        _mark_fresh("ucdp_events")

# Backward-compat alias — data_fetcher.py uses this name
fetch_ucdp_conflicts = fetch_ucdp_events
