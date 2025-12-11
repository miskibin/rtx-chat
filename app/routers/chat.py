from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import json
import re
import uuid
from loguru import logger

from app.schemas import ChatRequest
from app.agent import conversation, set_confirmation_result
from app.tools import get_tool_category

router = APIRouter(tags=["chat"])


class ConfirmRequest(BaseModel):
    tool_id: str
    approved: bool


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
                request.mode, 
                history
            ):
                if chunk["type"] == "memory_search_start":
                    yield {"data": json.dumps({"memory": "search", "status": "started", "query": chunk["query"]})}
                elif chunk["type"] == "memory_search_end":
                    yield {"data": json.dumps({"memory": "search", "status": "completed", "memories": chunk["memories"]})}
                elif chunk["type"] == "knowledge_search_start":
                    yield {"data": json.dumps({"knowledge": "search", "status": "started", "query": chunk["query"]})}
                elif chunk["type"] == "knowledge_search_end":
                    yield {"data": json.dumps({"knowledge": "search", "status": "completed", "chunks": chunk["chunks"]})}
                elif chunk["type"] == "thinking":
                    yield {"data": json.dumps({"thinking": chunk["content"]})}
                elif chunk["type"] == "content":
                    full_content += chunk["content"]
                    yield {"data": json.dumps({"content": chunk["content"]})}
                elif chunk["type"] == "tool_start":
                    tool_id = chunk.get("run_id", str(uuid.uuid4())[:8])
                    tool_name = chunk["name"]
                    category = get_tool_category(tool_name)
                    logger.info(f"Tool started: {tool_name} (id: {tool_id})")
                    yield {"data": json.dumps({"tool_call": tool_name, "status": "started", "input": chunk.get("input", {}), "tool_id": tool_id, "category": category})}
                elif chunk["type"] == "tool_end":
                    tool_id = chunk.get("run_id", "")
                    tool_name = chunk["name"]
                    category = get_tool_category(tool_name)
                    logger.info(f"Tool completed: {tool_name} (id: {tool_id})")
                    output = chunk["output"]
                    clean_output, artifacts = parse_artifacts(output)
                    yield {"data": json.dumps({"tool_call": tool_name, "status": "completed", "input": chunk.get("input", {}), "output": clean_output, "artifacts": artifacts, "tool_id": tool_id, "category": category})}
                elif chunk["type"] == "tool_confirmation_required":
                    tool_id = chunk.get("tool_id", "")
                    tool_name = chunk["name"]
                    category = get_tool_category(tool_name)
                    logger.info(f"Tool confirmation required: {tool_name} (id: {tool_id})")
                    yield {"data": json.dumps({"tool_call": tool_name, "status": "pending_confirmation", "input": chunk.get("input", {}), "tool_id": tool_id, "category": category})}
                elif chunk["type"] == "tool_denied":
                    tool_id = chunk.get("tool_id", "")
                    tool_name = chunk["name"]
                    category = get_tool_category(tool_name)
                    logger.info(f"Tool denied: {tool_name} (id: {tool_id})")
                    yield {"data": json.dumps({"tool_call": tool_name, "status": "denied", "tool_id": tool_id, "category": category})}
                elif chunk["type"] == "memories_saved":
                    logger.info(f"Memories saved: {chunk['memories']}")
                    yield {"data": json.dumps({"memories_saved": chunk["memories"]})}
                elif chunk["type"] == "metadata":
                    yield {"data": json.dumps({
                        "metadata": {
                            "elapsed_time": chunk["elapsed_time"],
                            "input_tokens": chunk["input_tokens"],
                            "output_tokens": chunk["output_tokens"],
                            "tokens_per_second": chunk["tokens_per_second"],
                        }
                    })}
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


@router.post("/chat/confirm")
async def confirm_tool(request: ConfirmRequest):
    logger.info(f"Tool confirmation: {request.tool_id} -> {'approved' if request.approved else 'denied'}")
    set_confirmation_result(request.tool_id, request.approved)
    return {"status": "confirmed", "tool_id": request.tool_id, "approved": request.approved}
