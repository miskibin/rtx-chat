import subprocess
import os
import sys
import uuid
from pathlib import Path
from langchain.tools import tool

ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)

@tool
def run_python_code(code: str) -> str:
    """Execute Python code and return the output. Use for calculations, data processing, plotting charts.
    IMPORTANT FOR CHARTS: Save charts with plt.savefig('chart.png'). The chart will be AUTOMATICALLY displayed to the user - you do NOT need to output any image links, markdown images, or 'click here' text. After the code runs, simply describe what the chart shows in plain text."""
    artifact_id = str(uuid.uuid4())[:8]
    work_dir = ARTIFACTS_DIR / artifact_id
    work_dir.mkdir(exist_ok=True)
    
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=work_dir
        )
        output = result.stdout or ""
        if result.returncode != 0:
            output = f"Error: {result.stderr}"
    except subprocess.TimeoutExpired:
        return "Error: Code execution timed out after 60 seconds. Try simplifying the code or reducing iterations."
    
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
    items = os.listdir(path)
    return "\n".join(items)


from mem0 import Memory
from loguru import logger

_memory_instance = None

def _get_memory():
    global _memory_instance
    if _memory_instance is None:
        config = {
            "llm": {"provider": "ollama", "config": {"model": "qwen3:1.7b", "temperature": 0, "max_tokens": 2000}},
            "embedder": {"provider": "ollama", "config": {"model": "embeddinggemma"}},
            "vector_store": {"provider": "chroma", "config": {"collection_name": "ollama_ui_memory", "path": "./memory_db"}}
        }
        _memory_instance = Memory.from_config(config)
    return _memory_instance

@tool
def save_memory(memory_text: str, memory_type: str = "general") -> str:
    """Save a focused fact about the user. Keep under 250 chars. One main fact per call.
    
    Args:
        memory_text: Focused fact (under 250 chars). One main event/fact per call.
        memory_type: One of: general, event, belief, preference, goal, challenge, emotion
    
    Returns:
        Confirmation of saved memory.
    """
    if len(memory_text) > 300:
        logger.warning(f"Memory too long ({len(memory_text)} chars), truncating: {memory_text[:50]}...")
        memory_text = memory_text[:300]
    
    mem = _get_memory()
    existing = mem.search(memory_text[:50], user_id="default_user", limit=3)
    if existing and existing.get("results"):
        for r in existing["results"]:
            if memory_text[:40].lower() in r["memory"].lower():
                logger.info(f"Duplicate memory skipped: {memory_text[:50]}")
                return f"Memory already exists (id: {r['id']})"
    
    full_text = f"[{memory_type}] {memory_text}" if memory_type != "general" else memory_text
    result = mem.add(full_text, user_id="default_user", infer=False)
    logger.info(f"Memory saved ({memory_type}): {memory_text[:100]}")
    mem_id = ""
    if result and "results" in result:
        for r in result["results"]:
            if r.get("event") == "ADD":
                mem_id = r.get("id", "")
                break
    return f"Memory saved (id: {mem_id}): {memory_text[:50]}..."

@tool  
def update_memory(memory_id: str, new_text: str) -> str:
    """Update an existing memory with new information.
    
    Args:
        memory_id: The ID of the memory to update (from retrieved memories).
        new_text: The updated information.
    
    Returns:
        Confirmation of updated memory.
    """
    mem = _get_memory()
    mem.update(memory_id, new_text)
    logger.info(f"Memory updated ({memory_id}): {new_text[:100]}")
    return f"Memory updated: {new_text[:50]}..."


_conversation_summary = ""

def get_conversation_summary() -> str:
    return _conversation_summary

def set_conversation_summary(summary: str):
    global _conversation_summary
    _conversation_summary = summary

@tool
def create_summary(summary: str) -> str:
    """Create a summary of the conversation so far. Use when conversation is getting long (15+ messages).
    This compresses the conversation history to save context window space.
    
    Args:
        summary: A concise summary of key points discussed so far (max 500 chars).
                 Include: main topics, user's emotional state, decisions made, action items.
    
    Returns:
        Confirmation that summary was saved.
    """
    if len(summary) > 600:
        summary = summary[:600]
    set_conversation_summary(summary)
    logger.info(f"Conversation summary created: {summary[:100]}...")
    return f"Summary saved. Previous messages will be compressed. Summary: {summary[:100]}..."

def get_tools():
    return [run_python_code, read_file, write_file, list_directory, save_memory, update_memory, create_summary]
