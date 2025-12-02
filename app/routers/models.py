from fastapi import APIRouter
import ollama
from loguru import logger

from app.schemas import ModelsResponse, ModelInfo
from app.tools import get_tools

router = APIRouter(tags=["models"])

@router.get("/models", response_model=ModelsResponse)
async def list_models():
    logger.info("Fetching models from Ollama")
    response = ollama.list()
    models = []
    for m in response.models:
        name = m.model
        details = m.details or {}
        family = details.family or ""
        params = details.parameter_size or ""
        
        caps = []
        try:
            info = ollama.show(name)
            caps = info.capabilities or []
        except Exception as e:
            logger.warning(f"Could not get capabilities for {name}: {e}")
        
        supports_tools = "tools" in caps
        supports_thinking = "thinking" in caps
        supports_vision = "vision" in caps
        
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
        supports_thinking=False,
        supports_vision=False,
        parameters="400B",
        family="grok"
    ))
    
    return ModelsResponse(models=models)

@router.get("/tools")
async def list_tools():
    tools = get_tools()
    return {"tools": [{"name": t.name, "description": t.description} for t in tools]}
