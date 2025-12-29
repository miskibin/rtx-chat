from loguru import logger

# Note: The create_summary tool has been removed.
# Context compression is now handled automatically by the ContextManager
# when context_compression is enabled for the agent.


def get_other_tools():
    """Return other utility tools. Currently empty as summarization is automatic."""
    return []
