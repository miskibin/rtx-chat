from langchain.tools import tool
from loguru import logger

_conversation_summary = ""


def get_conversation_summary() -> str:
    return _conversation_summary


def set_conversation_summary(summary: str):
    global _conversation_summary
    _conversation_summary = summary


@tool
def create_summary(summary: str) -> str:
    """Create a summary of the conversation so far. Use when conversation is getting long (15+ messages)."""
    if len(summary) > 600:
        summary = summary[:600]
    set_conversation_summary(summary)
    logger.info(f"Conversation summary created: {summary[:100]}...")
    return f"Summary saved: {summary[:100]}..."


def get_other_tools():
    return [create_summary]
