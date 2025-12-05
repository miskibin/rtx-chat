from mcp.server.fastmcp import FastMCP
from app.neo4j_client import (
    save_memory,
    get_context_aware_memories,
    get_person_state,
    list_memories_raw,
    delete_memory,
    update_memory,
    list_people,
)

mcp = FastMCP("neo4j-memory")


@mcp.tool()
def remember(
    summary: str,
    type: str = "event",
    people: str = "",
    relationship: str = "RELATES_TO",
    importance: float = 0.7,
) -> str:
    """
    Save a memory to the knowledge graph.
    
    Args:
        summary: What to remember (short sentence)
        type: event, preference, fact, goal, or person
        people: Comma-separated names if memory involves people (e.g. "Alek, Ola")
        relationship: How memory relates to people (e.g. MET_WITH, HELPED_BY, DISCUSSED_WITH, ANNOYED_BY)
        importance: 0.0-1.0, higher = more important
    """
    entities = [p.strip() for p in people.split(",") if p.strip()]
    result = save_memory(type, summary, entities, importance, "medium", relationship)
    return f"Saved: {summary[:50]}..." if len(summary) > 50 else f"Saved: {summary}"


@mcp.tool()
def recall(query: str, limit: int = 5) -> str:
    """
    Retrieve relevant memories for a query. Automatically detects mentioned people.
    
    Args:
        query: What you want to know about
        limit: Max memories to return (default 5)
    """
    memories = get_context_aware_memories(query, top_k=limit)
    if not memories:
        return "No relevant memories found."
    
    lines = []
    for m in memories:
        lines.append(f"- {m['summary']}")
    return "\n".join(lines)


@mcp.tool()
def forget(memory_id: str) -> str:
    """
    Delete a memory by its ID.
    
    Args:
        memory_id: The ID of the memory to delete
    """
    if delete_memory(memory_id):
        return f"Deleted memory {memory_id}"
    return f"Memory {memory_id} not found"


@mcp.tool()
def update(memory_id: str, new_summary: str) -> str:
    """
    Update an existing memory with new content.
    
    Args:
        memory_id: The ID of the memory to update
        new_summary: The new content for the memory
    """
    if update_memory(memory_id, new_summary):
        return f"Updated memory {memory_id}"
    return f"Memory {memory_id} not found"


@mcp.tool()
def who_is(name: str) -> str:
    """
    Get everything known about a person.
    
    Args:
        name: Person's name (e.g. "Alek")
    """
    state = get_person_state(name)
    if not state or not state.get("name"):
        return f"No information about {name}"
    
    parts = [f"Name: {state['name']}"]
    if state.get("aliases"):
        parts.append(f"Also known as: {', '.join(state['aliases'])}")
    if state.get("summary"):
        parts.append(f"Summary: {state['summary']}")
    
    raw_mems = state.get("raw_memories", [])
    valid_mems = [m for m in raw_mems if m and m.get("summary")][:3]
    if valid_mems:
        parts.append("Recent memories:")
        for m in valid_mems:
            rel = m.get("relationship", "")
            parts.append(f"  [{rel}] {m['summary'][:60]}...")
    
    return "\n".join(parts)


@mcp.tool()
def get_people() -> str:
    """List all known people and how many memories involve them."""
    people = list_people()
    if not people:
        return "No people in memory."
    
    lines = []
    for p in people:
        name = p["name"]
        aliases = p.get("aliases") or []
        count = p.get("memory_count", 0)
        if aliases:
            lines.append(f"- {name} (aka {', '.join(aliases)}) - {count} memories")
        else:
            lines.append(f"- {name} - {count} memories")
    return "\n".join(lines)


@mcp.tool()
def list_all_memories() -> str:
    """List all memories with their IDs (for debugging/management)."""
    mems = list_memories_raw()
    if not mems:
        return "No memories stored."
    
    lines = []
    for m in mems[:20]:  # Limit to 20 to avoid overwhelming context
        lines.append(f"[{m.get('type', '?')}] {m.get('summary', '')[:50]}... (id: {m.get('id', '?')})")
    
    if len(mems) > 20:
        lines.append(f"... and {len(mems) - 20} more")
    
    return "\n".join(lines)
