from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.global_settings import AppSettings, load_settings, update_settings

router = APIRouter(tags=["settings"])


class SettingsPatch(BaseModel):
    knowledge_min_similarity: float | None = Field(default=None, ge=0.0, le=1.0)
    memory_min_similarity: float | None = Field(default=None, ge=0.0, le=1.0)


@router.get("/settings")
def get_settings():
    settings = load_settings()
    return settings.model_dump()


@router.put("/settings")
def put_settings(patch: SettingsPatch):
    payload = {k: v for k, v in patch.model_dump().items() if v is not None}
    settings = update_settings(payload)
    return settings.model_dump()


