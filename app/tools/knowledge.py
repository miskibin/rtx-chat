"""Knowledge base tools for mode-specific document storage and retrieval.

Uses the `unstructured` library for document partitioning, cleaning, and chunking.
Supports: .txt, .md, .pdf files only.

See: https://docs.unstructured.io/open-source/core-functionality/overview
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Callable, Optional

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
SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf"}

# Universal content tags for chunk classification (works for any domain)
CHUNK_TAGS = [
    "overview",      # high-level summaries, introductions
    "detail",        # in-depth specifics, elaborations
    "definition",    # what something is, terminology
    "explanation",   # how/why something works
    "instruction",   # steps, procedures, how-to
    "example",       # illustrations, cases, samples
    "reference",     # facts, specs, catalogs
    "narrative",     # stories, experiences, events
    "analysis",      # reasoning, evaluations
    "comparison",    # similarities, differences
    "opinion",       # views, perspectives, arguments
    "quote",         # citations, sayings, excerpts
    "question",      # queries, problems, prompts
    "list",          # enumerations, collections
    "data",          # statistics, measurements, figures
    "code",          # programming, technical snippets
    "tip",           # advice, recommendations
    "warning",       # cautions, caveats, pitfalls
    "context",       # background, prerequisites
    "dialogue",      # conversations, exchanges, Q&A
]


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


def partition_and_chunk(file_path: Path, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Partition and chunk a file using unstructured.
    
    Supports: .txt, .md, .pdf
    
    Uses unstructured's semantic partitioning to understand document structure,
    then chunks using by_title strategy which respects section boundaries.
    """
    from unstructured.partition.auto import partition
    from unstructured.chunking.title import chunk_by_title
    from unstructured.cleaners.core import clean, replace_unicode_quotes
    
    ext = file_path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}. Supported: {SUPPORTED_EXTENSIONS}")
    
    # Partition the document into semantic elements
    elements = partition(str(file_path))
    logger.info(f"Partitioned {file_path.name} into {len(elements)} elements")
    
    if not elements:
        raise ValueError(f"No content could be extracted from {file_path.name}")
    
    # Apply cleaning to each element
    for element in elements:
        element.apply(replace_unicode_quotes)
        element.apply(lambda text: clean(text, extra_whitespace=True, dashes=True))
    
    # Chunk using by_title strategy - respects section boundaries
    chunks = chunk_by_title(
        elements,
        max_characters=chunk_size,
        new_after_n_chars=chunk_size - 100,
        overlap=overlap,
        combine_text_under_n_chars=200,
    )
    
    # Extract text from chunks
    chunk_texts = [chunk.text.strip() for chunk in chunks if chunk.text.strip()]
    
    if not chunk_texts:
        raise ValueError(f"No chunks could be created from {file_path.name}")
    
    logger.info(f"Created {len(chunk_texts)} chunks from {file_path.name}")
    return chunk_texts


async def enrich_chunk_with_llm(content: str, model: str = "qwen3:4b") -> dict:
    """Use LLM to generate summary and classify chunk into fixed content-type tags."""
    from app.routers.models import get_provider_config
    
    prompt = f"""Classify this text with 1-2 tags from this list:
overview, detail, definition, explanation, instruction, example, reference, narrative, analysis, comparison, opinion, quote, question, list, data, code, tip, warning, context, dialogue

Return JSON: {{"summary": "1-2 sentence summary", "tags": ["tag1", "tag2"]}}

Text:
{content[:1500]}

JSON only:"""

    try:
        provider_config = get_provider_config(model)
        
        if provider_config:
            from openai import OpenAI
            api_key, base_url = provider_config
            client = OpenAI(api_key=api_key, base_url=base_url)
            
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            result_text = response.choices[0].message.content.strip()
        else:
            import ollama
            response = ollama.chat(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                format="json"
            )
            result_text = response.message.content.strip()
        
        result = json.loads(result_text)
        # Filter to only valid tags
        raw_tags = result.get("tags", [])
        valid_tags = [t for t in raw_tags if t in CHUNK_TAGS][:2]
        return {
            "summary": result.get("summary", "")[:500],
            "topics": valid_tags  # Keep field name for backward compatibility
        }
    except Exception as e:
        logger.warning(f"LLM enrichment failed: {e}")
        return {"summary": "", "topics": []}


async def process_document(
    mode_name: str,
    filename: str,
    file_path: str,
    enrich_with_llm: bool = True,
    enrichment_model: str = "qwen3:4b",
    progress_callback: Optional[Callable[[str, int, int], None]] = None
) -> KnowledgeDocument:
    """Process a document file using unstructured for partitioning and chunking.
    
    Supports: .txt, .md, .pdf files only.
    """
    async def update_progress(msg: str, current: int = 0, total: int = 0):
        if progress_callback:
            progress_callback(msg, current, total)
        # Yield control to event loop so status polls can be served
        await asyncio.sleep(0)
    
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")
    
    ensure_vector_index()
    
    doc_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    
    # Partition and chunk using unstructured (run in thread pool to not block)
    await update_progress(f"Partitioning {filename} (this may take a while)...")
    loop = asyncio.get_event_loop()
    chunks = await loop.run_in_executor(None, partition_and_chunk, path)
    total_chunks = len(chunks)
    
    await update_progress(f"Partitioned into {total_chunks} chunks. Generating embeddings...", 0, total_chunks)
    
    # Determine doc_type from extension
    doc_type: Literal["pdf", "text"] = "pdf" if ext == ".pdf" else "text"
    
    # Create and save chunks
    for idx, chunk_content in enumerate(chunks):
        enrichment = {"summary": "", "topics": []}
        
        if enrich_with_llm and chunk_content.strip():
            await update_progress(f"Enriching chunk {idx + 1}/{total_chunks} with LLM...", idx + 1, total_chunks)
            enrichment = await enrich_chunk_with_llm(chunk_content, enrichment_model)
            logger.debug(f"Chunk {idx}: {enrichment.get('summary', '')[:50]}...")
        else:
            await update_progress(f"Embedding chunk {idx + 1}/{total_chunks}...", idx + 1, total_chunks)
        
        chunk = KnowledgeChunk(
            document_id=doc_id,
            mode_name=mode_name,
            content=chunk_content,
            summary=enrichment.get("summary", ""),
            topics=enrichment.get("topics", []),
            chunk_index=idx
        )
        # Run save in thread pool to not block event loop
        await loop.run_in_executor(None, chunk.save)
    
    # Create and save document
    doc = KnowledgeDocument(
        id=doc_id,
        mode_name=mode_name,
        filename=filename,
        doc_type=doc_type,
        source_url=None,
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
        
        return [
            {
                "content": rec["node"].get("content", ""),
                "summary": rec["node"].get("summary", ""),
                "topics": list(rec["node"].get("topics", [])),
                "source": rec["source"],
                "score": rec["score"]
            }
            for rec in result
        ]


def get_mode_knowledge_text(mode_name: str, query: str, limit: int = 5, threshold: float | None = None) -> str:
    """Get formatted knowledge text for injection into prompt."""
    chunks = retrieve_mode_knowledge(mode_name, query, limit, threshold)
    
    if not chunks:
        return ""
    
    output = []
    for chunk in chunks:
        # Include similarity score so UIs can display ranking/quality at a glance.
        entry = f"[{chunk['source']}] (sim: {chunk['score']:.2f})"
        if chunk["summary"]:
            entry += f" {chunk['summary']}"
        if chunk["topics"]:
            entry += f" Topics: {', '.join(chunk['topics'])}"
        entry += f"\n{chunk['content'][:500]}"
        output.append(entry)
    
    return "\n\n".join(output)


@tool
def search_mode_knowledge(query: str, mode_name: str = "", limit: int = 5, threshold: float = 0.7) -> str:
    """Search the current mode's knowledge base for relevant information.
    
    Use this when you need to find specific information from uploaded documents
    (txt, md, pdf) that were added to this mode's knowledge base.
    
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
        entry = f"[{chunk['source']}] (sim: {chunk['score']:.2f})"
        if chunk["summary"]:
            entry += f"\nSummary: {chunk['summary']}"
        if chunk["topics"]:
            entry += f"\nTopics: {', '.join(chunk['topics'])}"
        entry += f"\nContent: {chunk['content'][:600]}"
        output.append(entry)
    
    return "\n\n---\n\n".join(output)


def get_knowledge_tools():
    """Get knowledge-related tools."""
    return [search_mode_knowledge]
