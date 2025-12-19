from fastapi import APIRouter, Path, HTTPException
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
from loguru import logger
import os
from dotenv import load_dotenv
from urllib.parse import unquote
from app.schemas import MergeEntitiesRequest, EventUpdate, PersonUpdate, RelationshipUpdate
from app.graph_models import Agent

load_dotenv()

router = APIRouter(prefix="/agents/{agent_name}/memories", tags=["memories"])

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
driver = GraphDatabase.driver(URI, auth=AUTH)
embeddings = OllamaEmbeddings(model="embeddinggemma")


def verify_agent(agent_name: str):
    """Verify agent exists, raise 404 if not."""
    agent = Agent.get(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    return agent


@router.get("")
async def list_memories(agent_name: str, skip: int = 0, limit: int = 50, type_filter: str = None):
    """
    Lists memories for an agent with pagination. 
    Optional type_filter: 'Person', 'Event', 'Fact', 'Preference'
    """
    verify_agent(agent_name)
    
    with driver.session() as session:
        # Build query to get memories linked to this agent
        base_query = """
            MATCH (a:Agent {name: $agent_name})
            MATCH (a)-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
        """
        
        if type_filter:
            base_query += f" WHERE labels(n)[0] = '{type_filter}'"
        
        query = base_query + """
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
        
        result = session.run(query, agent_name=agent_name, skip=skip, limit=limit)
        memories = [{"id": r["id"], "type": r["type"], "content": r["content"]} for r in result]
    return {"memories": memories}


@router.get("/people")
async def list_people(agent_name: str):
    """List all people in this agent's memory."""
    verify_agent(agent_name)
    
    with driver.session() as session:
        result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p:Person)
            OPTIONAL MATCH (u:User)-[k:KNOWS]->(p)
            RETURN elementId(p) as id, 
                   p.name as name, 
                   p.description as description, 
                   k.relation_type as relation, 
                   k.sentiment as sentiment
        """, agent_name=agent_name)
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


@router.get("/events")
async def list_events(agent_name: str):
    """List all events in this agent's memory."""
    verify_agent(agent_name)
    
    with driver.session() as session:
        result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_EVENT]->(e:Event)
            OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(e)
            RETURN elementId(e) as id,
                   e.description as description, 
                   e.date as date, 
                   collect(p.name) as participants
            ORDER BY e.date DESC
        """, agent_name=agent_name)
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


@router.get("/graph")
async def get_memory_graph(agent_name: str):
    """Get graph data for visualization (nodes + links) scoped to this agent."""
    verify_agent(agent_name)
    
    with driver.session() as session:
        # Get User node
        user_result = session.run("""
            MATCH (u:User)
            RETURN elementId(u) as id, 'User' as type, 'You' as name
            LIMIT 1
        """)
        nodes = [{"id": r["id"], "type": r["type"], "name": r["name"]} for r in user_result]
        
        # Get all memory nodes linked to this agent
        nodes_result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            RETURN elementId(n) as id, labels(n)[0] as type,
                CASE 
                    WHEN n:Person THEN n.name
                    WHEN n:Event THEN coalesce(substring(n.description, 0, 25), 'Event')
                    WHEN n:Fact THEN coalesce(substring(n.content, 0, 25), 'Fact')
                    WHEN n:Preference THEN coalesce(substring(n.instruction, 0, 25), 'Pref')
                END as name
        """, agent_name=agent_name)
        nodes.extend([{"id": r["id"], "type": r["type"], "name": r["name"]} for r in nodes_result])
        
        node_ids = {n["id"] for n in nodes}
        
        # Get relationships from User to agent's memories
        user_links_result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            MATCH (u:User)-[r]->(n)
            RETURN elementId(u) as source, elementId(n) as target, type(r) as type
        """, agent_name=agent_name)
        links = [{"source": r["source"], "target": r["target"], "type": r["type"]} for r in user_links_result]
        
        # Get relationships between agent's memory nodes
        links_result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n1)
            MATCH (a)-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n2)
            MATCH (n1)-[r]->(n2)
            RETURN elementId(n1) as source, elementId(n2) as target, type(r) as type
        """, agent_name=agent_name)
        links.extend([{"source": r["source"], "target": r["target"], "type": r["type"]} for r in links_result])
        
    return {"nodes": nodes, "links": links}


@router.get("/duplicates")
async def find_duplicates(agent_name: str, threshold: float = 0.85, limit: int = 10):
    """Find potential duplicate memories based on embedding similarity within this agent."""
    verify_agent(agent_name)
    duplicates = []
    
    with driver.session() as session:
        for label in ["Fact", "Preference", "Event"]:
            rel_type = f"HAS_{label.upper()}"
            result = session.run(f"""
                MATCH (ag:Agent {{name: $agent_name}})-[:{rel_type}]->(a:{label})
                WHERE a.embedding IS NOT NULL
                CALL db.index.vector.queryNodes('embedding_index_{label}', 5, a.embedding)
                YIELD node as b, score
                WHERE elementId(a) < elementId(b) 
                    AND score >= $threshold
                    AND (ag)-[:{rel_type}]->(b)
                RETURN elementId(a) as id1, elementId(b) as id2, score,
                    CASE 
                        WHEN '{label}' = 'Event' THEN '[' + a.date + '] ' + a.description
                        WHEN '{label}' = 'Fact' THEN a.content
                        WHEN '{label}' = 'Preference' THEN a.instruction
                    END as content1,
                    CASE 
                        WHEN '{label}' = 'Event' THEN '[' + b.date + '] ' + b.description
                        WHEN '{label}' = 'Fact' THEN b.content
                        WHEN '{label}' = 'Preference' THEN b.instruction
                    END as content2,
                    '{label}' as type
                ORDER BY score DESC
                LIMIT $limit
            """, agent_name=agent_name, threshold=threshold, limit=limit)
            
            for r in result:
                duplicates.append({
                    "id1": r["id1"],
                    "id2": r["id2"],
                    "content1": r["content1"],
                    "content2": r["content2"],
                    "score": r["score"],
                    "type": r["type"]
                })
        
        # For Person, only consider duplicates if names match (case-insensitive)
        person_result = session.run("""
            MATCH (ag:Agent {name: $agent_name})-[:HAS_PERSON]->(a:Person)
            WHERE a.embedding IS NOT NULL
            CALL db.index.vector.queryNodes('embedding_index_Person', 5, a.embedding)
            YIELD node as b, score
            WHERE elementId(a) < elementId(b) 
                AND score >= $threshold
                AND toLower(trim(a.name)) = toLower(trim(b.name))
                AND (ag)-[:HAS_PERSON]->(b)
            RETURN elementId(a) as id1, elementId(b) as id2, score,
                a.name + ': ' + coalesce(a.description, '') as content1,
                b.name + ': ' + coalesce(b.description, '') as content2,
                'Person' as type
            ORDER BY score DESC
            LIMIT $limit
        """, agent_name=agent_name, threshold=threshold, limit=limit)
        
        for r in person_result:
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


@router.get("/{memory_id:path}/connections")
async def get_connections(agent_name: str, memory_id: str):
    """Get all connections/relationships for a given memory entity."""
    verify_agent(agent_name)
    memory_id = unquote(memory_id)
    
    with driver.session() as session:
        # First, verify the memory belongs to this agent and determine the type
        type_result = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            WHERE elementId(n) = $id
            RETURN labels(n)[0] as type
        """, agent_name=agent_name, id=memory_id).single()
        
        if not type_result:
            return {"error": "Memory not found or not owned by this agent", "events": [], "people": []}
        
        node_type = type_result["type"]
        events = []
        people = []
        
        if node_type == "Person":
            # Get events this person participated in (scoped to agent)
            events_result = session.run("""
                MATCH (a:Agent {name: $agent_name})-[:HAS_EVENT]->(e:Event)
                MATCH (p:Person)-[r:PARTICIPATED_IN]->(e)
                WHERE elementId(p) = $id
                RETURN elementId(e) as id, e.description as description, e.date as date, r.role as role
            """, agent_name=agent_name, id=memory_id)
            events = [
                {"id": r["id"], "description": r["description"], "date": r["date"], "role": r["role"]}
                for r in events_result
            ]
            
            # Get other people this person knows (scoped to agent)
            people_out_result = session.run("""
                MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p2:Person)
                MATCH (p1:Person)-[r:KNOWS]->(p2)
                WHERE elementId(p1) = $id
                RETURN elementId(p2) as id, p2.name as name, r.relation_type as relation, r.sentiment as sentiment, r.since as since
            """, agent_name=agent_name, id=memory_id)
            
            people_in_result = session.run("""
                MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p1:Person)
                MATCH (p1)-[r:KNOWS]->(p2:Person)
                WHERE elementId(p2) = $id
                RETURN elementId(p1) as id, p1.name as name, r.relation_type as relation, r.sentiment as sentiment, r.since as since
            """, agent_name=agent_name, id=memory_id)
            
            seen_ids = set()
            for r in people_out_result:
                if r["id"] not in seen_ids:
                    people.append({"id": r["id"], "name": r["name"], "relation": r["relation"], "sentiment": r["sentiment"], "since": r["since"], "direction": "outgoing"})
                    seen_ids.add(r["id"])
            for r in people_in_result:
                if r["id"] not in seen_ids:
                    people.append({"id": r["id"], "name": r["name"], "relation": r["relation"], "sentiment": r["sentiment"], "since": r["since"], "direction": "incoming"})
                    seen_ids.add(r["id"])
                    
        elif node_type == "Event":
            # Get all participants of this event (scoped to agent)
            people_result = session.run("""
                MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p:Person)
                MATCH (p)-[r:PARTICIPATED_IN]->(e:Event)
                WHERE elementId(e) = $id
                RETURN elementId(p) as id, p.name as name, p.description as description, r.role as role
            """, agent_name=agent_name, id=memory_id)
            people = [
                {"id": r["id"], "name": r["name"], "description": r["description"], "role": r["role"]}
                for r in people_result
            ]
        
        return {"type": node_type, "events": events, "people": people}


@router.delete("/{memory_id:path}")
async def delete_memory(agent_name: str, memory_id: str):
    """Delete a memory from this agent."""
    verify_agent(agent_name)
    decoded_id = unquote(memory_id)
    
    with driver.session() as session:
        # Verify memory belongs to this agent before deleting
        check = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            WHERE elementId(n) = $id
            RETURN elementId(n) as id
        """, agent_name=agent_name, id=decoded_id).single()
        
        if not check:
            return {"error": "Memory not found or not owned by this agent", "id": decoded_id}
        
        result = session.run("""
            MATCH (n) WHERE elementId(n) = $id
            DETACH DELETE n
            RETURN count(n) as deleted
        """, id=decoded_id)
        record = result.single()
        if record and record["deleted"] > 0:
            logger.info(f"Deleted memory {decoded_id} from agent {agent_name}")
            return {"status": "deleted", "id": decoded_id}
    return {"error": "Memory not found", "id": decoded_id}


@router.patch("/events/{memory_id:path}")
async def update_event(agent_name: str, memory_id: str, update: EventUpdate):
    """Update an event in this agent's memory."""
    verify_agent(agent_name)
    memory_id = unquote(memory_id)
    
    with driver.session() as session:
        # Verify ownership
        check = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_EVENT]->(e:Event)
            WHERE elementId(e) = $id
            RETURN e.description as d, e.date as t
        """, agent_name=agent_name, id=memory_id).single()
        
        if not check:
            return {"error": "Event not found or not owned by this agent"}
            
        new_desc = update.description or check["d"]
        new_date = update.date or check["t"]
        
        text_to_embed = f"{new_desc} {new_date}"
        new_embedding = embeddings.embed_query(text_to_embed)
        
        session.run("""
            MATCH (e:Event) WHERE elementId(e) = $id
            SET e.description = $desc, e.date = $date, e.embedding = $emb
        """, id=memory_id, desc=new_desc, date=new_date, emb=new_embedding)
        
    return {"status": "updated", "id": memory_id}


@router.patch("/people/{memory_id:path}")
async def update_person(agent_name: str, memory_id: str, update: PersonUpdate):
    """Update a person in this agent's memory."""
    verify_agent(agent_name)
    memory_id = unquote(memory_id)
    
    with driver.session() as session:
        check = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p:Person)
            WHERE elementId(p) = $id
            RETURN p.name as name, p.description as d
        """, agent_name=agent_name, id=memory_id).single()
        
        if not check:
            return {"error": "Person not found or not owned by this agent"}
            
        new_desc = update.description or check["d"]
        
        text_to_embed = f"{check['name']} {new_desc}"
        new_embedding = embeddings.embed_query(text_to_embed)
        
        session.run("""
            MATCH (p:Person) WHERE elementId(p) = $id
            SET p.description = $desc, p.embedding = $emb
        """, id=memory_id, desc=new_desc, emb=new_embedding)
        
    return {"status": "updated", "id": memory_id}


@router.patch("/people/{memory_id:path}/relationship")
async def update_relationship(agent_name: str, memory_id: str, update: RelationshipUpdate):
    """Update relationship with a person in this agent's memory."""
    verify_agent(agent_name)
    memory_id = unquote(memory_id)
    
    with driver.session() as session:
        # Verify ownership
        check = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON]->(p:Person)
            WHERE elementId(p) = $id
            RETURN elementId(p) as id
        """, agent_name=agent_name, id=memory_id).single()
        
        if not check:
            return {"error": "Person not found or not owned by this agent"}
        
        session.run("""
            MATCH (u:User)-[r:KNOWS]->(p:Person) 
            WHERE elementId(p) = $id
            SET r.relation_type = $type, r.sentiment = $sent
        """, id=memory_id, type=update.relation_type, sent=update.sentiment)
        
    return {"status": "relationship updated"}


@router.post("/merge")
async def merge_entities(agent_name: str, request: MergeEntitiesRequest):
    """Merges duplicate entities within this agent by transferring relationships."""
    verify_agent(agent_name)
    
    with driver.session() as session:
        # Verify both entities belong to this agent
        primary = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            WHERE elementId(n) = $id
            RETURN labels(n) as labels
        """, agent_name=agent_name, id=request.primary_id).single()
        
        duplicate = session.run("""
            MATCH (a:Agent {name: $agent_name})-[:HAS_PERSON|HAS_EVENT|HAS_FACT|HAS_PREFERENCE]->(n)
            WHERE elementId(n) = $id
            RETURN labels(n) as labels
        """, agent_name=agent_name, id=request.duplicate_id).single()
        
        if not primary or not duplicate:
            return {"error": "One or both entities not found or not owned by this agent"}
        
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
        
        logger.info(f"Merged entity {request.duplicate_id} into {request.primary_id} for agent {agent_name}")
    
    return {"status": "merged", "primary_id": request.primary_id, "merged_id": request.duplicate_id}
