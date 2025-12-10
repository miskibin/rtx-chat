from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.routers import chat, models, memories, artifacts, modes, conversations
from neo4j_mcp import kg_initialize_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Neo4j database...")
    kg_initialize_database()
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)