from fastapi import APIRouter
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(tags=["artifacts"])

ARTIFACTS_DIR = Path("artifacts")

@router.get("/artifacts/{artifact_id}/{filename}")
async def get_artifact(artifact_id: str, filename: str):
    file_path = ARTIFACTS_DIR / artifact_id / filename
    if not file_path.exists():
        return {"error": "Not found"}
    return FileResponse(file_path)
