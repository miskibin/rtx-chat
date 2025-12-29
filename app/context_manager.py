"""
Context Manager for hybrid history summarization.

Provides a sliding window + rolling summaries approach for managing
long conversations within LLM context limits.
"""

import json
from typing import Any
from loguru import logger
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage
import ollama
from app.routers.models import get_provider_config


def estimate_tokens(text: str) -> int:
    """
    Estimate token count for a string using chars/4 ratio.
    This is a fast approximation that works reasonably well for English text.
    """
    if not text:
        return 0
    return len(text) // 4


def count_message_tokens(messages: list[BaseMessage]) -> int:
    """Count total estimated tokens across all messages."""
    total = 0
    for msg in messages:
        if isinstance(msg.content, str):
            total += estimate_tokens(msg.content)
        elif isinstance(msg.content, list):
            # Multi-part content (e.g., with images)
            for part in msg.content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total += estimate_tokens(part.get("text", ""))
                elif isinstance(part, str):
                    total += estimate_tokens(part)
    return total


def get_message_text(msg: BaseMessage) -> str:
    """Extract text content from a message."""
    if isinstance(msg.content, str):
        return msg.content
    elif isinstance(msg.content, list):
        parts = []
        for part in msg.content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
            elif isinstance(part, str):
                parts.append(part)
        return " ".join(parts)
    return ""


class ContextManager:
    """
    Manages conversation context with sliding window and rolling summaries.
    
    When enabled:
    - Keeps recent messages (sliding window) in full detail
    - Summarizes older messages when context grows too large
    - Combines existing summaries with new summaries (rolling)
    
    When disabled:
    - Returns all messages as-is (no compression)
    """
    
    def __init__(
        self,
        enabled: bool = True,
        max_context_tokens: int = 6000,
        window_tokens: int = 2000,
        summary_model: str = "qwen3:4b"
    ):
        self.enabled = enabled
        self.max_context_tokens = max_context_tokens
        self.window_tokens = window_tokens
        self.summary_model = summary_model
    
    async def process(
        self,
        messages: list[BaseMessage],
        existing_summary: str = ""
    ) -> tuple[list[BaseMessage], dict[str, Any] | None]:
        """
        Process messages and compress if needed.
        
        Args:
            messages: List of conversation messages (first should be system message)
            existing_summary: Previously generated summary (if any)
        
        Returns:
            Tuple of (processed_messages, summary_event or None)
            
            If compression happened, summary_event contains:
            - type: "summary_generated"
            - summary: The generated summary text
            - messages_summarized: Count of messages that were summarized
            - tokens_before: Token count before compression
            - tokens_after: Token count after compression
        """
        if not self.enabled:
            logger.debug("Context compression disabled, returning all messages")
            return messages, None
        
        if len(messages) < 3:
            # Not enough messages to compress (system + at least 2 conversation messages)
            return messages, None
        
        total_tokens = count_message_tokens(messages)
        logger.info(f"Context tokens: {total_tokens}, threshold: {self.max_context_tokens}")
        
        # Check if we need to compress
        if total_tokens <= self.max_context_tokens:
            # If we have an existing summary, include it but don't generate new one
            if existing_summary:
                return self._inject_summary(messages, existing_summary), None
            return messages, None
        
        # Need to compress - find the split point for sliding window
        system_msg = messages[0] if messages else None
        conversation_msgs = messages[1:] if system_msg else messages
        
        # Calculate how many recent messages to keep in the window
        window_msgs = []
        window_tokens = 0
        
        # Work backwards to find messages for the sliding window
        for msg in reversed(conversation_msgs):
            msg_tokens = count_message_tokens([msg])
            if window_tokens + msg_tokens > self.window_tokens:
                break
            window_msgs.insert(0, msg)
            window_tokens += msg_tokens
        
        # Messages to summarize (everything not in the window)
        msgs_to_summarize = conversation_msgs[:len(conversation_msgs) - len(window_msgs)]
        
        if not msgs_to_summarize:
            # Nothing to summarize, window covers everything
            if existing_summary:
                return self._inject_summary(messages, existing_summary), None
            return messages, None
        
        logger.info(f"Compressing {len(msgs_to_summarize)} messages, keeping {len(window_msgs)} in window")
        
        # Generate summary of older messages
        new_summary = await self._generate_summary(msgs_to_summarize, existing_summary)
        
        # Build compressed message list
        compressed = self._inject_summary(
            [system_msg] + window_msgs if system_msg else window_msgs,
            new_summary
        )
        
        tokens_after = count_message_tokens(compressed)
        tokens_saved = total_tokens - tokens_after
        
        summary_event = {
            "type": "summary_generated",
            "summary": new_summary,
            "messages_summarized": len(msgs_to_summarize),
            "tokens_before": total_tokens,
            "tokens_after": tokens_after,
            "tokens_saved": tokens_saved
        }
        
        logger.info(f"Compression complete: {total_tokens} -> {tokens_after} tokens (saved {tokens_saved})")
        
        return compressed, summary_event
    
    def _inject_summary(
        self,
        messages: list[BaseMessage],
        summary: str
    ) -> list[BaseMessage]:
        """Inject a summary message after the system message."""
        if not summary or not messages:
            return messages
        
        summary_msg = SystemMessage(
            content=f"[CONVERSATION SUMMARY - Earlier messages have been summarized]\n{summary}"
        )
        
        # Insert after system message if present
        if messages and isinstance(messages[0], SystemMessage):
            return [messages[0], summary_msg] + messages[1:]
        else:
            return [summary_msg] + messages
    
    async def _generate_summary(
        self,
        messages: list[BaseMessage],
        existing_summary: str = ""
    ) -> str:
        """Generate a summary of the given messages, incorporating existing summary."""
        
        # Format messages for summarization
        formatted = []
        for msg in messages:
            role = "User" if isinstance(msg, HumanMessage) else "Assistant"
            text = get_message_text(msg)
            if text:
                formatted.append(f"{role}: {text[:500]}")  # Truncate long messages
        
        messages_text = "\n".join(formatted)
        
        # Build prompt
        if existing_summary:
            prompt = f"""You are summarizing a conversation. There is an existing summary of earlier messages, and new messages to incorporate.

EXISTING SUMMARY:
{existing_summary}

NEW MESSAGES TO INCORPORATE:
{messages_text}

Create a unified, coherent summary that combines the existing summary with the key points from the new messages. Focus on:
- Main topics discussed
- Key decisions or conclusions
- Important context for continuing the conversation

Keep the summary concise (max 300 words). Write in third person ("The user discussed...", "The assistant explained...").

UNIFIED SUMMARY:"""
        else:
            prompt = f"""Summarize this conversation excerpt concisely. Focus on:
- Main topics discussed
- Key decisions or conclusions  
- Important context for continuing the conversation

MESSAGES:
{messages_text}

Keep the summary concise (max 200 words). Write in third person ("The user discussed...", "The assistant explained...").

SUMMARY:"""
        
        try:
            provider_config = get_provider_config(self.summary_model)
            
            if provider_config:
                # Use OpenAI-compatible API for external models
                from openai import OpenAI
                api_key, base_url = provider_config
                client = OpenAI(api_key=api_key, base_url=base_url)
                
                response = client.chat.completions.create(
                    model=self.summary_model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=400
                )
                summary = response.choices[0].message.content.strip()
            else:
                # Use Ollama for local models
                response = ollama.chat(
                    model=self.summary_model,
                    messages=[{"role": "user", "content": prompt}],
                    options={"num_predict": 400}
                )
                summary = response.message.content.strip()
            
            logger.info(f"Generated summary: {summary[:100]}...")
            return summary
        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")
            # Fallback: create a simple summary
            return existing_summary or "Previous conversation context not available."

