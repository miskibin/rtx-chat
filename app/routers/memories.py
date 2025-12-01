from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger

from app.agent import conversation, USER_ID, create_memory, DEFAULT_MEMORY_MODEL

router = APIRouter(tags=["memories"])

class MemoryUpdate(BaseModel):
    text: str

def get_memory():
    if conversation.memory is None:
        conversation.memory = create_memory(DEFAULT_MEMORY_MODEL)
    return conversation.memory

@router.get("/memories")
async def list_memories():
    logger.info("Listing all memories")
    results = get_memory().get_all(user_id=USER_ID)
    return {"memories": results.get("results", [])}

@router.get("/memories/search")
async def search_memories(q: str):
    logger.info(f"Searching memories: {q}")
    results = get_memory().search(q, user_id=USER_ID, limit=10)
    return {"memories": results.get("results", [])}

@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, data: MemoryUpdate):
    logger.info(f"Updating memory {memory_id}: {data.text[:50]}...")
    get_memory().update(memory_id, data.text)
    return {"status": "updated"}

@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    logger.info(f"Deleting memory {memory_id}")
    get_memory().delete(memory_id)
    return {"status": "deleted"}
