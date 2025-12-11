from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.routers import chat, models, memories, artifacts, modes, conversations
from app.routers.modes import seed_templates, VARIABLES, ALL_TOOL_NAMES, TOOLS_BY_CATEGORY
from app.routers.models import get_cached_models
from app.graph_models import Mode, Conversation
from neo4j_mcp import kg_initialize_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Neo4j database...")
    kg_initialize_database()
    logger.info("Seeding mode templates...")
    seed_templates()
    yield


app = FastAPI(title="Ollama Chat API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(models.router)
app.include_router(memories.router)
app.include_router(artifacts.router)
app.include_router(modes.router)
app.include_router(conversations.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/init")
async def get_init_data():
    """Combined endpoint returning models, modes, and conversations for faster app initialization."""
    models_list = get_cached_models()
    modes_list = Mode.all()
    conversations_list = Conversation.all_metadata()
    
    return {
        "models": [m.model_dump() for m in models_list],
        "modes": [m.model_dump() for m in modes_list],
        "variables": VARIABLES,
        "all_tools": ALL_TOOL_NAMES,
        "tools_by_category": TOOLS_BY_CATEGORY,
        "conversations": conversations_list,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)