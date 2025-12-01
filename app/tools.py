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


from loguru import logger
import chromadb
from langchain_ollama import OllamaEmbeddings

_chroma_client = None
_collection = None
_embeddings = None

def _get_collection():
    global _chroma_client, _collection, _embeddings
    if _collection is None:
        _chroma_client = chromadb.PersistentClient(path="./memory_db_direct")
        _collection = _chroma_client.get_or_create_collection("memories")
        _embeddings = OllamaEmbeddings(model="embeddinggemma")
    return _collection, _embeddings

@tool
def save_memory(memory_text: str, memory_type: str = "general") -> str:
    """Save NEW information about the user. If similar memory exists, you'll get its ID to update instead.
    
    Args:
        memory_text: Focused fact (under 250 chars). One main fact per call.
        memory_type: One of: general, event, belief, preference (chat interaction style), goal, challenge, emotion
    
    Returns:
        Success message OR duplicate warning with ID to use with update_memory.
    """
    if len(memory_text) > 300:
        logger.warning(f"Memory too long ({len(memory_text)} chars), truncating: {memory_text[:50]}...")
        memory_text = memory_text[:300]
    
    collection, embeddings = _get_collection()
    
    embedding = embeddings.embed_query(memory_text)
    existing = collection.query(query_embeddings=[embedding], n_results=3)
    if existing and existing.get("documents") and existing["documents"][0]:
        for i, doc in enumerate(existing["documents"][0]):
            distance = existing["distances"][0][i] if existing.get("distances") else 1.0
            if distance < 0.3:
                existing_id = existing["ids"][0][i]
                logger.info(f"Duplicate memory found (distance={distance:.2f}): {memory_text[:50]}")
                return f"DUPLICATE: Memory already exists with id={existing_id}. Use update_memory('{existing_id}', 'new text') to update it. Existing: {doc[:80]}"
    
    full_text = f"[{memory_type}] {memory_text}" if memory_type != "general" else memory_text
    mem_id = str(uuid.uuid4())[:8]
    collection.add(
        ids=[mem_id],
        documents=[full_text],
        embeddings=[embedding],
        metadatas=[{"type": memory_type, "user_id": "default_user"}]
    )
    logger.info(f"Memory saved ({memory_type}): {memory_text[:100]}")
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
    collection, embeddings = _get_collection()
    embedding = embeddings.embed_query(new_text)
    collection.update(ids=[memory_id], documents=[new_text], embeddings=[embedding])
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
