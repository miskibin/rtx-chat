from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger
import chromadb
from langchain_ollama import OllamaEmbeddings

router = APIRouter(tags=["memories"])

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

class MemoryUpdate(BaseModel):
    text: str

@router.get("/memories")
async def list_memories():
    logger.info("Listing all memories")
    collection, _ = _get_collection()
    results = collection.get()
    memories = []
    if results and results.get("ids"):
        for i, mem_id in enumerate(results["ids"]):
            memories.append({"id": mem_id, "memory": results["documents"][i]})
    return {"memories": memories}

@router.get("/memories/search")
async def search_memories(q: str):
    logger.info(f"Searching memories: {q}")
    collection, embeddings = _get_collection()
    embedding = embeddings.embed_query(q)
    results = collection.query(query_embeddings=[embedding], n_results=10)
    memories = []
    if results and results.get("ids") and results["ids"][0]:
        for i, mem_id in enumerate(results["ids"][0]):
            memories.append({"id": mem_id, "memory": results["documents"][0][i]})
    return {"memories": memories}

@router.get("/memories/preferences")
async def get_preference_memories():
    logger.info("Getting preference memories")
    collection, _ = _get_collection()
    results = collection.get(where={"type": "preference"})
    preferences = []
    if results and results.get("ids"):
        for i, _ in enumerate(results["ids"]):
            doc = results["documents"][i]
            clean = doc.replace("[preference]", "").strip()
            preferences.append(clean)
    return {"preferences": preferences}

@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, data: MemoryUpdate):
    logger.info(f"Updating memory {memory_id}: {data.text[:50]}...")
    collection, embeddings = _get_collection()
    embedding = embeddings.embed_query(data.text)
    collection.update(ids=[memory_id], documents=[data.text], embeddings=[embedding])
    return {"status": "updated"}

@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    logger.info(f"Deleting memory {memory_id}")
    collection, _ = _get_collection()
    collection.delete(ids=[memory_id])
    return {"status": "deleted"}
