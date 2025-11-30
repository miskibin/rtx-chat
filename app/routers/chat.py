from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
import json
from loguru import logger

from app.schemas import ChatRequest
from app.agent import conversation

router = APIRouter(tags=["chat"])

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    logger.info(f"Chat request: model={request.model}, message={request.message[:50]}...")
    conversation.set_model(request.model)
    
    async def event_generator():
        full_content = ""
        try:
            async for chunk in conversation.stream_response(request.message):
                if chunk["type"] == "memory_search_start":
                    yield {"data": json.dumps({"memory": "search", "status": "started", "query": chunk["query"]})}
                elif chunk["type"] == "memory_search_end":
                    yield {"data": json.dumps({"memory": "search", "status": "completed", "memories": chunk["memories"]})}
                elif chunk["type"] == "memory_save_start":
                    yield {"data": json.dumps({"memory": "save", "status": "started"})}
                elif chunk["type"] == "memory_save_end":
                    yield {"data": json.dumps({"memory": "save", "status": "completed", "memories": chunk["memories"]})}
                elif chunk["type"] == "thinking":
                    yield {"data": json.dumps({"thinking": chunk["content"]})}
                elif chunk["type"] == "content":
                    full_content += chunk["content"]
                    yield {"data": json.dumps({"content": chunk["content"]})}
                elif chunk["type"] == "tool_start":
                    logger.info(f"Tool started: {chunk['name']}")
                    yield {"data": json.dumps({"tool_call": chunk["name"], "status": "started", "input": chunk.get("input", {})})}
                elif chunk["type"] == "tool_end":
                    logger.info(f"Tool completed: {chunk['name']}")
                    yield {"data": json.dumps({"tool_call": chunk["name"], "status": "completed", "output": chunk["output"]})}
            logger.info(f"Response completed: {len(full_content)} chars")
            yield {"data": json.dumps({"done": True})}
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield {"data": json.dumps({"error": str(e)})}
    
    return EventSourceResponse(event_generator())

@router.post("/chat/clear")
async def clear_chat():
    logger.info("Clearing conversation")
    conversation.clear()
    return {"status": "cleared"}
