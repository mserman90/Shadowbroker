"""LiveATC Fetcher - ATC audio stream metadata for OSINT monitoring."""
import logging
from typing import Optional
from services.fetchers._store import latest_data, _data_lock, _mark_fresh

logger = logging.getLogger(__name__)

# Turkish ATC streams
TURKISH_STREAMS = [
    {"id": "ltba_app", "name": "Istanbul Ataturk Approach", "icao": "LTBA", "url": "https://www.liveatc.net/play/ltba_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltfj_app", "name": "Istanbul Sabiha Approach", "icao": "LTFJ", "url": "https://www.liveatc.net/play/ltfj_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltai_app", "name": "Antalya Approach", "icao": "LTAI", "url": "https://www.liveatc.net/play/ltai_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltac_app", "name": "Ankara Esenboga Approach", "icao": "LTAC", "url": "https://www.liveatc.net/play/ltac_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltag_app", "name": "Adana Sakirpasa Approach", "icao": "LTAG", "url": "https://www.liveatc.net/play/ltag_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltbs_app", "name": "Izmir Adnan Menderes Approach", "icao": "LTBS", "url": "https://www.liveatc.net/play/ltbs_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltfe_app", "name": "Gaziantep Oguzeli Approach", "icao": "LTFE", "url": "https://www.liveatc.net/play/ltfe_app.pls", "country": "Turkey", "type": "approach"},
    {"id": "ltbl_app", "name": "Izmir Cigli Military", "icao": "LTBL", "url": "https://www.liveatc.net/play/ltbl_app.pls", "country": "Turkey", "type": "military"},
]

# Global strategic ATC streams
GLOBAL_STREAMS = [
    {"id": "egll_app", "name": "London Heathrow Approach", "icao": "EGLL", "url": "https://www.liveatc.net/play/egll_app.pls", "country": "UK", "type": "approach"},
    {"id": "klax_app", "name": "Los Angeles Approach", "icao": "KLAX", "url": "https://www.liveatc.net/play/klax_app.pls", "country": "USA", "type": "approach"},
    {"id": "kjfk_app", "name": "New York JFK Approach", "icao": "KJFK", "url": "https://www.liveatc.net/play/kjfk_app.pls", "country": "USA", "type": "approach"},
    {"id": "omdb_app", "name": "Dubai International Approach", "icao": "OMDB", "url": "https://www.liveatc.net/play/omdb_app.pls", "country": "UAE", "type": "approach"},
    {"id": "llbg_app", "name": "Tel Aviv Ben Gurion Approach", "icao": "LLBG", "url": "https://www.liveatc.net/play/llbg_app.pls", "country": "Israel", "type": "approach"},
    {"id": "lemd_app", "name": "Madrid Barajas Approach", "icao": "LEMD", "url": "https://www.liveatc.net/play/lemd_app.pls", "country": "Spain", "type": "approach"},
    {"id": "lfpg_app", "name": "Paris CDG Approach", "icao": "LFPG", "url": "https://www.liveatc.net/play/lfpg_app.pls", "country": "France", "type": "approach"},
    {"id": "uuee_app", "name": "Moscow Sheremetyevo Approach", "icao": "UUEE", "url": "https://www.liveatc.net/play/uuee_app.pls", "country": "Russia", "type": "approach"},
    {"id": "zbaa_app", "name": "Beijing Capital Approach", "icao": "ZBAA", "url": "https://www.liveatc.net/play/zbaa_app.pls", "country": "China", "type": "approach"},
]

ALL_STREAMS = TURKISH_STREAMS + GLOBAL_STREAMS


def get_all_streams() -> list:
    """Return all configured ATC streams metadata."""
    return ALL_STREAMS


def get_streams_by_country(country: str) -> list:
    """Filter streams by country."""
    return [s for s in ALL_STREAMS if s["country"].lower() == country.lower()]


def get_streams_by_type(stream_type: str) -> list:
    """Filter streams by type (approach, military, ground, etc.)."""
    return [s for s in ALL_STREAMS if s["type"].lower() == stream_type.lower()]


def get_turkish_streams() -> list:
    """Return Turkish ATC streams only."""
    return TURKISH_STREAMS


def get_global_streams() -> list:
    """Return global strategic ATC streams."""
    return GLOBAL_STREAMS


def fetch_atc_stream_data(region: Optional[str] = None) -> dict:
    """Fetch ATC stream metadata for OSINT dashboard.
    
    Returns stream list with metadata. No key required - LiveATC is public.
    Audio streams are PLS playlist URLs pointing to MP3 streams.
    """
    try:
        if region and region.lower() == "turkey":
            streams = get_turkish_streams()
        elif region:
            streams = get_streams_by_country(region)
        else:
            streams = get_all_streams()
        
        result = {
            "streams": streams,
            "total": len(streams),
            "turkish_count": len(TURKISH_STREAMS),
            "global_count": len(GLOBAL_STREAMS),
            "source": "liveatc.net",
            "note": "PLS playlist URLs for MP3 audio streams - no API key required"
        }
        logger.info(f"LiveATC: {len(streams)} streams loaded")
        with _data_lock:
            latest_data["atc_streams"] = result
        _mark_fresh("atc_streams")
        return result
    except Exception as e:
        logger.error(f"LiveATC fetch error: {e}")
        return {"streams": [], "total": 0, "error": str(e)}


def get_stream_by_icao(icao: str) -> Optional[dict]:
    """Get a specific stream by ICAO airport code."""
    icao_upper = icao.upper()
    for stream in ALL_STREAMS:
        if stream["icao"] == icao_upper:
            return stream
    return None
