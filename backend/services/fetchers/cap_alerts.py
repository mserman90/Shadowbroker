"""CAP (Common Alerting Protocol) feeds fetcher.
Aggregates OASIS CAP 1.2 emergency alerts from global public feeds.
No API key required — all public CAP feeds.
Ref: https://docs.oasis-open.org/emergency-adopt/cap-feeds/v1.0/cn02/
"""
import time
import logging
import xml.etree.ElementTree as ET
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

_last_fetch = 0
_FETCH_INTERVAL = 600  # 10 minutes

# Public CAP Atom/RSS feeds (OASIS-compliant, keyless)
CAP_FEEDS = [
    {"name": "NWS All Hazards (USA)",    "url": "https://alerts.weather.gov/cap/us.php?x=1",             "country": "US"},
    {"name": "USGS Earthquake Alerts",   "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom", "country": "Global"},
    {"name": "GDACS Global Disasters",   "url": "https://www.gdacs.org/xml/rss.xml",                    "country": "Global"},
    {"name": "Canada NAAD",              "url": "https://rss.naad-adna.pelmorex.com/",                   "country": "CA"},
    {"name": "ECMWF Severe Weather",     "url": "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe", "country": "Europe"},
    {"name": "JMA Japan Earthquake",     "url": "https://www.jma.go.jp/bosai/quake/data/list.json",     "country": "JP"},
    {"name": "AFAD Turkey Earthquakes",  "url": "https://deprem.afad.gov.tr/EventData/GetEventsByFilter", "country": "TR"},
]

CAP_NS = {
    "cap": "urn:oasis:names:tc:emergency:cap:1.2",
    "atom": "http://www.w3.org/2005/Atom",
}

def _parse_cap_atom(xml_text: str, source_name: str, country: str) -> list:
    """Parse a CAP Atom feed and extract alert records."""
    alerts = []
    try:
        root = ET.fromstring(xml_text)
        ns = "http://www.w3.org/2005/Atom"
        cap_ns = "urn:oasis:names:tc:emergency:cap:1.2"

        for entry in root.findall(f"{{{ns}}}entry"):
            try:
                title = entry.findtext(f"{{{ns}}}title", "")
                summary = entry.findtext(f"{{{ns}}}summary", "")
                published = entry.findtext(f"{{{ns}}}published", "")
                link_el = entry.find(f"{{{ns}}}link")
                url = link_el.get("href", "") if link_el is not None else ""

                # Try to extract polygon/circle from CAP content
                lat, lng = None, None
                polygon = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}area/{{{cap_ns}}}polygon", "")
                circle = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}area/{{{cap_ns}}}circle", "")
                geocode = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}area/{{{cap_ns}}}geocode/{{{cap_ns}}}value", "")

                if polygon:
                    # Take centroid of first polygon point pair
                    pts = polygon.strip().split()
                    if pts:
                        first = pts[0].split(",")
                        if len(first) == 2:
                            lat, lng = float(first[0]), float(first[1])
                elif circle:
                    parts = circle.split(" ")
                    if parts:
                        coords = parts[0].split(",")
                        if len(coords) == 2:
                            lat, lng = float(coords[0]), float(coords[1])

                severity = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}severity", "Unknown")
                urgency  = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}urgency", "")
                event    = entry.findtext(f"{{{cap_ns}}}info/{{{cap_ns}}}event", title)

                alerts.append({
                    "id": entry.findtext(f"{{{ns}}}id", ""),
                    "title": title,
                    "event": event,
                    "summary": summary[:300] if summary else "",
                    "severity": severity,
                    "urgency": urgency,
                    "published": published,
                    "url": url,
                    "lat": lat,
                    "lng": lng,
                    "country": country,
                    "source": source_name,
                    "type": "cap_alert",
                })
            except Exception as e:
                logger.debug(f"CAP entry parse error: {e}")
                continue
    except ET.ParseError as e:
        logger.debug(f"CAP XML parse error for {source_name}: {e}")
    return alerts


@with_retry(max_retries=1, base_delay=3)
def fetch_cap_alerts():
    """Fetch and aggregate CAP alerts from all configured feeds."""
    global _last_fetch
    now = time.time()
    if now - _last_fetch < _FETCH_INTERVAL:
        return

    all_alerts = []
    for feed in CAP_FEEDS:
        try:
            resp = fetch_with_curl(feed["url"], timeout=10)
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "")
                text = resp.text
                if "xml" in content_type or text.strip().startswith("<"):
                    alerts = _parse_cap_atom(text, feed["name"], feed["country"])
                    all_alerts.extend(alerts)
                    logger.debug(f"CAP {feed['name']}: {len(alerts)} alerts")
        except Exception as e:
            logger.debug(f"CAP feed {feed['name']} failed: {e}")
            continue

    # Filter: only alerts with geo coordinates for map display
    geo_alerts = [a for a in all_alerts if a["lat"] is not None and a["lng"] is not None]
    # All alerts (for news panel, no geo requirement)
    text_alerts = all_alerts

    _last_fetch = now
    logger.info(f"CAP Alerts: {len(all_alerts)} total, {len(geo_alerts)} with coordinates")

    with _data_lock:
        latest_data["cap_alerts"] = geo_alerts
        latest_data["cap_alerts_all"] = text_alerts
    if all_alerts:
        _mark_fresh("cap_alerts")
