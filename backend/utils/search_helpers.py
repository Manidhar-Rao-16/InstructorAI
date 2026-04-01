import urllib.parse
from duckduckgo_search import DDGS
import logging
import asyncio

logger = logging.getLogger("instructor_ai")

async def fetch_exact_youtube_link(query: str) -> str:
    """
    Fetches the exact first YouTube watch url for a given query.
    Falls back to a search query URL if it fails.
    """
    fallback_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
    try:
        # We run the synchronous DDGS in a thread to not block the event loop
        def _search():
            with DDGS() as ddgs:
                return list(ddgs.videos(query, max_results=1))
                
        results = await asyncio.to_thread(_search)
        if results and len(results) > 0 and 'content' in results[0]:
            return results[0]['content']
    except Exception as e:
        logger.error(f"Failed to fetch exact youtube link for {query}: {e}")
        
    return fallback_url

async def fetch_exact_doc_link(query: str) -> str:
    """
    Fetches the exact first Web document url for a given query.
    Falls back to a google search query URL if it fails.
    """
    fallback_url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"
    try:
        def _search():
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=1))
                
        results = await asyncio.to_thread(_search)
        if results and len(results) > 0 and 'href' in results[0]:
            return results[0]['href']
    except Exception as e:
        logger.error(f"Failed to fetch exact doc link for {query}: {e}")
        
    return fallback_url
