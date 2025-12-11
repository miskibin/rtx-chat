from app.tools.code import get_code_tools
from app.tools.filesystem import get_filesystem_tools
from app.tools.web import get_web_tools
from app.tools.memory import get_memory_tools
from app.tools.other import get_other_tools
from app.tools.knowledge import get_knowledge_tools

TOOL_CATEGORIES = {
    "code": {"label": "Code Execution", "getter": get_code_tools},
    "filesystem": {"label": "Filesystem", "getter": get_filesystem_tools},
    "web": {"label": "Web", "getter": get_web_tools},
    "memory": {"label": "Memory", "getter": get_memory_tools},
    "knowledge": {"label": "Knowledge Base", "getter": get_knowledge_tools},
    "other": {"label": "Other", "getter": get_other_tools},
}

_tool_category_cache: dict[str, str] = {}

def get_tool_category(tool_name: str) -> str:
    if not _tool_category_cache:
        for category, info in TOOL_CATEGORIES.items():
            for tool in info["getter"]():
                _tool_category_cache[tool.name] = category
    return _tool_category_cache.get(tool_name, "other")


def get_tools():
    tools = []
    for category_info in TOOL_CATEGORIES.values():
        tools.extend(category_info["getter"]())
    return tools


def get_tools_by_category():
    result = {}
    for category, category_info in TOOL_CATEGORIES.items():
        tools = category_info["getter"]()
        result[category] = {
            "label": category_info["label"],
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description or "No description",
                    "category": category
                }
                for tool in tools
            ]
        }
    return result

