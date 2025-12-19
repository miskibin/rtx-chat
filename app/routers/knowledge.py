"""Knowledge base router for uploading and managing agent-specific documents.

Supports: .txt, .md, .pdf files only.
"""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, BackgroundTasks
from pydantic import BaseModel
from loguru import logger

from app.graph_models import KnowledgeDocument, KnowledgeChunk, Agent
from app.tools.knowledge import process_document, KNOWLEDGE_FILES_DIR, SUPPORTED_EXTENSIONS

router = APIRouter(prefix="/agents/{agent_name}/knowledge", tags=["knowledge"])


class ProcessingStatus(BaseModel):
    status: str
    document_id: Optional[str] = None
    message: str
    chunk_count: int = 0
    current_chunk: int = 0
    total_chunks: int = 0


# Store processing status
_processing_status: dict[str, ProcessingStatus] = {}


def get_file_type(filename: str) -> str:
    """Determine document type from filename."""
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    if ext == "pdf":
        return "pdf"
    return "text"


def update_status(task_id: str, **kwargs):
    """Update processing status for a task."""
    current = _processing_status.get(task_id, ProcessingStatus(status="processing", message=""))
    _processing_status[task_id] = ProcessingStatus(
        status=kwargs.get("status", current.status),
        document_id=kwargs.get("document_id", current.document_id),
        message=kwargs.get("message", current.message),
        chunk_count=kwargs.get("chunk_count", current.chunk_count),
        current_chunk=kwargs.get("current_chunk", current.current_chunk),
        total_chunks=kwargs.get("total_chunks", current.total_chunks),
    )


async def process_file_async(
    agent_name: str,
    file_path: Path,
    filename: str,
    enrich_with_llm: bool,
    enrichment_model: str,
    task_id: str
):
    """Background task to process uploaded file using unstructured."""
    try:
        update_status(task_id, status="processing", message=f"Reading {filename}...")
        
        doc = await process_document(
            agent_name=agent_name,
            filename=filename,
            file_path=str(file_path),
            enrich_with_llm=enrich_with_llm,
            enrichment_model=enrichment_model,
            progress_callback=lambda msg, current=0, total=0: update_status(
                task_id, 
                status="processing", 
                message=msg,
                current_chunk=current,
                total_chunks=total
            )
        )
        
        update_status(
            task_id,
            status="completed",
            document_id=doc.id,
            message=f"Successfully processed {filename}",
            chunk_count=doc.chunk_count
        )
        
    except Exception as e:
        logger.error(f"Error processing file {filename}: {e}")
        update_status(task_id, status="error", message=str(e))


@router.post("/upload")
async def upload_file(
    agent_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    enrich_with_llm: bool = Form(True),
    enrichment_model: str = Form("qwen3:4b")
):
    """Upload a file to the agent's knowledge base.
    
    Supported file types: .txt, .md, .pdf
    """
    # Verify agent exists
    agent = Agent.get(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    
    # Check file extension
    filename = file.filename or "unknown.txt"
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported file type: {ext}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )
    
    # Create storage directory
    agent_dir = KNOWLEDGE_FILES_DIR / agent_name
    agent_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename
    file_id = str(uuid.uuid4())[:8]
    safe_filename = f"{file_id}_{filename}"
    file_path = agent_dir / safe_filename
    
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
        agent_name,
        file_path,
        filename,
        enrich_with_llm,
        enrichment_model,
        task_id
    )
    
    return {"task_id": task_id, "status": "queued", "filename": filename}


@router.get("/status/{task_id}")
async def get_processing_status(agent_name: str, task_id: str):
    """Get the status of a processing task."""
    status = _processing_status.get(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status.model_dump()


@router.get("")
async def list_documents(agent_name: str):
    """List all documents in the agent's knowledge base."""
    agent = Agent.get(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    
    docs = KnowledgeDocument.get_by_agent(agent_name)
    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "doc_type": doc.doc_type,
                "chunk_count": doc.chunk_count,
                "created_at": doc.created_at
            }
            for doc in docs
        ]
    }


@router.get("/{doc_id}")
async def get_document(agent_name: str, doc_id: str):
    """Get details of a specific document including its chunks."""
    doc = KnowledgeDocument.get(doc_id)
    if not doc or doc.agent_name != agent_name:
        raise HTTPException(status_code=404, detail="Document not found")
    
    chunks = KnowledgeChunk.get_by_document(doc_id)
    
    return {
        "document": {
            "id": doc.id,
            "filename": doc.filename,
            "doc_type": doc.doc_type,
            "chunk_count": doc.chunk_count,
            "created_at": doc.created_at
        },
        "chunks": [
            {
                "index": c.chunk_index,
                "content": c.content,
                "summary": c.summary,
                "topics": c.topics
            }
            for c in chunks
        ]
    }


@router.delete("/{doc_id}")
async def delete_document(agent_name: str, doc_id: str):
    """Delete a document and all its chunks from the knowledge base."""
    doc = KnowledgeDocument.get(doc_id)
    if not doc or doc.agent_name != agent_name:
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
