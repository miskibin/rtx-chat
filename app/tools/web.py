import asyncio
import concurrent.futures
import re
import httpx
from bs4 import BeautifulSoup
from langchain.tools import tool
from markdownify import markdownify as md
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode


def _run_crawler_sync(url: str) -> str:
    """Run crawler in a new event loop (for Windows subprocess compatibility)."""
    async def _crawl():
        browser_config = BrowserConfig(headless=True, java_script_enabled=True)
        run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=30000)
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
            return result.markdown.raw_markdown[:50000] if result.success else f"Error: {result.error_message}"
    
    return asyncio.run(_crawl())


def _clean_html(html: str) -> str:
    """Remove scripts, styles, and other junk from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # Remove unwanted tags completely (including contents)
    for tag in soup.find_all(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 
                              'nav', 'footer', 'header', 'aside', 'form', 'button']):
        tag.decompose()
    
    # Remove comments
    from bs4 import Comment
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()
    
    # Remove common ad/tracking divs by class/id patterns
    for el in soup.find_all(attrs={"class": re.compile(r'(ad-|ads-|advert|cookie|popup|modal|sidebar|widget|share|social)', re.I)}):
        el.decompose()
    for el in soup.find_all(attrs={"id": re.compile(r'(ad-|ads-|advert|cookie|popup|modal|sidebar)', re.I)}):
        el.decompose()
    
    return str(soup)


@tool
async def read_website(url: str) -> str:
    """Fetch and read content from a website URL. Returns clean markdown content. Fast HTTP-based fetching."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            response.raise_for_status()
            clean_html = _clean_html(response.text)
            markdown_content = md(clean_html)
            # Clean up excessive whitespace
            markdown_content = re.sub(r'\n{3,}', '\n\n', markdown_content)
            return markdown_content.strip()[:50000]
    except Exception as e:
        return f"Error: {str(e)}"


@tool
async def read_website_js(url: str) -> str:
    """Fetch website with JavaScript rendering (slower, use only for JS-heavy sites like SPAs)."""
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as executor:
        result = await loop.run_in_executor(executor, _run_crawler_sync, url)
    return result


def get_web_tools():
    return [read_website, read_website_js]
