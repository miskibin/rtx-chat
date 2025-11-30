from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger

from app.agent import conversation, USER_ID

router = APIRouter(tags=["memories"])

class MemoryUpdate(BaseModel):
    text: str

@router.get("/memories")
async def list_memories():
    logger.info("Listing all memories")
    results = conversation.memory.get_all(user_id=USER_ID)
    return {"memories": results.get("results", [])}

@router.get("/memories/search")
async def search_memories(q: str):
    logger.info(f"Searching memories: {q}")
    results = conversation.memory.search(q, user_id=USER_ID, limit=10)
    return {"memories": results.get("results", [])}

@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, data: MemoryUpdate):
    logger.info(f"Updating memory {memory_id}: {data.text[:50]}...")
    conversation.memory.update(memory_id, data.text)
    return {"status": "updated"}

@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    logger.info(f"Deleting memory {memory_id}")
    conversation.memory.delete(memory_id)
    return {"status": "deleted"}
