from mcp.server.fastmcp import FastMCP
from app.neo4j_client import (
    save_memory, get_relevant_memories, merge_person,
    list_people, list_memories, delete_memory
)

mcp = FastMCP("neo4j-memory")

@mcp.tool()
def save_memory_tool(type: str, summary: str, entities: list[str], importance: float, persistence: str) -> str:
    """Save memory to Neo4j graph. Types: event/preference/fact/goal/person. Persistence: short/medium/long"""
    mem_id = save_memory(type, summary, entities, importance, persistence)
    return f"Saved memory {mem_id}"

@mcp.tool()
def get_memories(user_message: str, top_k: int = 5) -> str:
    """Get relevant memories for user message using semantic search"""
    memories = get_relevant_memories(user_message, top_k)
    return "\n".join([f"[{m['type']}] {m['summary']} (importance:{m['importance']:.1f}) ID:{m['id']}" for m in memories])

@mcp.tool()
def merge_people(alias: str, canonical: str) -> str:
    """Merge duplicate person nodes (e.g., 'Alek' and 'Aleksander')"""
    return merge_person(alias, canonical)

@mcp.tool()
def get_people() -> str:
    """List all people in memory graph"""
    return str(list_people())

@mcp.tool()
def get_all_memories() -> str:
    """List all memories"""
    return str(list_memories())

@mcp.tool()
def remove_memory(id: str) -> str:
    """Delete memory by ID"""
    return delete_memory(id)
