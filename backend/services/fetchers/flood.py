"""Google Flood Hub API fetcher.
Provides real-time riverine flood forecasts and gauge status for 240,000+ locations worldwide.
API: https://developers.google.com/flood-forecasting
"""
import os
import time
import logging
from cachetools import TTLCache
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

GOOGLE_FLOOD_API_KEY = os.environ.get("GOOGLE_FLOOD_API_KEY", "")
FLOOD_API_BASE = "https://floodforecasting.googleapis.com/v1"

# Cache flood gauges for 30 min (flood status updates ~4x/day)
_flood_cache: TTLCache = TTLCache(maxsize=1, ttl=1800)
_last_fetch = 0
_FETCH_INTERVAL = 1800  # 30 minutes

# Flood severity colors for frontend
SEVERITY_MAP = {
    "EXTREME": {"color": "#FF0000", "level": 4},
    "DANGER":  {"color": "#FF6600", "level": 3},
    "WARNING": {"color": "#FFCC00", "level": 2},
    "NORMAL":  {"color": "#00CC44", "level": 1},
    "NO_DATA": {"color": "#888888", "level": 0},
}

@with_retry(max_retries=2, base_delay=5)
def fetch_flood_gauges():
    """Fetch active flood gauge statuses from Google Flood Hub API."""
    global _last_fetch

    if not GOOGLE_FLOOD_API_KEY:
        logger.debug("GOOGLE_FLOOD_API_KEY not set — flood layer disabled.")
        with _data_lock:
            latest_data["flood_gauges"] = []
        return

    now = time.time()
    if now - _last_fetch < _FETCH_INTERVAL:
        return

    gauges = []
    try:
        # Query gauges with active flood status (WARNING or above)
        url = f"{FLOOD_API_BASE}/gauges?key={GOOGLE_FLOOD_API_KEY}&pageSize=500"
        resp = fetch_with_curl(url, timeout=15)
        if resp.status_code != 200:
            logger.warning(f"Flood Hub API returned {resp.status_code}")
            return

        data = resp.json()
        raw_gauges = data.get("gauges", [])
        logger.info(f"Flood Hub: {len(raw_gauges)} gauges fetched")

        for g in raw_gauges:
            try:
                gauge_id = g.get("gaugeName", "") or g.get("gaugeId", "")
                lat = g.get("latLng", {}).get("latitude")
                lng = g.get("latLng", {}).get("longitude")
                if lat is None or lng is None:
                    continue

                flood_status = g.get("floodStatus", "NO_DATA")
                severity = SEVERITY_MAP.get(flood_status, SEVERITY_MAP["NO_DATA"])

                # Skip NORMAL/NO_DATA unless we want full coverage
                # (only show alerting gauges to reduce clutter)
                if severity["level"] < 2:
                    continue

                gauges.append({
                    "id": gauge_id,
                    "lat": lat,
                    "lng": lng,
                    "status": flood_status,
                    "level": severity["level"],
                    "color": severity["color"],
                    "river_name": g.get("riverName", ""),
                    "gauge_name": g.get("stationName", gauge_id),
                    "basin_size_km2": g.get("basinSizeKm2"),
                    "quality_verified": g.get("qualityVerified", False),
                    "inundation_available": g.get("inundationMapAvailable", False),
                    "warning_level": g.get("warningLevel"),
                    "danger_level": g.get("dangerLevel"),
                    "extreme_level": g.get("extremeLevel"),
                    "unit": g.get("unit", "m"),
                    "source": g.get("source", "Google Flood Hub"),
                    "country": g.get("country", ""),
                    "type": "flood_gauge",
                })
            except (ValueError, TypeError, KeyError) as e:
                logger.debug(f"Flood gauge parse error: {e}")
                continue

        _last_fetch = now
        logger.info(f"Flood Hub: {len(gauges)} active alert gauges (WARNING+)")

    except Exception as e:
        logger.error(f"Flood Hub fetch error: {e}")

    with _data_lock:
        latest_data["flood_gauges"] = gauges
    if gauges:
        _mark_fresh("flood_gauges")


@with_retry(max_retries=2, base_delay=5)
def fetch_flood_forecasts(gauge_id: str) -> dict:
    """Fetch 7-day hydrologic forecast for a specific gauge."""
    if not GOOGLE_FLOOD_API_KEY:
        return {}
    try:
        url = f"{FLOOD_API_BASE}/gauges/{gauge_id}/forecast?key={GOOGLE_FLOOD_API_KEY}"
        resp = fetch_with_curl(url, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.error(f"Flood forecast fetch error for {gauge_id}: {e}")
    return {}

# Backward-compat alias — data_fetcher.py uses this name
fetch_flood_data = fetch_flood_gauges
