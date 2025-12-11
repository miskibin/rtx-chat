"""Knowledge base router for uploading and managing mode-specific documents."""

import os
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, BackgroundTasks
from pydantic import BaseModel
from loguru import logger

from app.graph_models import KnowledgeDocument, KnowledgeChunk, Mode
from app.tools.knowledge import (
    process_document,
    extract_text_from_pdf,
    extract_text_from_image,
    fetch_url_content,
    KNOWLEDGE_FILES_DIR,
)

router = APIRouter(prefix="/modes/{mode_name}/knowledge", tags=["knowledge"])


class UrlUploadRequest(BaseModel):
    url: str
    enrich_with_llm: bool = True
    enrichment_model: str = "qwen3:4b"


class ProcessingStatus(BaseModel):
    status: str
    document_id: Optional[str] = None
    message: str
    chunk_count: int = 0


# Store processing status
_processing_status: dict[str, ProcessingStatus] = {}


def get_file_type(filename: str) -> str:
    """Determine document type from filename."""
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    if ext == "pdf":
        return "pdf"
    elif ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"):
        return "image"
    elif ext in ("txt", "md", "markdown", "rst", "json", "yaml", "yml", "csv"):
        return "text"
    return "text"  # Default to text


async def process_file_async(
    mode_name: str,
    file_path: Path,
    filename: str,
    doc_type: str,
    enrich_with_llm: bool,
    enrichment_model: str,
    task_id: str
):
    """Background task to process uploaded file."""
    try:
        _processing_status[task_id] = ProcessingStatus(
            status="processing",
            message=f"Extracting text from {filename}..."
        )
        
        # Extract text based on document type
        if doc_type == "pdf":
            content = await extract_text_from_pdf(file_path)
        elif doc_type == "image":
            content = await extract_text_from_image(file_path)
        else:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        
        if not content.strip():
            _processing_status[task_id] = ProcessingStatus(
                status="error",
                message="No text content could be extracted from the file"
            )
            return
        
        _processing_status[task_id] = ProcessingStatus(
            status="processing",
            message=f"Processing {len(content)} characters..."
        )
        
        # Process and store
        doc = await process_document(
            mode_name=mode_name,
            content=content,
            filename=filename,
            doc_type=doc_type,
            file_path=str(file_path),
            enrich_with_llm=enrich_with_llm,
            enrichment_model=enrichment_model
        )
        
        _processing_status[task_id] = ProcessingStatus(
            status="completed",
            document_id=doc.id,
            message=f"Successfully processed {filename}",
            chunk_count=doc.chunk_count
        )
        
    except Exception as e:
        logger.error(f"Error processing file {filename}: {e}")
        _processing_status[task_id] = ProcessingStatus(
            status="error",
            message=str(e)
        )


async def process_url_async(
    mode_name: str,
    url: str,
    enrich_with_llm: bool,
    enrichment_model: str,
    task_id: str
):
    """Background task to process URL."""
    try:
        _processing_status[task_id] = ProcessingStatus(
            status="processing",
            message=f"Fetching content from {url}..."
        )
        
        content = await fetch_url_content(url)
        
        if not content.strip() or content.startswith("Error:"):
            _processing_status[task_id] = ProcessingStatus(
                status="error",
                message=f"Failed to fetch URL: {content}"
            )
            return
        
        _processing_status[task_id] = ProcessingStatus(
            status="processing",
            message=f"Processing {len(content)} characters..."
        )
        
        # Extract filename from URL
        from urllib.parse import urlparse
        parsed = urlparse(url)
        filename = parsed.netloc + parsed.path.replace("/", "_")[:50]
        if not filename.endswith(".html"):
            filename += ".html"
        
        doc = await process_document(
            mode_name=mode_name,
            content=content,
            filename=filename,
            doc_type="url",
            source_url=url,
            enrich_with_llm=enrich_with_llm,
            enrichment_model=enrichment_model
        )
        
        _processing_status[task_id] = ProcessingStatus(
            status="completed",
            document_id=doc.id,
            message=f"Successfully processed URL",
            chunk_count=doc.chunk_count
        )
        
    except Exception as e:
        logger.error(f"Error processing URL {url}: {e}")
        _processing_status[task_id] = ProcessingStatus(
            status="error",
            message=str(e)
        )


@router.post("/upload")
async def upload_file(
    mode_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    enrich_with_llm: bool = Form(True),
    enrichment_model: str = Form("qwen3:4b")
):
    """Upload a file to the mode's knowledge base."""
    # Verify mode exists
    mode = Mode.get(mode_name)
    if not mode:
        raise HTTPException(status_code=404, detail=f"Mode '{mode_name}' not found")
    
    # Create storage directory
    mode_dir = KNOWLEDGE_FILES_DIR / mode_name
    mode_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine file type
    doc_type = get_file_type(file.filename or "unknown.txt")
    
    # Generate unique filename
    import uuid
    file_id = str(uuid.uuid4())[:8]
    safe_filename = f"{file_id}_{file.filename}"
    file_path = mode_dir / safe_filename
    
    # Save file
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # Generate task ID for tracking
    task_id = str(uuid.uuid4())
    _processing_status[task_id] = ProcessingStatus(
        status="queued",
        message="File uploaded, processing starting..."
    )
    
    # Process in background
    background_tasks.add_task(
        process_file_async,
        mode_name,
        file_path,
        file.filename or "unknown",
        doc_type,
        enrich_with_llm,
        enrichment_model,
        task_id
    )
    
    return {"task_id": task_id, "status": "queued", "filename": file.filename}


@router.post("/url")
async def upload_url(
    mode_name: str,
    request: UrlUploadRequest,
    background_tasks: BackgroundTasks
):
    """Add a URL to the mode's knowledge base."""
    # Verify mode exists
    mode = Mode.get(mode_name)
    if not mode:
        raise HTTPException(status_code=404, detail=f"Mode '{mode_name}' not found")
    
    # Generate task ID for tracking
    import uuid
    task_id = str(uuid.uuid4())
    _processing_status[task_id] = ProcessingStatus(
        status="queued",
        message="URL queued for processing..."
    )
    
    # Process in background
    background_tasks.add_task(
        process_url_async,
        mode_name,
        request.url,
        request.enrich_with_llm,
        request.enrichment_model,
        task_id
    )
    
    return {"task_id": task_id, "status": "queued", "url": request.url}


@router.get("/status/{task_id}")
async def get_processing_status(mode_name: str, task_id: str):
    """Get the status of a processing task."""
    status = _processing_status.get(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status.model_dump()


@router.get("")
async def list_documents(mode_name: str):
    """List all documents in the mode's knowledge base."""
    # Verify mode exists
    mode = Mode.get(mode_name)
    if not mode:
        raise HTTPException(status_code=404, detail=f"Mode '{mode_name}' not found")
    
    docs = KnowledgeDocument.get_by_mode(mode_name)
    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "doc_type": doc.doc_type,
                "source_url": doc.source_url,
                "chunk_count": doc.chunk_count,
                "created_at": doc.created_at
            }
            for doc in docs
        ]
    }


@router.get("/{doc_id}")
async def get_document(mode_name: str, doc_id: str):
    """Get details of a specific document including its chunks."""
    doc = KnowledgeDocument.get(doc_id)
    if not doc or doc.mode_name != mode_name:
        raise HTTPException(status_code=404, detail="Document not found")
    
    chunks = KnowledgeChunk.get_by_document(doc_id)
    
    return {
        "document": {
            "id": doc.id,
            "filename": doc.filename,
            "doc_type": doc.doc_type,
            "source_url": doc.source_url,
            "chunk_count": doc.chunk_count,
            "created_at": doc.created_at
        },
        "chunks": [
            {
                "index": c.chunk_index,
                "content": c.content[:200] + "..." if len(c.content) > 200 else c.content,
                "summary": c.summary,
                "topics": c.topics
            }
            for c in chunks
        ]
    }


@router.delete("/{doc_id}")
async def delete_document(mode_name: str, doc_id: str):
    """Delete a document and all its chunks from the knowledge base."""
    doc = KnowledgeDocument.get(doc_id)
    if not doc or doc.mode_name != mode_name:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete file if it exists
    if doc.file_path:
        file_path = Path(doc.file_path)
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception as e:
                logger.warning(f"Could not delete file {file_path}: {e}")
    
    # Delete from Neo4j
    KnowledgeDocument.delete(doc_id)
    
    return {"success": True, "message": f"Deleted document {doc.filename}"}
