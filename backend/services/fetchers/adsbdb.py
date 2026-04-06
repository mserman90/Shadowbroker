"""ADSBDB API Fetcher - Aircraft database search via RapidAPI (publicapi.dev/adsbdb-api).

Uses RAPIDAPI_KEY stored in environment variable for secure access.
Never hardcode API keys in source files.
"""
import os
import logging
import requests
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Load RapidAPI key from environment - NEVER hardcode
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")

ADSBDB_BASE_URL = "https://adsbdb.p.rapidapi.com/v1"
RAPIDAPI_HOST = "adsbdb.p.rapidapi.com"


def search_aircraft(
    query: str,
    category: Optional[str] = None,
    location: Optional[str] = None,
    limit: int = 20
) -> Dict[str, Any]:
    """Search aircraft database via ADSBDB API.
    
    Args:
        query: Search keyword (registration, type, operator, etc.)
        category: Optional category filter
        location: Optional location filter
        limit: Max results (default 20)
    
    Returns:
        Dict with aircraft list and metadata
    """
    if not RAPIDAPI_KEY:
        logger.warning("RAPIDAPI_KEY not configured. Set RAPIDAPI_KEY in environment.")
        return {
            "aircraft": [],
            "total": 0,
            "error": "RAPIDAPI_KEY not configured",
            "note": "Set RAPIDAPI_KEY env variable for ADSBDB access"
        }
    
    try:
        url = f"{ADSBDB_BASE_URL}/ads/search"
        
        params = {"q": query}
        if category:
            params["category"] = category
        if location:
            params["location"] = location
        
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST
        }
        
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        
        if resp.status_code == 200:
            data = resp.json()
            results = data if isinstance(data, list) else data.get("results", [])
            
            # Limit results
            results = results[:limit] if len(results) > limit else results
            
            logger.info(f"ADSBDB search '{query}': {len(results)} aircraft found")
            return {
                "aircraft": results,
                "total": len(results),
                "query": query,
                "category": category,
                "location": location,
                "source": "ADSBDB (RapidAPI)"
            }
        elif resp.status_code == 401:
            logger.error("ADSBDB API: Unauthorized (401) - check RAPIDAPI_KEY")
            return {
                "aircraft": [],
                "total": 0,
                "error": "Unauthorized - invalid or expired RAPIDAPI_KEY"
            }
        elif resp.status_code == 429:
            logger.warning("ADSBDB API: Rate limit exceeded (429)")
            return {
                "aircraft": [],
                "total": 0,
                "error": "Rate limit exceeded - try again later"
            }
        else:
            logger.warning(f"ADSBDB API returned {resp.status_code}: {resp.text[:200]}")
            return {
                "aircraft": [],
                "total": 0,
                "error": f"HTTP {resp.status_code}"
            }
    except Exception as e:
        logger.error(f"ADSBDB search error: {e}")
        return {
            "aircraft": [],
            "total": 0,
            "error": str(e)
        }


def get_aircraft_by_registration(registration: str) -> Dict[str, Any]:
    """Search for aircraft by registration (tail number).
    
    Args:
        registration: Aircraft registration (e.g., 'N12345', 'TC-JRO')
    """
    return search_aircraft(query=registration, limit=1)


def get_aircraft_by_type(aircraft_type: str, limit: int = 20) -> Dict[str, Any]:
    """Search for aircraft by type.
    
    Args:
        aircraft_type: Aircraft type (e.g., 'B777', 'A320', 'G650')
        limit: Max results
    """
    return search_aircraft(query=aircraft_type, limit=limit)


def get_aircraft_by_operator(operator: str, limit: int = 20) -> Dict[str, Any]:
    """Search for aircraft by operator/airline.
    
    Args:
        operator: Operator name (e.g., 'Turkish Airlines', 'Emirates')
        limit: Max results
    """
    return search_aircraft(query=operator, limit=limit)


def enrich_flight_data(icao_hex: Optional[str] = None, registration: Optional[str] = None) -> Dict[str, Any]:
    """Enrich live flight data with aircraft database info.
    
    Can search by ICAO hex code or registration.
    
    Args:
        icao_hex: ICAO 24-bit address (hex) from ADS-B
        registration: Aircraft registration
    """
    if not icao_hex and not registration:
        return {"error": "Provide either icao_hex or registration"}
    
    query = registration if registration else icao_hex
    result = search_aircraft(query=query, limit=1)
    
    if result.get("total", 0) > 0 and len(result.get("aircraft", [])) > 0:
        return result["aircraft"][0]
    
    return {"error": "Aircraft not found in database"}


def check_api_health() -> Dict[str, Any]:
    """Check if ADSBDB API is accessible and key is valid."""
    if not RAPIDAPI_KEY:
        return {
            "status": "no_key",
            "message": "RAPIDAPI_KEY not configured",
            "healthy": False
        }
    
    try:
        # Try a minimal search to test API access
        result = search_aircraft(query="test", limit=1)
        
        if "error" in result:
            if "Unauthorized" in result.get("error", ""):
                return {
                    "status": "invalid_key",
                    "message": "RAPIDAPI_KEY is invalid or expired",
                    "healthy": False
                }
            return {
                "status": "error",
                "message": result["error"],
                "healthy": False
            }
        
        return {
            "status": "ok",
            "message": "ADSBDB API accessible",
            "healthy": True
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "healthy": False
        }