from fastapi import APIRouter
from pydantic import BaseModel
from app.agent import DEFAULT_PROMPT
from app.graph_models import Agent
from app.tools import get_tools, get_tools_by_category

router = APIRouter(tags=["agents"])

ALL_TOOL_NAMES = [t.name for t in get_tools()]
TOOLS_BY_CATEGORY = get_tools_by_category()

MEMORY_TOOLS = ["kg_retrieve_context", "kg_get_user_preferences", "kg_check_relationship", "add_or_update_person", "add_event", "add_fact", "add_preference", "add_or_update_relationship", "update_fact", "update_preference"]

TEMPLATES = {
    "minimal": {
        "prompt": """You are a helpful assistant.
Current date: {datetime}
{memories}
Be brief.""",
        "enabled_tools": [t for t in ALL_TOOL_NAMES if t not in MEMORY_TOOLS],
        "max_memories": 3,
        "max_tool_runs": 5,
    },
    "normal": {
        "prompt": DEFAULT_PROMPT,
        "enabled_tools": ALL_TOOL_NAMES,
        "max_memories": 5,
        "max_tool_runs": 10,
    },
    "psychological": {
        "prompt": """You are a compassionate psychological support assistant.
Current date and time: {datetime}

{user_preferences}

{memories}

Guidelines:
- Be warm, empathetic, and non-judgmental
- Ask thoughtful questions to understand deeper
- Validate emotions before offering perspectives

MEMORY MANAGEMENT:
Save CONCISE, KEY information - don't copy user's words verbatim.

CRITICAL RULES:
1. EXTRACT KEY INFO - summarize, don't quote literally
2. BE CONCISE - facts max 100 chars, events brief
3. SAVE MULTIPLE ITEMS - split different topics into separate saves
4. For relationship issues: use add_event + update person's sentiment

EXAMPLES:
❌ BAD: "User said Bob hurt him at work by taking credit for his project"
✅ GOOD: add_event("Bob took credit for my project", participants=["Bob"])

❌ BAD: add_fact("User owns a red Tesla Model 3 that he bought last year")
✅ GOOD: add_fact("Owns red Tesla Model 3", category="possession")

{known_people}

Save info immediately. NEVER mention saving in responses.""",
        "enabled_tools": ALL_TOOL_NAMES,
        "max_memories": 10,
        "max_tool_runs": 15,
    },
}

VARIABLES = [
    {"name": "{datetime}", "desc": "Current date/time"},
    {"name": "{memories}", "desc": "Retrieved relevant memories"},
    {"name": "{user_preferences}", "desc": "User preferences from memory"},
    {"name": "{known_people}", "desc": "List of known people"},
    {"name": "{agent_knowledge}", "desc": "Relevant knowledge from agent's knowledge base"},
]


def seed_templates():
    existing = {a.name for a in Agent.all()}
    for name, cfg in TEMPLATES.items():
        if name not in existing:
            Agent(name=name, prompt=cfg["prompt"], enabled_tools=cfg["enabled_tools"], max_memories=cfg["max_memories"], max_tool_runs=cfg["max_tool_runs"], is_template=True).save()


class AgentCreate(BaseModel):
    name: str
    prompt: str
    enabled_tools: list[str] = []
    max_memories: int = 5
    max_tool_runs: int = 10
    is_template: bool = False


@router.get("/agents")
def list_agents():
    return {"agents": [a.model_dump() for a in Agent.all()], "variables": VARIABLES, "all_tools": ALL_TOOL_NAMES, "tools_by_category": TOOLS_BY_CATEGORY}


@router.get("/agents/{name}")
def get_agent(name: str):
    agent = Agent.get(name)
    if not agent:
        return {"error": "Agent not found"}
    return agent.model_dump()


@router.post("/agents")
def create_agent(data: AgentCreate):
    missing = [v["name"] for v in VARIABLES[:2] if v["name"] not in data.prompt]
    warning = f"Missing recommended variables: {', '.join(missing)}" if missing else None
    Agent(**data.model_dump()).save()
    return {"success": True, "warning": warning}


@router.put("/agents/{name}")
def update_agent(name: str, data: AgentCreate):
    missing = [v["name"] for v in VARIABLES[:2] if v["name"] not in data.prompt]
    warning = f"Missing recommended variables: {', '.join(missing)}" if missing else None
    Agent(name=name, prompt=data.prompt, enabled_tools=data.enabled_tools, max_memories=data.max_memories, max_tool_runs=data.max_tool_runs, is_template=data.is_template).save()
    return {"success": True, "warning": warning}


@router.delete("/agents/{name}")
def delete_agent(name: str):
    Agent.delete(name)
    return {"success": True}




