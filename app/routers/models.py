from fastapi import APIRouter
import ollama
from loguru import logger
import time
import os

from app.schemas import ModelsResponse, ModelInfo
from app.tools import get_tools, get_tools_by_category

router = APIRouter(tags=["models"])

# External API models config: prefix -> (api_key_env, base_url_env)
EXTERNAL_PROVIDERS = {
    "grok": ("LLM_API_KEY", "LLM_API_URL"),
    "gemini": ("GEMINI_API_KEY", "GEMINI_API_URL"),
    "deepseek": ("DEEPSEEK_API_KEY", "DEEPSEEK_API_URL"),
}

# External models: (name, context_length, parameters, family)
EXTERNAL_MODELS = [
    ("grok-4-1-fast-non-reasoning", 128000, "400B", "grok"),
    ("grok-4-1-fast-reasoning", 128000, "400B", "grok"),
    ("gemini-2.5-pro", 2000000, "Unknown", "gemini"),
    ("deepseek-chat", 128000, "685B", "deepseek"),
]

def get_provider_config(model_name: str) -> tuple[str, str] | None:
    """Get (api_key, base_url) for a model, or None if it's an Ollama model."""
    for prefix, (key_env, url_env) in EXTERNAL_PROVIDERS.items():
        if model_name.startswith(prefix):
            return os.getenv(key_env), os.getenv(url_env)
    return None

# In-memory cache for models (5 minute TTL)
_models_cache: list[ModelInfo] | None = None
_models_cache_time: float = 0
MODELS_CACHE_TTL = 300  # 5 minutes


def _fetch_models() -> list[ModelInfo]:
    """Fetch models from Ollama with capabilities."""
    logger.info("Fetching models from Ollama (cache miss)")
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
        
        if name:
            models.append(ModelInfo(
                name=name,
                context_length=8192,
                supports_tools="tools" in caps,
                supports_thinking="thinking" in caps,
                supports_vision="vision" in caps,
                parameters=params,
                family=family
            ))
    
    # Add external API models (all support tools and vision)
    for name, ctx, params, family in EXTERNAL_MODELS:
        models.append(ModelInfo(
            name=name,
            context_length=ctx,
            supports_tools=True,
            supports_thinking=True,
            supports_vision=True,
            parameters=params,
            family=family
        ))
    
    return models


def get_cached_models() -> list[ModelInfo]:
    """Get models from cache or fetch if stale."""
    global _models_cache, _models_cache_time
    
    now = time.time()
    if _models_cache is None or (now - _models_cache_time) > MODELS_CACHE_TTL:
        _models_cache = _fetch_models()
        _models_cache_time = now
    else:
        logger.debug("Returning cached models")
    
    return _models_cache


@router.get("/models", response_model=ModelsResponse)
async def list_models():
    models = get_cached_models()
    return ModelsResponse(models=models)

@router.get("/tools")
def list_tools():
    tools_by_category = get_tools_by_category()
    all_tools = []
    for category, data in tools_by_category.items():
        all_tools.extend(data["tools"])
    return {"tools": all_tools, "categories": tools_by_category}
