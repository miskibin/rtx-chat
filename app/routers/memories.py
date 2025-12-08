from fastapi import APIRouter
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
from loguru import logger
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(tags=["memories"])

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
driver = GraphDatabase.driver(URI, auth=AUTH)
embeddings = OllamaEmbeddings(model="embeddinggemma")


@router.get("/memories")
async def list_memories():
    with driver.session() as session:
        result = session.run("""
            MATCH (n) WHERE n:Person OR n:Event OR n:Fact OR n:Preference
            RETURN labels(n)[0] as type, 
                   CASE 
                       WHEN n:Person THEN n.name + ': ' + coalesce(n.description, '')
                       WHEN n:Event THEN '[' + n.date + '] ' + n.description
                       WHEN n:Fact THEN n.content + ' (' + n.category + ')'
                       WHEN n:Preference THEN n.instruction
                   END as content,
                   elementId(n) as id
        """)
        memories = [{"id": r["id"], "type": r["type"], "content": r["content"]} for r in result]
    return {"memories": memories}


@router.get("/memories/search")
async def search_memories(q: str):
    embedding = embeddings.embed_query(q)
    memories = []
    with driver.session() as session:
        for label in ["Person", "Event", "Fact", "Preference"]:
            result = session.run(
                f"CALL db.index.vector.queryNodes('embedding_index_{label}', 5, $embedding) YIELD node, score RETURN node, score, labels(node)[0] as type",
                embedding=embedding
            )
            for r in result:
                node = dict(r["node"])
                if label == "Person":
                    content = f"{node.get('name', '')}: {node.get('description', '')}"
                elif label == "Event":
                    content = f"[{node.get('date', '')}] {node.get('description', '')}"
                elif label == "Fact":
                    content = f"{node.get('content', '')} ({node.get('category', '')})"
                else:
                    content = node.get("instruction", "")
                memories.append({"type": r["type"], "content": content, "score": r["score"]})
    memories.sort(key=lambda x: x["score"], reverse=True)
    return {"memories": memories[:10]}


@router.get("/memories/preferences")
async def get_preferences():
    with driver.session() as session:
        result = session.run("MATCH (u:User)-[:HAS_PREFERENCE]->(p:Preference) RETURN p.instruction as instruction")
        preferences = [r["instruction"] for r in result]
    return {"preferences": preferences}


@router.get("/memories/people")
async def list_people():
    with driver.session() as session:
        result = session.run("""
            MATCH (p:Person)
            OPTIONAL MATCH (u:User)-[k:KNOWS]->(p)
            RETURN p.name as name, p.description as description, 
                   k.relation_type as relation, k.sentiment as sentiment
        """)
        people = [
            {"name": r["name"], "description": r["description"], "relation": r["relation"], "sentiment": r["sentiment"]}
            for r in result
        ]
    return {"people": people}


@router.get("/memories/events")
async def list_events():
    with driver.session() as session:
        result = session.run("""
            MATCH (e:Event)
            OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(e)
            RETURN e.description as description, e.date as date, collect(p.name) as participants
        """)
        events = [{"description": r["description"], "date": r["date"], "participants": r["participants"]} for r in result]
    return {"events": events}


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    logger.info(f"Deleting memory {memory_id}")
    with driver.session() as session:
        session.run("MATCH (n) WHERE elementId(n) = $id DETACH DELETE n", id=memory_id)
    return {"status": "deleted"}
