import subprocess
import os
import sys
import uuid
import asyncio
from pathlib import Path
from langchain.tools import tool
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from loguru import logger

ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)

_conversation_summary = ""


def get_conversation_summary() -> str:
    return _conversation_summary


def set_conversation_summary(summary: str):
    global _conversation_summary
    _conversation_summary = summary


@tool
def run_python_code(code: str) -> str:
    """Execute Python code and return the output. Use for calculations, data processing, plotting charts.
    IMPORTANT FOR CHARTS: Save charts with plt.savefig('chart.png'). The chart will be AUTOMATICALLY displayed.
    """
    artifact_id = str(uuid.uuid4())[:8]
    work_dir = ARTIFACTS_DIR / artifact_id
    work_dir.mkdir(exist_ok=True)
    
    wrapped_code = f"import matplotlib;matplotlib.use('Agg')\n{code}"

    result = subprocess.run(
        [sys.executable, "-c", wrapped_code],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=work_dir,
    )
    output = result.stdout or ""
    if result.returncode != 0:
        output = f"Error: {result.stderr}"

    images = list(work_dir.glob("*.png")) + list(work_dir.glob("*.jpg")) + list(work_dir.glob("*.svg"))
    if images:
        image_paths = [f"http://localhost:8000/artifacts/{artifact_id}/{img.name}" for img in images]
        output += f"\n[ARTIFACTS:{','.join(image_paths)}]"

    return output or "Code executed successfully (no output)"


@tool
def read_file(path: str) -> str:
    """Read contents of a file from disk."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file on disk."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"File written: {path}"


@tool
def list_directory(path: str = ".") -> str:
    """List files and folders in a directory."""
    return "\n".join(os.listdir(path))


@tool
def create_summary(summary: str) -> str:
    """Create a summary of the conversation so far. Use when conversation is getting long (15+ messages)."""
    if len(summary) > 600:
        summary = summary[:600]
    set_conversation_summary(summary)
    logger.info(f"Conversation summary created: {summary[:100]}...")
    return f"Summary saved: {summary[:100]}..."


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


def get_tools():
    return [run_python_code, read_file, write_file, list_directory, create_summary, read_website]
