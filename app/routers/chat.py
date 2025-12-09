from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
import json
import re
import uuid
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
    conversation.set_model(request.model)
    conversation.set_settings(request.max_tool_runs, request.max_memories, request.enabled_tools)
    
    async def event_generator():
        full_content = ""
        try:
            history = [m.model_dump() for m in request.messages] if request.messages else None
            
            logger.info(f"Request message: {request.message[:100]}")
            if history:
                logger.info(f"History length: {len(history)}")
                for i, h in enumerate(history):
                    has_attachments = bool(h.get("experimental_attachments"))
                    logger.info(f"  History[{i}]: role={h.get('role')}, has_attachments={has_attachments}, content={h.get('content', '')[:50]}")
                    if has_attachments:
                        logger.info(f"    Attachments: {len(h['experimental_attachments'])} items")
            
            async for chunk in conversation.stream_response(
                request.message, 
                request.system_prompt, 
                history
            ):
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
                    tool_id = chunk.get("run_id", str(uuid.uuid4())[:8])
                    logger.info(f"Tool started: {chunk['name']} (id: {tool_id})")
                    yield {"data": json.dumps({"tool_call": chunk["name"], "status": "started", "input": chunk.get("input", {}), "tool_id": tool_id})}
                elif chunk["type"] == "tool_end":
                    tool_id = chunk.get("run_id", "")
                    logger.info(f"Tool completed: {chunk['name']} (id: {tool_id})")
                    output = chunk["output"]
                    clean_output, artifacts = parse_artifacts(output)
                    yield {"data": json.dumps({"tool_call": chunk["name"], "status": "completed", "input": chunk.get("input", {}), "output": clean_output, "artifacts": artifacts, "tool_id": tool_id})}
                elif chunk["type"] == "memories_saved":
                    logger.info(f"Memories saved: {chunk['memories']}")
                    yield {"data": json.dumps({"memories_saved": chunk["memories"]})}
                elif chunk["type"] == "error":
                    logger.warning(f"Non-fatal error: {chunk['message']}")
                    yield {"data": json.dumps({"content": chunk["message"]})}
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
