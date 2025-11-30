from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.routers import chat, models, memories, artifacts

app = FastAPI(title="Ollama Chat API")

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

@app.on_event("startup")
async def startup():
    logger.info("Starting Ollama Chat API")

@app.get("/health")
async def health():
    return {"status": "ok"}
