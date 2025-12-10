from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
import uuid
import os
import ollama
from langchain_openai import ChatOpenAI
from loguru import logger

from app.graph_models import Conversation

router = APIRouter(tags=["conversations"])


class TitleRequest(BaseModel):
    user_message: str
    assistant_message: str = ""
    model: str = "qwen3:4b"


@router.post("/conversations/generate-title")
async def generate_title(data: TitleRequest):
    """Generate a short conversation title using LLM based on first exchange."""
    try:
        # Build context from both messages
        context = f"User: {data.user_message[:300]}"
        if data.assistant_message:
            context += f"\n\nAssistant: {data.assistant_message[:300]}"
        
        prompt = f"""Generate a very short title (3-5 words max) summarizing this conversation. Reply with ONLY the title, nothing else. No quotes, no punctuation at the end.

{context}"""
        
        messages = [{"role": "user", "content": prompt}]
        
        if data.model.startswith("grok"):
            # Use OpenAI-compatible API for Grok models
            llm = ChatOpenAI(
                model=data.model,
                api_key=os.getenv("LLM_API_KEY"),
                base_url=os.getenv("LLM_API_URL"),
                max_tokens=30,
            )
            response = llm.invoke(messages)
            title = response.content.strip().strip('"').strip("'")
        else:
            # Use Ollama for local models
            response = ollama.chat(
                model=data.model,
                messages=messages,
                options={"num_predict": 20}
            )
            title = response["message"]["content"].strip().strip('"').strip("'")
        
        # Fallback if title is too long or empty
        if not title or len(title) > 50:
            title = data.user_message[:30] + "..." if len(data.user_message) > 30 else data.user_message
        logger.info(f"Generated title: {title}")
        return {"title": title}
    except Exception as e:
        logger.error(f"Title generation failed: {e}")
        # Fallback to simple truncation
        title = data.user_message[:30] + "..." if len(data.user_message) > 30 else data.user_message
        return {"title": title}


class ConversationCreate(BaseModel):
    title: str
    messages: str  # JSON string
    mode: str = "psychological"
    model: str = "qwen3:4b"


class ConversationUpdate(BaseModel):
    title: str | None = None
    messages: str | None = None


@router.get("/conversations")
def list_conversations():
    """List all conversations (metadata only, without full messages)."""
    return {"conversations": Conversation.all_metadata()}


@router.post("/conversations")
def create_conversation(data: ConversationCreate):
    """Create a new conversation."""
    now = datetime.now().isoformat()
    conversation = Conversation(
        id=str(uuid.uuid4()),
        title=data.title,
        created_at=now,
        updated_at=now,
        messages=data.messages,
        mode=data.mode,
        model=data.model,
    )
    conversation.save()
    return {"id": conversation.id, "title": conversation.title}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str):
    """Get a full conversation including messages."""
    conversation = Conversation.get(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation.model_dump()


@router.put("/conversations/{conversation_id}")
def update_conversation(conversation_id: str, data: ConversationUpdate):
    """Update a conversation's title or messages."""
    conversation = Conversation.get(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if data.title is not None:
        conversation.title = data.title
    if data.messages is not None:
        conversation.messages = data.messages
    
    conversation.updated_at = datetime.now().isoformat()
    conversation.save()
    return {"success": True, "id": conversation_id}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    Conversation.delete(conversation_id)
    return {"success": True}
