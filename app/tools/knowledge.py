"""Knowledge base tools for mode-specific document storage and retrieval."""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal

from langchain.tools import tool
from langchain_ollama import OllamaEmbeddings
from loguru import logger
from neo4j import GraphDatabase
from dotenv import load_dotenv

from app.graph_models import KnowledgeDocument, KnowledgeChunk

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
_driver = GraphDatabase.driver(URI, auth=AUTH, max_connection_lifetime=300, keep_alive=True)
_embeddings = OllamaEmbeddings(model="embeddinggemma")

KNOWLEDGE_FILES_DIR = Path("knowledge_files")
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
SIMILARITY_THRESHOLD = 0.6


def get_session():
    return _driver.session(database="neo4j")


def ensure_vector_index():
    """Create vector index for KnowledgeChunk if it doesn't exist."""
    with get_session() as session:
        try:
            session.run(
                """
                CREATE VECTOR INDEX embedding_index_KnowledgeChunk IF NOT EXISTS
                FOR (c:KnowledgeChunk)
                ON c.embedding
                OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}
                """
            )
        except Exception as e:
            logger.debug(f"Vector index may already exist: {e}")


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into chunks with overlap, trying to split on sentence boundaries."""
    if not text or len(text) <= chunk_size:
        return [text] if text else []
    
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    chunks = []
    start = 0
    
    while start < len(text):
        end = start + chunk_size
        
        if end >= len(text):
            chunks.append(text[start:].strip())
            break
        
        # Try to find a sentence boundary near the end
        search_start = max(start + chunk_size - 100, start)
        search_end = min(start + chunk_size + 50, len(text))
        search_region = text[search_start:search_end]
        
        # Look for sentence endings
        best_break = None
        for pattern in ['. ', '? ', '! ', '\n']:
            idx = search_region.rfind(pattern)
            if idx != -1:
                best_break = search_start + idx + len(pattern)
                break
        
        if best_break and best_break > start:
            end = best_break
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        start = end - overlap
    
    return chunks


async def extract_text_from_pdf(file_path: Path) -> str:
    """Extract text from PDF using docling."""
    try:
        from docling.document_converter import DocumentConverter
        
        converter = DocumentConverter()
        result = converter.convert(str(file_path))
        return result.document.export_to_markdown()
    except ImportError:
        logger.warning("docling not installed, falling back to basic PDF extraction")
        try:
            import pypdf
            reader = pypdf.PdfReader(str(file_path))
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text
        except ImportError:
            raise ImportError("Neither docling nor pypdf is installed for PDF processing")


async def extract_text_from_image(file_path: Path) -> str:
    """Extract text from image using docling OCR."""
    try:
        from docling.document_converter import DocumentConverter
        
        converter = DocumentConverter()
        result = converter.convert(str(file_path))
        return result.document.export_to_markdown()
    except ImportError:
        logger.warning("docling not installed for OCR")
        raise ImportError("docling is required for image OCR")


async def fetch_url_content(url: str) -> str:
    """Fetch content from URL using crawl4ai for JS rendering."""
    from app.tools.web import read_website_js
    result = await read_website_js.ainvoke({"url": url})
    return result


async def enrich_chunk_with_llm(content: str, model: str = "qwen3:4b") -> dict:
    """Use LLM to generate summary and extract topics from a chunk."""
    try:
        import ollama
        
        prompt = f"""Analyze this text and return JSON with exactly this format:
{{"summary": "1-2 sentence summary of the main points", "topics": ["topic1", "topic2", "topic3"]}}

Text:
{content[:1500]}

Return ONLY valid JSON, no other text."""

        response = ollama.chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            format="json"
        )
        
        result_text = response.message.content.strip()
        # Try to parse JSON from response
        try:
            result = json.loads(result_text)
            return {
                "summary": result.get("summary", "")[:500],
                "topics": result.get("topics", [])[:10]
            }
        except json.JSONDecodeError:
            # Try to extract JSON from response
            json_match = re.search(r'\{[^}]+\}', result_text)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    "summary": result.get("summary", "")[:500],
                    "topics": result.get("topics", [])[:10]
                }
            return {"summary": content[:200], "topics": []}
            
    except Exception as e:
        logger.warning(f"LLM enrichment failed: {e}")
        return {"summary": content[:200], "topics": []}


async def process_document(
    mode_name: str,
    content: str,
    filename: str,
    doc_type: Literal["pdf", "url", "image", "text"],
    source_url: str | None = None,
    file_path: str | None = None,
    enrich_with_llm: bool = True,
    enrichment_model: str = "qwen3:4b"
) -> KnowledgeDocument:
    """Process a document: chunk it, optionally enrich with LLM, and store in Neo4j."""
    
    ensure_vector_index()
    
    doc_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    
    # Chunk the content
    chunks = chunk_text(content)
    logger.info(f"Split document into {len(chunks)} chunks")
    
    # Create and save chunks
    for idx, chunk_content in enumerate(chunks):
        enrichment = {"summary": "", "topics": []}
        
        if enrich_with_llm and chunk_content.strip():
            enrichment = await enrich_chunk_with_llm(chunk_content, enrichment_model)
            logger.debug(f"Chunk {idx}: {enrichment.get('summary', '')[:50]}...")
        
        chunk = KnowledgeChunk(
            document_id=doc_id,
            mode_name=mode_name,
            content=chunk_content,
            summary=enrichment.get("summary", ""),
            topics=enrichment.get("topics", []),
            chunk_index=idx
        )
        chunk.save()
    
    # Create and save document
    doc = KnowledgeDocument(
        id=doc_id,
        mode_name=mode_name,
        filename=filename,
        doc_type=doc_type,
        source_url=source_url,
        file_path=file_path,
        chunk_count=len(chunks),
        created_at=created_at
    )
    doc.save()
    
    logger.info(f"Saved document {filename} with {len(chunks)} chunks to mode {mode_name}")
    return doc


def retrieve_mode_knowledge(mode_name: str, query: str, limit: int = 5, threshold: float | None = None) -> list[dict]:
    """Retrieve relevant knowledge chunks for a mode using vector similarity."""
    query_embedding = _embeddings.embed_query(query)
    effective_threshold = threshold if threshold is not None else SIMILARITY_THRESHOLD
    
    with get_session() as session:
        result = session.run(
            """
            CALL db.index.vector.queryNodes('embedding_index_KnowledgeChunk', $limit * 2, $embedding)
            YIELD node, score
            WHERE node.mode_name = $mode_name AND score >= $threshold
            MATCH (d:KnowledgeDocument {id: node.document_id})
            RETURN node, score, d.filename as source
            ORDER BY score DESC
            LIMIT $limit
            """,
            embedding=query_embedding,
            mode_name=mode_name,
            limit=limit,
            threshold=effective_threshold
        )
        
        chunks = []
        for rec in result:
            node = rec["node"]
            chunks.append({
                "content": node.get("content", ""),
                "summary": node.get("summary", ""),
                "topics": list(node.get("topics", [])),
                "source": rec["source"],
                "score": rec["score"]
            })
        
        return chunks


def get_mode_knowledge_text(mode_name: str, query: str, limit: int = 5, threshold: float | None = None) -> str:
    """Get formatted knowledge text for injection into prompt."""
    chunks = retrieve_mode_knowledge(mode_name, query, limit, threshold)
    
    if not chunks:
        return ""
    
    output = []
    for chunk in chunks:
        source = chunk.get("source", "unknown")
        summary = chunk.get("summary", "")
        content = chunk.get("content", "")[:500]
        topics = chunk.get("topics", [])
        
        entry = f"[{source}]"
        if summary:
            entry += f" {summary}"
        if topics:
            entry += f" Topics: {', '.join(topics)}"
        entry += f"\n{content}"
        output.append(entry)
    
    return "\n\n".join(output)


@tool
def search_mode_knowledge(query: str, mode_name: str = "", limit: int = 5, threshold: float = 0.7) -> str:
    """Search the current mode's knowledge base for relevant information.
    
    Use this when you need to find specific information from uploaded documents,
    PDFs, or URLs that were added to this mode's knowledge base.
    
    Args:
        query: What to search for - be descriptive
        mode_name: The mode to search in (automatically provided)
        limit: Maximum number of results (default 5)
        threshold: Minimum similarity threshold (automatically provided)
    """
    if not mode_name:
        return "No mode context available"
    
    chunks = retrieve_mode_knowledge(mode_name, query, limit, threshold)
    
    if not chunks:
        return "No relevant knowledge found in the mode's knowledge base."
    
    output = []
    for chunk in chunks:
        source = chunk.get("source", "unknown")
        summary = chunk.get("summary", "")
        content = chunk.get("content", "")[:600]
        topics = chunk.get("topics", [])
        score = chunk.get("score", 0)
        
        entry = f"[{source}] (sim: {score:.2f})"
        if summary:
            entry += f"\nSummary: {summary}"
        if topics:
            entry += f"\nTopics: {', '.join(topics)}"
        entry += f"\nContent: {content}"
        output.append(entry)
    
    return "\n\n---\n\n".join(output)


def get_knowledge_tools():
    """Get knowledge-related tools."""
    return [search_mode_knowledge]
