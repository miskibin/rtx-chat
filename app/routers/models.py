from fastapi import APIRouter
import ollama
from loguru import logger

from app.schemas import ModelsResponse, ModelInfo
from app.tools import get_tools, get_tools_by_category

router = APIRouter(tags=["models"])

@router.get("/models", response_model=ModelsResponse)
async def list_models():
    logger.info("Fetching models from Ollama")
    response = ollama.list()
    models = []
    for m in response.models:
        name = m.model
        details = m.details or {}
        family = getattr(details, 'family', None) or ""
        params = getattr(details, 'parameter_size', None) or ""
        
        caps = []
        try:
            if name:
                info = ollama.show(name)
                caps = info.capabilities or []
        except Exception as e:
            logger.warning(f"Could not get capabilities for {name}: {e}")
        
        supports_tools = "tools" in caps
        supports_thinking = "thinking" in caps
        supports_vision = "vision" in caps
        
        if name:
            models.append(ModelInfo(
                name=name,
                context_length=8192,
                supports_tools=supports_tools,
                supports_thinking=supports_thinking,
                supports_vision=supports_vision,
                parameters=params,
                family=family
            ))
        logger.debug(f"Model {name}: tools={supports_tools}, thinking={supports_thinking}, vision={supports_vision}")
    
    models.append(ModelInfo(
        name="grok-4-1-fast-non-reasoning",
        context_length=128000,
        supports_tools=True,
        supports_thinking=True,
        supports_vision=True,
        parameters="400B",
        family="grok"
    ))
    
    models.append(ModelInfo(
        name="grok-4-1-fast-reasoning",
        context_length=128000,
        supports_tools=True,
        supports_thinking=True,
        supports_vision=True,
        parameters="400B",
        family="grok"
    ))
    
    models.append(ModelInfo(
        name="gemini-2.5-pro",
        context_length=2000000,
        supports_tools=True,
        supports_thinking=True,
        supports_vision=True,
        parameters="Unknown",
        family="gemini"
    ))
    
    return ModelsResponse(models=models)

@router.get("/tools")
def list_tools():
    tools_by_category = get_tools_by_category()
    all_tools = []
    for category, data in tools_by_category.items():
        all_tools.extend(data["tools"])
    return {"tools": all_tools, "categories": tools_by_category}
