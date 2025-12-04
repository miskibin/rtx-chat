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

# --- CORE UTILS ---


def _ensure_user():
    driver.execute_query("MERGE (u:User {id: 'self'})", database_="neo4j")


def _canonicalize_person(name: str) -> str:
    """
    Finds existing person or creates new one using Fuzzy Matching + Embeddings.
    """
    # 1. Exact or Alias Match
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) WHERE p.name_canonical = $name OR $name IN p.aliases RETURN elementId(p) as id",
        name=name,
        database_="neo4j",
    )
    if records:
        return records[0]["id"]

    # 2. Semantic/Fuzzy Match
    name_emb = embeddings.embed_query(name)
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) RETURN elementId(p) as id, p.name_canonical as name, p.embedding as emb",
        database_="neo4j",
    )

    for r in records:
        if r["emb"]:
            canonical_name = r["name"]
            # Cosine similarity
            sim = sum(a * b for a, b in zip(name_emb, r["emb"])) / (
                sum(a * a for a in name_emb) ** 0.5
                * sum(b * b for b in r["emb"]) ** 0.5
            )

            # Smart Heuristic: High similarity + similar length + same first letter
            if (
                sim > 0.85
                and name[0].lower() == canonical_name[0].lower()
                and abs(len(name) - len(canonical_name)) <= 6
            ):

                logger.info(
                    f"Merging alias '{name}' into '{canonical_name}' (Sim: {sim:.2f})"
                )
                driver.execute_query(
                    "MATCH (p:Person) WHERE elementId(p) = $id SET p.aliases = p.aliases + $name",
                    id=r["id"],
                    name=name,
                    database_="neo4j",
                )
                return r["id"]

    # 3. Create New
    records, _, _ = driver.execute_query(
        """
        CREATE (p:Person {
            id: $id, 
            name_canonical: $name, 
            aliases: [], 
            importance: 0.5, 
            embedding: $emb,
            summary: ''  // Added mutable field for smart summaries
        }) RETURN elementId(p) as id
        """,
        id=str(uuid4()),
        name=name,
        emb=name_emb,
        database_="neo4j",
    )
    return records[0]["id"]


# --- SMART MEMORY FUNCTIONS ---


def save_memory(
    type: str, summary: str, entities: list[str], importance: float, persistence: str
) -> str:
    """
    Smarter save:
    1. If type is 'preference' or 'fact', it looks for existing similar memories to UPDATE.
    2. If type is 'event', it usually appends (history).
    """
    _ensure_user()
    summary_emb = embeddings.embed_query(summary)

    # LOGIC 1: UPSERT FOR FACTS/PREFERENCES (The "Update" requirement)
    if type in ["preference", "fact"]:
        # Check for very similar existing memory to update/refine
        search_res = driver.execute_query(
            """
            MATCH (u:User {id: 'self'})-[:HAS_MEMORY]->(m:Memory {type: $type})
            WITH m, vector.similarity.cosine(m.embedding, $new_emb) AS score
            WHERE score > 0.93  // High threshold means we are talking about the same specific topic
            RETURN elementId(m) as id, m.summary as old_summary, score
            ORDER BY score DESC LIMIT 1
            """,
            type=type,
            new_emb=summary_emb,
            database_="neo4j",
        )[0]

        if search_res:
            old_id = search_res[0]["id"]
            logger.info(
                f"Updating existing memory (Score: {search_res[0]['score']:.2f}): '{search_res[0]['old_summary']}' -> '{summary}'"
            )

            driver.execute_query(
                """
                MATCH (m:Memory) WHERE elementId(m) = $id 
                SET m.summary = $summary, 
                    m.embedding = $emb, 
                    m.timestamp = $ts,    // Update timestamp to show it was refreshed
                    m.importance = $imp 
                """,
                id=old_id,
                summary=summary,
                emb=summary_emb,
                ts=datetime.now().isoformat(),
                imp=importance,
                database_="neo4j",
            )
            return "updated_existing"

    # LOGIC 2: CREATE NEW (Default behavior)
    mem_id = str(uuid4())
    driver.execute_query(
        "CREATE (m:Memory {id: $id, type: $type, summary: $summary, timestamp: $ts, importance: $imp, persistence: $pers, embedding: $emb})",
        id=mem_id,
        type=type,
        summary=summary,
        ts=datetime.now().isoformat(),
        imp=importance,
        pers=persistence,
        emb=summary_emb,
        database_="neo4j",
    )

    driver.execute_query(
        "MATCH (u:User {id: 'self'}), (m:Memory {id: $mid}) CREATE (u)-[:HAS_MEMORY]->(m)",
        mid=mem_id,
        database_="neo4j",
    )

    # Link Entities
    for entity in entities:
        person_id = _canonicalize_person(entity)
        driver.execute_query(
            "MATCH (m:Memory {id: $mid}), (p:Person) WHERE elementId(p) = $pid CREATE (m)-[:REFERS_TO]->(p)",
            mid=mem_id,
            pid=person_id,
            database_="neo4j",
        )

        # LOGIC 3: AUTO-UPDATE PERSON PROFILE
        # If we learn a "fact" about a person, we implicitly update their node bio
        if type == "person" or type == "fact":
            update_person_bio(person_id, summary)

    return mem_id


def update_person_bio(element_id: str, new_info: str):
    """
    Directly updates the 'summary' property on the Person node.
    This creates a fast-access 'State' rather than just a log of memories.
    """
    # In a full LLM app, you would read the old bio, ask LLM to merge with new_info, and save back.
    # Here, we will append for simplicity, but this is where the "Smart" logic lives.

    driver.execute_query(
        """
        MATCH (p:Person) WHERE elementId(p) = $id
        SET p.summary = 
            CASE 
                WHEN p.summary IS NULL OR p.summary = '' THEN $info
                ELSE p.summary + ' | ' + $info 
            END
        """,
        id=element_id,
        info=new_info,
        database_="neo4j",
    )


def get_person_state(name: str) -> dict:
    """
    Retrieves the Consolidated State of a person, not just a list of memories.
    """
    pid = _canonicalize_person(name)
    records, _, _ = driver.execute_query(
        """
        MATCH (p:Person) WHERE elementId(p) = $pid
        OPTIONAL MATCH (p)<-[:REFERS_TO]-(m:Memory)
        RETURN p.name_canonical as name, 
               p.summary as summary, 
               p.aliases as aliases,
               collect(m.summary) as raw_memories
        """,
        pid=pid,
        database_="neo4j",
    )
    return dict(records[0])

def _get_entity_from_message_context(user_message_emb: list[float]) -> str | None:
    """Detects if the user message semantically refers to a known Person."""
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) RETURN elementId(p) as id, p.embedding as emb, p.name_canonical as name",
        database_="neo4j"
    )

    best_match_id = None
    best_score = 0.0
    
    for r in records:
        if r["emb"]:
            # Cosine similarity between message embedding and person name embedding
            # This is a key part of "entity detection" when the query is simple like "Who is X?"
            sim = sum(a*b for a,b in zip(user_message_emb, r["emb"])) / (sum(a*a for a in user_message_emb)**0.5 * sum(b*b for b in r["emb"])**0.5)
            
            # High threshold (0.90) to ensure high confidence that the query is about the person
            if sim > 0.90 and sim > best_score:
                best_score = sim
                best_match_id = r["id"]
                logger.debug(f"Automatic Entity Detection: {r['name']} matched with score {sim:.2f}")

    return best_match_id

def get_context_aware_memories(user_message: str, top_k: int = 5) -> list[dict]:
    """
    Retrieves memories using a HYBRID approach:
    1. Vector Search (Semantic) for all memories.
    2. Structural Search (Graph) automatically enabled if an entity is detected in the message.
    
    Returns memories with connected entities to reconstruct context.
    """
    msg_emb = embeddings.embed_query(user_message)
    
    # NEW: Automatically detect entity based on semantic similarity of the message
    person_id = _get_entity_from_message_context(msg_emb)

    # 1. Base Vector Search Query (applies to all memories)
    query_vector = """
        MATCH (u:User {id: 'self'})-[:HAS_MEMORY]->(m:Memory)
        WITH m, vector.similarity.cosine(m.embedding, $emb) AS score
        WHERE score > 0.5
        RETURN elementId(m) as eid, m.id as id, m.type as type, m.summary as summary, score
    """
    params = {"emb": msg_emb}
    
    # 2. Entity-Specific Graph Search (Hybrid Component)
    entity_filter_part = ""
    if person_id:
        logger.info(f"Hybrid Search Activated for Entity ID: {person_id}")
        # Add a structural component to the query to retrieve all memories directly linked to this entity.
        # We use UNION to combine semantic search results with structural search results.
        entity_filter_part = f"""
            UNION
            MATCH (u:User {{id: 'self'}})-[:HAS_MEMORY]->(m:Memory)-[:REFERS_TO]->(p:Person)
            WHERE elementId(p) = '{person_id}'
            // Give these structural results a base score of 0.6 to ensure they rank reasonably well
            RETURN elementId(m) as eid, m.id as id, m.type as type, m.summary as summary, 0.6 as score
            """
    
    final_query = f"""
        {query_vector}
        {entity_filter_part}
    """
    
    # 3. Final Aggregation and Retrieval
    records, _, _ = driver.execute_query(final_query, **params, database_="neo4j")
    
    # Deduplicate memories by elementId (eid) and select the highest score if duplicates exist (from UNION)
    deduplicated_mems = {}
    for r in records:
        eid = r["eid"]
        if eid not in deduplicated_mems or r["score"] > deduplicated_mems[eid]["score"]:
            deduplicated_mems[eid] = dict(r)

    # Convert back to list for final processing
    final_mems = list(deduplicated_mems.values())
    
    # Sort and take top_k
    final_mems.sort(key=lambda x: x["score"], reverse=True)
    top_mems = final_mems[:top_k]

    # 4. Fetch context (connected people names) for the top memories
    results = []
    mem_eids = [m["eid"] for m in top_mems]
    
    if mem_eids:
        # Query to fetch all connected people for the top K memories in one go
        context_query = """
            MATCH (m)-[:REFERS_TO]->(p:Person)
            WHERE elementId(m) IN $eids
            RETURN elementId(m) as eid, collect(p.name_canonical) as people
        """
        context_records, _, _ = driver.execute_query(context_query, eids=mem_eids, database_="neo4j")
        
        context_map = {r["eid"]: r["people"] for r in context_records}

        for mem in top_mems:
            people = context_map.get(mem["eid"], [])
            context_prefix = ""
            if people:
                context_prefix = f"[With {', '.join(people)}] "
            
            results.append({
                "summary": context_prefix + mem["summary"], # Enriching the text!
                "score": mem["score"],
                "type": mem["type"]
            })
            
    return results


def list_memories_raw():
    records, _, _ = driver.execute_query(
        "MATCH (m:Memory) RETURN m.type as type, m.summary as summary", database_="neo4j"
    )
    return [dict(r) for r in records]
