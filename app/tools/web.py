import asyncio
from langchain.tools import tool
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode


@tool
def read_website(url: str) -> str:
    """Fetch and read content from a website URL. Returns clean markdown content."""
    async def crawl():
        browser_config = BrowserConfig(headless=True, java_script_enabled=True)
        run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=30000)
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
            return result.markdown.raw_markdown[:50000] if result.success else f"Error: {result.error_message}"
    return asyncio.run(crawl())


def get_web_tools():
    return [read_website]
