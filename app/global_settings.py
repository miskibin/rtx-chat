import json
from pathlib import Path

from pydantic import BaseModel, Field


class AppSettings(BaseModel):
    """Global settings applied across all modes."""

    knowledge_min_similarity: float = Field(default=0.7, ge=0.0, le=1.0)
    memory_min_similarity: float = Field(default=0.65, ge=0.0, le=1.0)


_SETTINGS_PATH = Path("data") / "app_settings.json"


def load_settings() -> AppSettings:
    """Load persisted settings from disk (or return defaults)."""
    try:
        if _SETTINGS_PATH.exists():
            data = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
            return AppSettings(**(data or {}))
    except Exception:
        # Fail safe: use defaults if file is corrupt/unreadable
        pass
    return AppSettings()


def save_settings(settings: AppSettings) -> None:
    """Persist settings to disk."""
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(json.dumps(settings.model_dump(), indent=2), encoding="utf-8")


def update_settings(patch: dict) -> AppSettings:
    """Update settings with a partial patch and persist."""
    current = load_settings()
    updated = current.model_copy(update=patch)
    save_settings(updated)
    return updated


