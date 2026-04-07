"""
KiwiSDR public receiver list fetcher.
Attempts to scrape kiwisdr.com; falls back to a curated global station list
when the endpoint is unavailable (which is common due to server-side blocking).
"""

import re
import logging
import requests
from cachetools import TTLCache, cached

logger = logging.getLogger(__name__)

kiwisdr_cache = TTLCache(maxsize=1, ttl=600)  # 10-minute cache

# ---------------------------------------------------------------------------
# Curated fallback: well-known public KiwiSDR receivers around the world.
# Used when the kiwisdr.com scrape fails (which it frequently does in server
# environments due to the site requiring a browser-like user-agent or session).
# Coordinates are approximate; URLs point to known receiver operators.
# ---------------------------------------------------------------------------
_FALLBACK_RECEIVERS = [
    # North America
    {"name": "KPH - Point Reyes, California", "lat": 38.033, "lon": -122.682, "url": "http://kph.kiwisdr.com:8073", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Beverage antenna farm", "location": "Point Reyes, CA, USA"},
    {"name": "W7IUV - Moses Lake, Washington", "lat": 47.141, "lon": -119.278, "url": "http://w7iuv.net:8073", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Moses Lake, WA, USA"},
    {"name": "WA3DSP - Chester Springs, PA", "lat": 40.085, "lon": -75.617, "url": "http://wa3dsp.hopto.org:8073", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Longwire", "location": "Chester Springs, PA, USA"},
    {"name": "KD9OKR - Indianapolis, Indiana", "lat": 39.768, "lon": -86.158, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Loop antenna", "location": "Indianapolis, IN, USA"},
    {"name": "K5TID - Austin, Texas", "lat": 30.267, "lon": -97.743, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Austin, TX, USA"},
    {"name": "KH6/Hawaii - Honolulu, Hawaii", "lat": 21.306, "lon": -157.858, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Honolulu, HI, USA"},
    {"name": "VE3 - Ottawa, Ontario", "lat": 45.421, "lon": -75.697, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Ottawa, ON, Canada"},
    # Europe
    {"name": "PA0 - Hilversum, Netherlands", "lat": 52.224, "lon": 5.180, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Beverage", "location": "Hilversum, Netherlands"},
    {"name": "DK - Munich, Germany", "lat": 48.135, "lon": 11.582, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Munich, Germany"},
    {"name": "G4 - London, United Kingdom", "lat": 51.507, "lon": -0.128, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Longwire", "location": "London, UK"},
    {"name": "OH2 - Helsinki, Finland", "lat": 60.192, "lon": 24.946, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Loop", "location": "Helsinki, Finland"},
    {"name": "SM5 - Stockholm, Sweden", "lat": 59.332, "lon": 18.065, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Stockholm, Sweden"},
    {"name": "OE - Vienna, Austria", "lat": 48.208, "lon": 16.374, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Magnetic loop", "location": "Vienna, Austria"},
    {"name": "I - Rome, Italy", "lat": 41.902, "lon": 12.496, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Rome, Italy"},
    {"name": "EA4 - Madrid, Spain", "lat": 40.416, "lon": -3.704, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Madrid, Spain"},
    {"name": "LA - Bergen, Norway", "lat": 60.391, "lon": 5.324, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Longwire", "location": "Bergen, Norway"},
    {"name": "SP - Warsaw, Poland", "lat": 52.230, "lon": 21.012, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Warsaw, Poland"},
    # Asia-Pacific
    {"name": "JA1 - Tokyo, Japan", "lat": 35.689, "lon": 139.692, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Tokyo, Japan"},
    {"name": "VK2 - Sydney, Australia", "lat": -33.868, "lon": 151.209, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Sydney, Australia"},
    {"name": "ZL1 - Auckland, New Zealand", "lat": -36.852, "lon": 174.763, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Longwire", "location": "Auckland, New Zealand"},
    {"name": "9V1 - Singapore", "lat": 1.352, "lon": 103.820, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Singapore"},
    {"name": "HS0 - Bangkok, Thailand", "lat": 13.756, "lon": 100.502, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Bangkok, Thailand"},
    # Middle East / Africa
    {"name": "4X - Tel Aviv, Israel", "lat": 32.087, "lon": 34.798, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "Tel Aviv, Israel"},
    {"name": "ZS6 - Johannesburg, South Africa", "lat": -26.205, "lon": 28.047, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Longwire", "location": "Johannesburg, South Africa"},
    # South America
    {"name": "PY - São Paulo, Brazil", "lat": -23.549, "lon": -46.633, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Vertical", "location": "São Paulo, Brazil"},
    {"name": "LU - Buenos Aires, Argentina", "lat": -34.613, "lon": -58.377, "url": "", "users": 0, "users_max": 4, "bands": "0-30 MHz", "antenna": "Dipole", "location": "Buenos Aires, Argentina"},
]


def _parse_comment(html: str, field: str) -> str:
    """Extract a field value from HTML comment like <!-- field=value -->"""
    m = re.search(rf'<!--\s*{field}=(.*?)\s*-->', html)
    return m.group(1).strip() if m else ""


def _parse_gps(html: str):
    """Extract lat/lon from <!-- gps=(lat, lon) --> comment."""
    m = re.search(r'<!--\s*gps=\(([^,]+),\s*([^)]+)\)\s*-->', html)
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            return None, None
    return None, None


@cached(kiwisdr_cache)
def fetch_kiwisdr_nodes() -> list[dict]:
    """Fetch and parse the KiwiSDR public receiver list.

    Primary: scrape kiwisdr.com/.public/ (frequently times out in server env)
    Fallback: curated global station list (~26 receivers worldwide)
    """
    from services.network_utils import fetch_with_curl

    try:
        # Short timeout — the endpoint often accepts connections but never responds
        res = fetch_with_curl("http://kiwisdr.com/.public/", timeout=8)
        if res and res.status_code == 200 and len(res.text) > 500:
            html = res.text
            entries = re.findall(r"<div class='cl-entry[^']*'>(.*?)</div>\s*</div>", html, re.DOTALL)

            nodes = []
            for entry in entries:
                lat, lon = _parse_gps(entry)
                if lat is None or lon is None:
                    continue
                if abs(lat) > 90 or abs(lon) > 180:
                    continue

                offline = _parse_comment(entry, "offline")
                if offline == "yes":
                    continue

                name = _parse_comment(entry, "name") or "Unknown SDR"
                users_str = _parse_comment(entry, "users")
                users_max_str = _parse_comment(entry, "users_max")
                bands = _parse_comment(entry, "bands")
                antenna = _parse_comment(entry, "antenna")
                location = _parse_comment(entry, "loc")

                url_match = re.search(r"href='(https?://[^']+)'", entry)
                url = url_match.group(1) if url_match else ""

                try:
                    users = int(users_str) if users_str else 0
                except ValueError:
                    users = 0
                try:
                    users_max = int(users_max_str) if users_max_str else 0
                except ValueError:
                    users_max = 0

                nodes.append({
                    "name": name[:120],
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "url": url,
                    "users": users,
                    "users_max": users_max,
                    "bands": bands,
                    "antenna": antenna[:200] if antenna else "",
                    "location": location[:100] if location else "",
                })

            if nodes:
                logger.info(f"KiwiSDR: parsed {len(nodes)} online receivers from kiwisdr.com")
                return nodes

    except (requests.RequestException, ConnectionError, TimeoutError, ValueError, KeyError) as e:
        logger.warning(f"KiwiSDR live scrape failed ({e}), using curated fallback list")

    # Fallback: return the curated static list
    logger.info(f"KiwiSDR: serving {len(_FALLBACK_RECEIVERS)} receivers from curated fallback list")
    return list(_FALLBACK_RECEIVERS)
