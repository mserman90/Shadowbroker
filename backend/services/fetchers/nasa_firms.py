"""NASA FIRMS Fetcher - Active fire/hotspot data via NASA FIRMS API.

Uses NASA FIRMS MAP KEY and FIRMS KEY stored in environment variables.
Never hardcode keys in source files.
"""
import os
import logging
import requests
from datetime import datetime, timedelta
from typing import Optional
from services.fetchers._store import latest_data, _data_lock, _mark_fresh

logger = logging.getLogger(__name__)

# Load keys from environment - NEVER hardcode
FIRMS_MAP_KEY = os.getenv("NASA_FIRMS_MAP_KEY", "")
FIRMS_KEY = os.getenv("NASA_FIRMS_KEY", "")

FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov"
FIRMS_API_URL = f"{FIRMS_BASE_URL}/api"
FIRMS_MAP_URL = f"{FIRMS_BASE_URL}/map-key"

# Available FIRMS data sources
FIRMS_SOURCES = [
    "VIIRS_SNPP_NRT",       # VIIRS S-NPP Near Real-Time
    "VIIRS_NOAA20_NRT",    # VIIRS NOAA-20 Near Real-Time
    "VIIRS_NOAA21_NRT",    # VIIRS NOAA-21 Near Real-Time
    "MODIS_NRT",           # MODIS Near Real-Time
    "LANDSAT_NRT",         # Landsat Near Real-Time
]

# Turkey bounding box
TURKEY_BBOX = "25.66,35.82,44.83,42.11"

# Global bounding box
GLOBAL_BBOX = "-180,-90,180,90"


def get_active_fires(
    source: str = "VIIRS_SNPP_NRT",
    area: str = TURKEY_BBOX,
    days: int = 1,
    use_map_key: bool = True
) -> dict:
    """Fetch active fire data from NASA FIRMS.
    
    Args:
        source: FIRMS data source (VIIRS_SNPP_NRT, MODIS_NRT, etc.)
        area: Bounding box as 'west,south,east,north' or country code
        days: Number of days of data (1-10)
        use_map_key: Use MAP_KEY (True) or regular FIRMS_KEY (False)
    """
    key = FIRMS_MAP_KEY if use_map_key else FIRMS_KEY
    if not key:
        logger.warning("NASA FIRMS key not configured. Set NASA_FIRMS_MAP_KEY or NASA_FIRMS_KEY in environment.")
        return {"fires": [], "total": 0, "error": "No FIRMS API key configured"}
    
    try:
        url = f"{FIRMS_API_URL}/area/csv/{key}/{source}/{area}/{days}"
        resp = requests.get(url, timeout=30)
        
        if resp.status_code == 200:
            fires = _parse_firms_csv(resp.text)
            logger.info(f"NASA FIRMS: {len(fires)} fire detections from {source}")
            return {
                "fires": fires,
                "total": len(fires),
                "source": source,
                "area": area,
                "days": days,
                "fetched_at": datetime.utcnow().isoformat()
            }
        else:
            logger.warning(f"FIRMS API returned {resp.status_code}: {resp.text[:200]}")
            return {"fires": [], "total": 0, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"FIRMS fetch error: {e}")
        return {"fires": [], "total": 0, "error": str(e)}


def get_fires_all_sources(area: str = TURKEY_BBOX, days: int = 1) -> dict:
    """Fetch fire data from all available FIRMS sources."""
    all_fires = []
    results_by_source = {}
    
    for source in FIRMS_SOURCES:
        result = get_active_fires(source=source, area=area, days=days)
        results_by_source[source] = result.get("total", 0)
        all_fires.extend(result.get("fires", []))
    
    result = {
        "fires": all_fires,
        "total": len(all_fires),
        "by_source": results_by_source,
        "area": area,
        "days": days,
        "fetched_at": datetime.utcnow().isoformat()
    }
    with _data_lock:
        latest_data["nasa_fires"] = result
    if all_fires:
        _mark_fresh("nasa_fires")
    return result


def get_transaction_counts() -> dict:
    """Check remaining FIRMS API transaction counts."""
    key = FIRMS_MAP_KEY or FIRMS_KEY
    if not key:
        return {"error": "No FIRMS key configured"}
    
    try:
        url = f"{FIRMS_API_URL}/transaction/{key}"
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"error": str(e)}


def get_country_fires(country_code: str = "TUR", source: str = "VIIRS_SNPP_NRT", days: int = 1) -> dict:
    """Get fires for a specific country using ISO 3166 alpha-3 code.
    
    Common codes: TUR (Turkey), SYR (Syria), IRQ (Iraq), GRC (Greece),
    RUS (Russia), UKR (Ukraine), ISR (Israel), IRN (Iran)
    """
    return get_active_fires(source=source, area=country_code, days=days)


def _parse_firms_csv(csv_text: str) -> list:
    """Parse FIRMS CSV response into list of fire records."""
    fires = []
    lines = csv_text.strip().split("\n")
    if len(lines) < 2:
        return fires
    
    headers = [h.strip() for h in lines[0].split(",")]
    
    for line in lines[1:]:
        if not line.strip():
            continue
        values = line.split(",")
        if len(values) >= len(headers):
            fire = {headers[i]: values[i].strip() for i in range(len(headers))}
            fires.append(fire)
    
    return fires


def get_firms_map_tiles_url(source: str = "VIIRS_SNPP_NRT") -> dict:
    """Get FIRMS WMS/tile endpoint info for map visualization."""
    if not FIRMS_MAP_KEY:
        return {"error": "NASA_FIRMS_MAP_KEY not configured"}
    
    return {
        "wms_url": f"https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/{FIRMS_MAP_KEY}/",
        "source": source,
        "layers": ["fires_viirs_snpp", "fires_modis", "fires_viirs_noaa20"],
        "note": "Use as WMS layer in Leaflet/OpenLayers with MAP KEY"
    }
