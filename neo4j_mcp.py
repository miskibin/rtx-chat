from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv
from neo4j import GraphDatabase
from loguru import logger
from langchain_ollama import OllamaEmbeddings
from datetime import datetime
from typing import Literal
import os
import json

from app.graph_models import (
    User,
    Person,
    Event,
    Fact,
    Preference,
    KnowsRelationship,
    ParticipatedInRelationship,
    MentionsRelationship,
)

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
driver = GraphDatabase.driver(URI, auth=AUTH)
embeddings = OllamaEmbeddings(model="embeddinggemma")

mcp = FastMCP("neo4j-memory")


def _get_embedding(text: str) -> list[float]:
    return embeddings.embed_query(text)


def _create_vector_index(index_name: str = "embedding_index", dimension: int = 768):
    """Create vector index for all node types with embeddings."""
    with driver.session() as session:
        for label in ["Person", "Event", "Fact", "Preference", "User"]:
            try:
                cypher = f"CREATE VECTOR INDEX {index_name}_{label} IF NOT EXISTS FOR (n:{label}) ON (n.embedding) OPTIONS {{indexConfig: {{`vector.dimensions`: {dimension}, `vector.similarity_function`: 'cosine'}}}}"
                session.run(cypher)
                logger.info(f"Created vector index for {label}")
            except Exception as e:
                logger.warning(f"Vector index for {label} might already exist: {e}")


def kg_initialize_database(dimension: int = 768) -> str:
    """Initialize database with vector indexes and User node."""
    _create_vector_index(dimension=dimension)

    with driver.session() as session:
        session.run("MERGE (u:User {name: 'User'})")

    return json.dumps(
        {"status": "success", "message": "Database initialized with vector indexes"}
    )
