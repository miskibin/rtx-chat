from fastapi import APIRouter, Path
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
from loguru import logger
import os
from dotenv import load_dotenv
from urllib.parse import unquote
from app.schemas import MergeEntitiesRequest, EventUpdate, PersonUpdate, RelationshipUpdate

load_dotenv()

router = APIRouter(tags=["memories"])

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
driver = GraphDatabase.driver(URI, auth=AUTH)
embeddings = OllamaEmbeddings(model="embeddinggemma")


@router.get("/memories")
async def list_memories(skip: int = 0, limit: int = 50, type_filter: str = None):
    """
    Lists memories with pagination. 
    Optional type_filter: 'Person', 'Event', 'Fact', 'Preference'
    """
    query = """
        MATCH (n) 
        WHERE (n:Person OR n:Event OR n:Fact OR n:Preference)
    """
    
    if type_filter:
        query += f" AND labels(n)[0] = '{type_filter}'"
        
    query += """
        RETURN labels(n)[0] as type, 
               CASE 
                   WHEN n:Person THEN n.name + ': ' + coalesce(n.description, '')
                   WHEN n:Event THEN '[' + n.date + '] ' + n.description
                   WHEN n:Fact THEN n.content + ' (' + n.category + ')'
                   WHEN n:Preference THEN n.instruction
               END as content,
               elementId(n) as id
        SKIP $skip LIMIT $limit
    """
    
    with driver.session() as session:
        result = session.run(query, skip=skip, limit=limit)
        memories = [{"id": r["id"], "type": r["type"], "content": r["content"]} for r in result]
    return {"memories": memories}

# --- IMPROVED SPECIALIZED LISTS (Now returning IDs) ---

@router.get("/memories/people")
async def list_people():
    with driver.session() as session:
        result = session.run("""
            MATCH (p:Person)
            OPTIONAL MATCH (u:User)-[k:KNOWS]->(p)
            RETURN elementId(p) as id, 
                   p.name as name, 
                   p.description as description, 
                   k.relation_type as relation, 
                   k.sentiment as sentiment
        """)
        people = [
            {
                "id": r["id"],
                "name": r["name"], 
                "description": r["description"], 
                "relation": r["relation"], 
                "sentiment": r["sentiment"]
            }
            for r in result
        ]
    return {"people": people}

@router.get("/memories/events")
async def list_events():
    with driver.session() as session:
        result = session.run("""
            MATCH (e:Event)
            OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(e)
            RETURN elementId(e) as id,
                   e.description as description, 
                   e.date as date, 
                   collect(p.name) as participants
            ORDER BY e.date DESC
        """)
        events = [
            {
                "id": r["id"],
                "description": r["description"], 
                "date": r["date"], 
                "participants": r["participants"]
            } 
            for r in result
        ]
    return {"events": events}

@router.delete("/memories/{memory_id:path}")
async def delete_memory(memory_id: str):
    decoded_id = unquote(memory_id)
    with driver.session() as session:
        result = session.run("""
            MATCH (n) WHERE elementId(n) = $id
            DETACH DELETE n
            RETURN count(n) as deleted
        """, id=decoded_id)
        record = result.single()
        if record and record["deleted"] > 0:
            logger.info(f"Deleted memory {decoded_id}")
            return {"status": "deleted", "id": decoded_id}
    return {"error": "Memory not found", "id": decoded_id}

# --- NEW EDITING ENDPOINTS ---

@router.patch("/memories/events/{memory_id:path}")
async def update_event(memory_id: str, update: EventUpdate):
    memory_id = unquote(memory_id)
    with driver.session() as session:
        existing = session.run("MATCH (e:Event) WHERE elementId(e) = $id RETURN e.description as d, e.date as t", id=memory_id).single()
        if not existing:
            return {"error": "Event not found"}
            
        new_desc = update.description or existing["d"]
        new_date = update.date or existing["t"]
        
        # 2. Regenerate embedding (Crucial!)
        # Assuming embedding is based on "description + date"
        text_to_embed = f"{new_desc} {new_date}"
        new_embedding = embeddings.embed_query(text_to_embed)
        
        # 3. Update DB
        session.run("""
            MATCH (e:Event) WHERE elementId(e) = $id
            SET e.description = $desc, e.date = $date, e.embedding = $emb
        """, id=memory_id, desc=new_desc, date=new_date, emb=new_embedding)
        
    return {"status": "updated", "id": memory_id}

@router.patch("/memories/people/{memory_id:path}")
async def update_person(memory_id: str, update: PersonUpdate):
    memory_id = unquote(memory_id)
    with driver.session() as session:
        existing = session.run("MATCH (p:Person) WHERE elementId(p) = $id RETURN p.name as name, p.description as d", id=memory_id).single()
        if not existing:
            return {"error": "Person not found"}
            
        new_desc = update.description or existing["d"]
        
        # Embedding usually includes Name + Description
        text_to_embed = f"{existing['name']} {new_desc}"
        new_embedding = embeddings.embed_query(text_to_embed)
        
        session.run("""
            MATCH (p:Person) WHERE elementId(p) = $id
            SET p.description = $desc, p.embedding = $emb
        """, id=memory_id, desc=new_desc, emb=new_embedding)
        
    return {"status": "updated", "id": memory_id}

@router.patch("/memories/people/{memory_id:path}/relationship")
async def update_relationship(memory_id: str, update: RelationshipUpdate):
    memory_id = unquote(memory_id)
    with driver.session() as session:
        session.run("""
            MATCH (u:User)-[r:KNOWS]->(p:Person) 
            WHERE elementId(p) = $id
            SET r.relation_type = $type, r.sentiment = $sent
        """, id=memory_id, type=update.relation_type, sent=update.sentiment)
        
    return {"status": "relationship updated"}

@router.post("/memories/merge")
async def merge_entities(request: MergeEntitiesRequest):
    """Merges duplicate entities by transferring all relationships from duplicate to primary, then deletes duplicate."""
    with driver.session() as session:
        # Verify both entities exist
        primary = session.run("MATCH (n) WHERE elementId(n) = $id RETURN labels(n) as labels", id=request.primary_id).single()
        duplicate = session.run("MATCH (n) WHERE elementId(n) = $id RETURN labels(n) as labels", id=request.duplicate_id).single()
        
        if not primary or not duplicate:
            return {"error": "One or both entities not found"}
        
        # Transfer all incoming relationships
        session.run("""
            MATCH (x)-[r]->(dup) WHERE elementId(dup) = $dup_id
            MATCH (primary) WHERE elementId(primary) = $prim_id
            CREATE (x)-[new_r:DUPLICATE_MERGED]->(primary)
            SET new_r = r
            DELETE r
        """, dup_id=request.duplicate_id, prim_id=request.primary_id)
        
        # Transfer all outgoing relationships
        session.run("""
            MATCH (dup)-[r]->(y) WHERE elementId(dup) = $dup_id
            MATCH (primary) WHERE elementId(primary) = $prim_id
            CREATE (primary)-[new_r:DUPLICATE_MERGED]->(y)
            SET new_r = r
            DELETE r
        """, dup_id=request.duplicate_id, prim_id=request.primary_id)
        
        # Delete the duplicate node
        session.run("""
            MATCH (dup) WHERE elementId(dup) = $dup_id
            DELETE dup
        """, dup_id=request.duplicate_id)
        
        logger.info(f"Merged entity {request.duplicate_id} into {request.primary_id}")
    
    return {"status": "merged", "primary_id": request.primary_id, "merged_id": request.duplicate_id}


@router.get("/memories/duplicates")
async def find_duplicates(threshold: float = 0.85, limit: int = 10):
    """Find potential duplicate memories based on embedding similarity."""
    duplicates = []
    
    with driver.session() as session:
        for label in ["Fact", "Preference", "Person", "Event"]:
            result = session.run(f"""
                MATCH (a:{label})
                WHERE a.embedding IS NOT NULL
                CALL db.index.vector.queryNodes('embedding_index_{label}', 5, a.embedding)
                YIELD node as b, score
                WHERE elementId(a) < elementId(b) AND score >= $threshold
                RETURN elementId(a) as id1, elementId(b) as id2, score,
                    CASE 
                        WHEN '{label}' = 'Person' THEN a.name + ': ' + coalesce(a.description, '')
                        WHEN '{label}' = 'Event' THEN '[' + a.date + '] ' + a.description
                        WHEN '{label}' = 'Fact' THEN a.content
                        WHEN '{label}' = 'Preference' THEN a.instruction
                    END as content1,
                    CASE 
                        WHEN '{label}' = 'Person' THEN b.name + ': ' + coalesce(b.description, '')
                        WHEN '{label}' = 'Event' THEN '[' + b.date + '] ' + b.description
                        WHEN '{label}' = 'Fact' THEN b.content
                        WHEN '{label}' = 'Preference' THEN b.instruction
                    END as content2,
                    '{label}' as type
                ORDER BY score DESC
                LIMIT $limit
            """, threshold=threshold, limit=limit)
            
            for r in result:
                duplicates.append({
                    "id1": r["id1"],
                    "id2": r["id2"],
                    "content1": r["content1"],
                    "content2": r["content2"],
                    "score": r["score"],
                    "type": r["type"]
                })
    
    duplicates.sort(key=lambda x: x["score"], reverse=True)
    return {"duplicates": duplicates[:limit]}