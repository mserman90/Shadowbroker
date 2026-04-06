"""NASA EOSDIS / CMR Fetcher - Earth observing system data via NASA CMR and EOSDIS.

Uses NASA_EOSDIS_TOKEN (EDL JWT) stored in environment variable.
Never hardcode tokens in source files.
"""
import os
import logging
import requests
from datetime import datetime, timedelta
from typing import Optional
from services.fetchers._store import latest_data, _data_lock, _mark_fresh

logger = logging.getLogger(__name__)

# Load token from environment - NEVER hardcode
EOSDIS_TOKEN = os.getenv("NASA_EOSDIS_TOKEN", "")
NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")  # NASA Open APIs key

CMR_BASE = "https://cmr.earthdata.nasa.gov"
CMR_SEARCH = f"{CMR_BASE}/search"
APOD_URL = "https://api.nasa.gov/planetary/apod"
EARTH_IMAGERY_URL = "https://api.nasa.gov/planetary/earth/imagery"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
GIBS_WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi"

# NASA GIBS layer catalog for OSINT-relevant layers
GIBS_LAYERS = {
    "terra_fires": "MODIS_Terra_CorrectedReflectance_TrueColor",
    "aqua_fires": "MODIS_Aqua_CorrectedReflectance_TrueColor",
    "viirs_fires": "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    "sea_surface_temp": "GHRSST_L4_MUR_Sea_Surface_Temperature",
    "night_lights": "VIIRS_Black_Marble",
    "aerosol": "MODIS_Combined_Value_Added_AOD",
    "flood_water": "MODIS_Terra_Land_Surface_Temp_Day",
    "vegetation": "MODIS_Terra_NDVI_8Day",
    "snow_ice": "MODIS_Terra_Snow_Cover_Daily",
    "cloud_cover": "AIRS_L2_Cloud_Top_Height_Day",
}


def get_apod(date: Optional[str] = None) -> dict:
    """Get NASA Astronomy Picture of the Day.
    
    Works with DEMO_KEY (rate limited) or full API key.
    """
    try:
        params = {"api_key": NASA_API_KEY}
        if date:
            params["date"] = date
        resp = requests.get(APOD_URL, params=params, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"APOD fetch error: {e}")
        return {"error": str(e)}


def search_cmr_collections(keyword: str, limit: int = 10) -> dict:
    """Search NASA CMR for data collections by keyword.
    
    No auth required for public CMR search.
    """
    try:
        headers = {}
        if EOSDIS_TOKEN:
            headers["Authorization"] = f"Bearer {EOSDIS_TOKEN}"
        
        params = {
            "keyword": keyword,
            "page_size": limit,
            "options[keyword][pattern]": "true"
        }
        resp = requests.get(
            f"{CMR_SEARCH}/collections.json",
            params=params,
            headers=headers,
            timeout=20
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "collections": data.get("feed", {}).get("entry", []),
                "total": data.get("feed", {}).get("hits", 0)
            }
        return {"collections": [], "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"CMR search error: {e}")
        return {"collections": [], "error": str(e)}


def search_cmr_granules(
    short_name: str,
    bbox: Optional[str] = None,
    temporal: Optional[str] = None,
    limit: int = 20
) -> dict:
    """Search NASA CMR for data granules.
    
    Args:
        short_name: Dataset short name (e.g., 'MOD14' for MODIS fire)
        bbox: Bounding box 'west,south,east,north'
        temporal: Time range '2024-01-01T00:00:00Z,2024-01-02T00:00:00Z'
        limit: Max results
    """
    try:
        headers = {}
        if EOSDIS_TOKEN:
            headers["Authorization"] = f"Bearer {EOSDIS_TOKEN}"
        
        params = {"short_name": short_name, "page_size": limit}
        if bbox:
            params["bounding_box"] = bbox
        if temporal:
            params["temporal"] = temporal
        
        resp = requests.get(
            f"{CMR_SEARCH}/granules.json",
            params=params,
            headers=headers,
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "granules": data.get("feed", {}).get("entry", []),
                "total": data.get("feed", {}).get("hits", 0)
            }
        return {"granules": [], "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"CMR granule search error: {e}")
        return {"granules": [], "error": str(e)}


def get_earth_imagery(lat: float, lon: float, date: str, dim: float = 0.025) -> dict:
    """Get NASA Earth satellite imagery for a location.
    
    Args:
        lat: Latitude
        lon: Longitude  
        date: Date string YYYY-MM-DD
        dim: Width/height of image in degrees
    """
    try:
        params = {
            "lat": lat,
            "lon": lon,
            "date": date,
            "dim": dim,
            "api_key": NASA_API_KEY
        }
        resp = requests.get(EARTH_IMAGERY_URL, params=params, timeout=30)
        if resp.status_code == 200:
            return {"url": resp.url, "image_data": resp.content[:100], "content_type": resp.headers.get("content-type")}
        return {"error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"Earth imagery error: {e}")
        return {"error": str(e)}


def get_gibs_layer_info() -> dict:
    """Get available GIBS layers for OSINT dashboard map.
    
    GIBS (Global Imagery Browse Services) provides NASA satellite imagery
    as WMS/WMTS tiles. No API key required for public layers.
    """
    return {
        "layers": GIBS_LAYERS,
        "wms_url": GIBS_WMS,
        "wmts_url": GIBS_WMTS,
        "note": "Use GIBS WMS/WMTS in Leaflet for NASA satellite imagery overlay",
        "example_wms": f"{GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor"
    }


def get_modis_fire_hotspots(bbox: str = "25.66,35.82,44.83,42.11", days_back: int = 1) -> dict:
    """Get MODIS fire hotspot granules for a region via CMR."""
    end = datetime.utcnow()
    start = end - timedelta(days=days_back)
    temporal = f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')},{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    return search_cmr_granules("MOD14", bbox=bbox, temporal=temporal)


def get_viirs_night_lights(bbox: str = "25.66,35.82,44.83,42.11", days_back: int = 7) -> dict:
    """Get VIIRS Black Marble night light granules for OSINT activity monitoring."""
    end = datetime.utcnow()
    start = end - timedelta(days=days_back)
    temporal = f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')},{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    return search_cmr_granules("VNP46A1", bbox=bbox, temporal=temporal)


def fetch_eosdis_dashboard_data() -> dict:
    """Aggregate EOSDIS/GIBS data for the OSINT dashboard."""
    result = {
        "gibs_layers": get_gibs_layer_info(),
        "apod": get_apod(),
        "note": "Set NASA_EOSDIS_TOKEN for authenticated CMR granule access",
        "token_configured": bool(EOSDIS_TOKEN),
        "api_key_configured": NASA_API_KEY != "DEMO_KEY"
    }
    with _data_lock:
        latest_data["eosdis_data"] = result
    _mark_fresh("eosdis_data")
    return result
