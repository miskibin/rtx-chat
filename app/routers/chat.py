from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
import json
import re
from loguru import logger

from app.schemas import ChatRequest
from app.agent import conversation

router = APIRouter(tags=["chat"])

def parse_artifacts(output: str) -> tuple[str, list[str]]:
    match = re.search(r'\[ARTIFACTS:([^\]]+)\]', output)
    if match:
        artifacts = match.group(1).split(',')
        clean_output = output.replace(match.group(0), '').strip()
        return clean_output, artifacts
    return output, []

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
                    output = chunk["output"]
                    clean_output, artifacts = parse_artifacts(output)
                    yield {"data": json.dumps({"tool_call": chunk["name"], "status": "completed", "output": clean_output, "artifacts": artifacts})}
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

@router.get("/chat/settings")
async def get_settings():
    return {"memory_model": conversation.memory_model}

@router.post("/chat/settings")
async def update_settings(memory_model: str | None = None):
    if memory_model:
        conversation.set_memory_model(memory_model)
    return {"memory_model": conversation.memory_model}
