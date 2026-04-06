"""ADSB Exchange API Fetcher - Flight tracking via RapidAPI

Uses RAPIDAPI_ADSB_KEY stored in environment variable for secure access.
Never hardcode API keys in source files.
"""
import os
import logging
import requests
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Load RapidAPI key from environment - NEVER hardcode
RAPIDAPI_KEY = os.getenv("RAPIDAPI_ADSB_KEY", "")
RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST", "adsbexchange-com1.p.rapidapi.com")
ADSBEXCHANGE_BASE_URL = f"https://{RAPIDAPI_HOST}/v2"


def search_flights(
    icao24: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    dist: Optional[int] = 25,
    limit: int = 50
) -> Dict[str, Any]:
    """Search flights via ADSB Exchange RapidAPI.
    
    Args:
        icao24: Aircraft ICAO24 address (hex code)
        lat: Latitude for area search
        lon: Longitude for area search
        dist: Distance radius in nm (default 25)
        limit: Max results (default 50)
    
    Returns:
        Dict with flight data and metadata
    """
    
    if not RAPIDAPI_KEY:
        logger.warning("RAPIDAPI_ADSB_KEY not configured. Set RAPIDAPI_ADSB_KEY in env.")
        return {
            "flights": [],
            "total": 0,
            "error": "RAPIDAPI_ADSB_KEY not configured.",
            "status": "missing_key"
        }

            headers = {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST
    }
    
    try:
        # Choose endpoint based on search type
        if icao24:
            url = f"{ADSBEXCHANGE_BASE_URL}/icao/{icao24}/"
        elif lat is not None and lon is not None:
            url = f"{ADSBEXCHANGE_BASE_URL}/lat/{lat}/lon/{lon}/dist/{dist}/"
        else:
            # Get all flights (use with caution - may be rate limited)
            url = f"{ADSBEXCHANGE_BASE_URL}/all/"
        
        logger.info(f"Fetching flights from: {url}")
        
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        
        # ADSB Exchange API returns aircraft in 'ac' field
        flights = data.get("ac", [])
        
        # Limit results
        limited_flights = flights[:limit] if len(flights) > limit else flights
        
        return {
            "flights": limited_flights,
            "total": len(flights),
            "returned": len(limited_flights),
            "status": "success",
            "api": "adsbexchange_rapidapi"
        }
                
    except requests.exceptions.RequestException as e:
        logger.error(f"ADSB Exchange API error: {e}")
        return {
            "flights": [],
            "total": 0,
            "error": str(e),
            "status": "api_error"
        }
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {
            "flights": [],
            "total": 0,
            "error": str(e),
            "status": "error"
        }


        def get_api_status() -> Dict[str, Any]:
    """Get ADSB Exchange API status and usage limits.
    
    Returns:
        Dict with API health status
    """
    if not RAPIDAPI_KEY:
        return {
            "api": "adsbexchange_rapidapi",
            "status": "not_configured",
            "message": "RAPIDAPI_ADSB_KEY not set in environment",
            "healthy": False
        }
    
    try:
        # Simple test call to check API health
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST
        }
        
        # Use a simple endpoint - get aircraft near equator
        test_url = f"{ADSBEXCHANGE_BASE_URL}/lat/0/lon/0/dist/1/"
        response = requests.get(test_url, headers=headers, timeout=10)
        
        # Check rate limit headers if available
        remaining = response.headers.get("X-RateLimit-Remaining", "Unknown")
        limit = response.headers.get("X-RateLimit-Limit", "Unknown")
        
        if response.status_code == 200:
            return {
                "api": "adsbexchange_rapidapi",
                "status": "healthy",
                "message": "API is operational",
                "healthy": True,
                "rate_limit": {
                    "remaining": remaining,
                    "limit": limit
                }
            }
        else:
            return {
                "api": "adsbexchange_rapidapi",
                "status": "error",
                "message": f"API returned status {response.status_code}",
                "healthy": False
            }
    
    except Exception as e:
        logger.error(f"API health check failed: {e}")
        return {
            "api": "adsbexchange_rapidapi",
            "status": "error",
            "message": str(e),
            "healthy": False
        }