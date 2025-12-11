"""Knowledge base tools for mode-specific document storage and retrieval.

Uses the `unstructured` library for document partitioning, cleaning, and chunking.
See: https://docs.unstructured.io/open-source/core-functionality/overview
"""

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


def partition_and_chunk_file(file_path: Path, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Partition a file using unstructured and chunk it with the by_title strategy.
    
    Uses unstructured's semantic partitioning to understand document structure,
    then chunks respecting section boundaries.
    
    See: https://docs.unstructured.io/open-source/core-functionality/chunking
    """
    from unstructured.partition.auto import partition
    from unstructured.chunking.title import chunk_by_title
    from unstructured.cleaners.core import clean, replace_unicode_quotes, group_broken_paragraphs
    
    # Partition the document into semantic elements
    elements = partition(str(file_path))
    logger.info(f"Partitioned {file_path.name} into {len(elements)} elements")
    
    # Apply cleaning to each element
    for element in elements:
        element.apply(replace_unicode_quotes)
        element.apply(lambda text: clean(text, extra_whitespace=True, dashes=True))
    
    # Chunk using by_title strategy - respects section boundaries
    chunks = chunk_by_title(
        elements,
        max_characters=chunk_size,
        new_after_n_chars=chunk_size - 100,  # soft max
        overlap=overlap,
        combine_text_under_n_chars=200,  # combine small sections
    )
    
    # Extract text from chunks
    chunk_texts = []
    for chunk in chunks:
        text = chunk.text.strip()
        if text:
            chunk_texts.append(text)
    
    logger.info(f"Created {len(chunk_texts)} chunks from {file_path.name}")
    return chunk_texts


def partition_and_chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Partition text content using unstructured and chunk it.
    
    For plain text or HTML content that doesn't come from a file.
    """
    from unstructured.partition.text import partition_text
    from unstructured.partition.html import partition_html
    from unstructured.chunking.title import chunk_by_title
    from unstructured.cleaners.core import clean, replace_unicode_quotes, group_broken_paragraphs
    
    # Detect if it's HTML
    if text.strip().startswith('<') and ('</html>' in text.lower() or '</body>' in text.lower() or '</div>' in text.lower()):
        elements = partition_html(text=text)
    else:
        # Apply group_broken_paragraphs for plain text before partitioning
        text = group_broken_paragraphs(text)
        elements = partition_text(text=text)
    
    logger.info(f"Partitioned text into {len(elements)} elements")
    
    # Apply cleaning to each element
    for element in elements:
        element.apply(replace_unicode_quotes)
        element.apply(lambda t: clean(t, extra_whitespace=True, dashes=True))
    
    # Chunk using by_title strategy
    chunks = chunk_by_title(
        elements,
        max_characters=chunk_size,
        new_after_n_chars=chunk_size - 100,
        overlap=overlap,
        combine_text_under_n_chars=200,
    )
    
    # Extract text from chunks
    chunk_texts = []
    for chunk in chunks:
        text = chunk.text.strip()
        if text:
            chunk_texts.append(text)
    
    logger.info(f"Created {len(chunk_texts)} chunks from text")
    return chunk_texts


def partition_and_chunk_url(url: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Partition content from a URL using unstructured and chunk it.
    """
    from unstructured.partition.html import partition_html
    from unstructured.chunking.title import chunk_by_title
    from unstructured.cleaners.core import clean, replace_unicode_quotes
    
    # Partition directly from URL
    elements = partition_html(url=url)
    logger.info(f"Partitioned URL into {len(elements)} elements")
    
    # Apply cleaning
    for element in elements:
        element.apply(replace_unicode_quotes)
        element.apply(lambda t: clean(t, extra_whitespace=True, dashes=True))
    
    # Chunk
    chunks = chunk_by_title(
        elements,
        max_characters=chunk_size,
        new_after_n_chars=chunk_size - 100,
        overlap=overlap,
        combine_text_under_n_chars=200,
    )
    
    chunk_texts = [chunk.text.strip() for chunk in chunks if chunk.text.strip()]
    logger.info(f"Created {len(chunk_texts)} chunks from URL")
    return chunk_texts


async def fetch_url_content(url: str) -> str:
    """Fetch content from URL using crawl4ai for JS rendering.
    
    Note: This is kept for compatibility but partition_and_chunk_url is preferred
    as it uses unstructured's built-in URL fetching with proper HTML parsing.
    """
    from app.tools.web import read_website_js
    result = await read_website_js.ainvoke({"url": url})
    return result


async def enrich_chunk_with_llm(content: str, model: str = "qwen3:4b") -> dict:
    """Use LLM to generate summary and extract topics from a chunk."""
    from app.routers.models import get_provider_config
    
    prompt = f"""Analyze this text and return JSON with exactly this format:
{{"summary": "1-2 sentence summary of the main points", "topics": ["topic1", "topic2", "topic3"]}}

Text:
{content[:1500]}

Return ONLY valid JSON, no other text."""

    try:
        provider_config = get_provider_config(model)
        
        if provider_config:
            # External model (Gemini, Grok, DeepSeek) - use OpenAI-compatible API
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
            # Local Ollama model
            import ollama
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
    """Process a document using unstructured for partitioning and chunking.
    
    Uses unstructured's semantic partitioning to understand document structure,
    then chunks using the by_title strategy which respects section boundaries.
    
    See: https://docs.unstructured.io/open-source/core-functionality/chunking
    """
    
    ensure_vector_index()
    
    doc_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    
    # Use unstructured for partitioning and chunking based on source type
    try:
        if file_path and Path(file_path).exists():
            # File-based: use unstructured's auto partition
            chunks = partition_and_chunk_file(Path(file_path))
        elif source_url and doc_type == "url":
            # URL: use unstructured's HTML partition with URL fetching
            try:
                chunks = partition_and_chunk_url(source_url)
            except Exception as e:
                logger.warning(f"unstructured URL fetch failed, falling back to crawl4ai: {e}")
                # Fallback to crawl4ai for JS-heavy sites
                content = await fetch_url_content(source_url)
                chunks = partition_and_chunk_text(content)
        else:
            # Text/HTML content: partition as text or HTML
            chunks = partition_and_chunk_text(content)
    except Exception as e:
        logger.error(f"unstructured processing failed: {e}")
        # Ultimate fallback: simple split on paragraphs
        chunks = [p.strip() for p in content.split('\n\n') if p.strip()]
        if not chunks:
            chunks = [content[:CHUNK_SIZE]] if content else []
    
    logger.info(f"Split document into {len(chunks)} chunks using unstructured")
    
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
