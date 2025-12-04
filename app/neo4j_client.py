from neo4j import GraphDatabase
from loguru import logger
from langchain_ollama import OllamaEmbeddings
import os
from datetime import datetime
from uuid import uuid4
from dotenv import load_dotenv
load_dotenv()

URI = os.getenv("NEO4J_URI")
AUTH = (os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD"))
driver = GraphDatabase.driver(URI, auth=AUTH)
embeddings = OllamaEmbeddings(model="embeddinggemma")

def _ensure_user():
    driver.execute_query("MERGE (u:User {id: 'self'})", database_="neo4j")

def _canonicalize_person(name: str) -> str:
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) WHERE p.name_canonical = $name OR $name IN p.aliases RETURN elementId(p) as id",
        name=name, database_="neo4j"
    )
    if records:
        return records[0]["id"]
    
    name_emb = embeddings.embed_query(name)
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) RETURN elementId(p) as id, p.name_canonical as name, p.embedding as emb",
        database_="neo4j"
    )
    
    for r in records:
        if r["emb"]:
            canonical_name = r["name"]
            sim = sum(a*b for a,b in zip(name_emb, r["emb"])) / (sum(a*a for a in name_emb)**0.5 * sum(b*b for b in r["emb"])**0.5)
            if (sim > 0.78 
                and name[0].lower() == canonical_name[0].lower() 
                and abs(len(name) - len(canonical_name)) <= 6):
                driver.execute_query(
                    "MATCH (p:Person) WHERE elementId(p) = $id SET p.aliases = p.aliases + $name",
                    id=r["id"], name=name, database_="neo4j"
                )
                return r["id"]
    
    records, _, _ = driver.execute_query(
        "CREATE (p:Person {id: $id, name_canonical: $name, aliases: [], importance: 0.5, embedding: $emb}) RETURN elementId(p) as id",
        id=str(uuid4()), name=name, emb=name_emb, database_="neo4j"
    )
    return records[0]["id"]

def save_memory(type: str, summary: str, entities: list[str], importance: float, persistence: str) -> str:
    _ensure_user()
    mem_id = str(uuid4())
    summary_emb = embeddings.embed_query(summary)
    
    driver.execute_query(
        "CREATE (m:Memory {id: $id, type: $type, summary: $summary, timestamp: $ts, importance: $imp, persistence: $pers, embedding: $emb})",
        id=mem_id, type=type, summary=summary, ts=datetime.now().isoformat(), 
        imp=importance, pers=persistence, emb=summary_emb, database_="neo4j"
    )
    
    driver.execute_query(
        "MATCH (u:User {id: 'self'}), (m:Memory {id: $mid}) CREATE (u)-[:HAS_MEMORY]->(m)",
        mid=mem_id, database_="neo4j"
    )
    
    if type == "preference":
        driver.execute_query(
            "MATCH (m:Memory {id: $mid}), (u:User {id: 'self'}) CREATE (m)-[:REFERS_TO]->(u)",
            mid=mem_id, database_="neo4j"
        )
    else:
        for entity in entities:
            person_id = _canonicalize_person(entity)
            driver.execute_query(
                "MATCH (m:Memory {id: $mid}), (p:Person) WHERE elementId(p) = $pid CREATE (m)-[:REFERS_TO]->(p)",
                mid=mem_id, pid=person_id, database_="neo4j"
            )
    
    return mem_id

def get_relevant_memories(user_message: str, top_k: int = 5) -> list[dict]:
    msg_emb = embeddings.embed_query(user_message)
    
    records, _, _ = driver.execute_query(
        "MATCH (u:User {id: 'self'})-[:HAS_MEMORY]->(m:Memory) RETURN m.id as id, m.type as type, m.summary as summary, m.embedding as emb, m.importance as importance, m.timestamp as timestamp",
        database_="neo4j"
    )
    
    results = []
    for r in records:
        if r["emb"]:
            sim = sum(a*b for a,b in zip(msg_emb, r["emb"])) / (sum(a*a for a in msg_emb)**0.5 * sum(b*b for b in r["emb"])**0.5)
            results.append({"id": r["id"], "short_id": r["id"][:8], "type": r["type"], "summary": r["summary"], "similarity": sim, "importance": r["importance"], "timestamp": r["timestamp"]})
    
    results.sort(key=lambda x: x["similarity"] * x["importance"], reverse=True)
    return results[:top_k]

def merge_person(alias: str, canonical: str) -> str:
    alias_id = _canonicalize_person(alias)
    canonical_id = _canonicalize_person(canonical)
    
    if alias_id == canonical_id:
        return "Already same person"
    
    driver.execute_query(
        "MATCH (p1:Person) WHERE elementId(p1) = $aid MATCH (p2:Person) WHERE elementId(p2) = $cid SET p2.aliases = p2.aliases + p1.aliases + [p1.name_canonical] WITH p1, p2 MATCH (p1)-[r]-() CREATE (p2)-[r2:REFERS_TO]->() SET r2 = r DELETE r, p1",
        aid=alias_id, cid=canonical_id, database_="neo4j"
    )
    return f"Merged {alias} into {canonical}"

def list_people() -> list[dict]:
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) RETURN elementId(p) as id, p.name_canonical as name, p.aliases as aliases, p.importance as importance",
        database_="neo4j"
    )
    return [{"id": r["id"], "name": r["name"], "aliases": r["aliases"], "importance": r["importance"]} for r in records]

def list_memories() -> list[dict]:
    records, _, _ = driver.execute_query(
        "MATCH (m:Memory) RETURN m.id as id, m.type as type, m.summary as summary, m.timestamp as timestamp, m.importance as importance, m.persistence as persistence",
        database_="neo4j"
    )
    return [dict(r) for r in records]

def delete_memory(id: str) -> str:
    driver.execute_query(
        "MATCH (m:Memory {id: $id}) DETACH DELETE m",
        id=id, database_="neo4j"
    )
    return f"Deleted memory {id}"
