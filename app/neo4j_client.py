from neo4j import GraphDatabase
from loguru import logger
from langchain_ollama import OllamaEmbeddings
from rapidfuzz import fuzz
import os
import re
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
    type: str, summary: str, entities: list[str], importance: float, persistence: str,
    relationship_type: str = "RELATES_TO"
) -> str:
    """
    Smarter save:
    1. If type is 'preference' or 'fact', it looks for existing similar memories to UPDATE.
    2. If type is 'event', it usually appends (history).
    
    Args:
        relationship_type: The type of relationship between Memory and Person entities.
                          Examples: "HELPED_BY", "MET_WITH", "DISCUSSED_WITH", "ANNOYED_BY"
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

    # Link Entities with dynamic relationship type
    # Sanitize relationship_type to prevent injection (only alphanumeric and underscore)
    safe_rel_type = "".join(c for c in relationship_type if c.isalnum() or c == "_").upper()
    if not safe_rel_type:
        safe_rel_type = "RELATES_TO"
    
    for entity in entities:
        person_id = _canonicalize_person(entity)
        # Neo4j doesn't support parameterized relationship types, so we use f-string
        # The relationship type is sanitized above to prevent injection
        driver.execute_query(
            f"MATCH (m:Memory {{id: $mid}}), (p:Person) WHERE elementId(p) = $pid CREATE (m)-[:{safe_rel_type}]->(p)",
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
    Now includes relationship types for each memory.
    """
    pid = _canonicalize_person(name)
    records, _, _ = driver.execute_query(
        """
        MATCH (p:Person) WHERE elementId(p) = $pid
        OPTIONAL MATCH (p)<-[r]-(m:Memory)
        RETURN p.name_canonical as name, 
               p.summary as summary, 
               p.aliases as aliases,
               collect({summary: m.summary, relationship: type(r)}) as raw_memories
        """,
        pid=pid,
        database_="neo4j",
    )
    return dict(records[0])

def _extract_words_from_message(message: str) -> list[str]:
    """Extract individual words from message for fuzzy matching."""
    words = re.findall(r'\b\w+\b', message.lower())
    return words


def _get_entity_subgraph(entity_id: str, limit: int = 10) -> dict:
    """
    Retrieves 1-hop subgraph around an entity (Person node).
    Returns the entity info and all directly connected memories with their relationship types.
    """
    records, _, _ = driver.execute_query(
        """
        MATCH (p:Person) WHERE elementId(p) = $pid
        OPTIONAL MATCH (p)<-[r]-(m:Memory)
        WITH p, m, r
        ORDER BY m.importance DESC, m.timestamp DESC
        LIMIT $limit
        RETURN p.name_canonical as name,
               p.summary as person_summary,
               p.aliases as aliases,
               collect({
                   eid: elementId(m),
                   id: m.id,
                   summary: m.summary,
                   type: m.type,
                   relationship: type(r),
                   importance: m.importance
               }) as memories
        """,
        pid=entity_id,
        limit=limit,
        database_="neo4j",
    )
    
    if not records:
        return {"name": None, "person_summary": None, "aliases": [], "memories": []}
    
    result = dict(records[0])
    # Filter out None memories (from OPTIONAL MATCH when no memories exist)
    result["memories"] = [m for m in result["memories"] if m.get("id")]
    return result


def _detect_entity_hybrid(user_message: str, user_message_emb: list[float] | None = None) -> str | None:
    """
    Hybrid entity detection combining:
    1. Fuzzy string matching (Levenshtein) on person names and aliases
    2. Embedding similarity as fallback
    
    This catches cases like "alek znow mnie wkurwil" where the message
    semantically differs from the name but contains it as a substring.
    """
    records, _, _ = driver.execute_query(
        "MATCH (p:Person) RETURN elementId(p) as id, p.embedding as emb, p.name_canonical as name, p.aliases as aliases",
        database_="neo4j"
    )
    
    if not records:
        return None
    
    message_words = _extract_words_from_message(user_message)
    best_match_id = None
    best_score = 0.0
    match_method = None
    
    for r in records:
        canonical_name = r["name"]
        aliases = r["aliases"] or []
        all_names = [canonical_name] + aliases
        
        # METHOD 1: Fuzzy string matching on each word in the message
        for word in message_words:
            for name in all_names:
                # Exact match (case insensitive)
                if word == name.lower():
                    logger.info(f"Entity Detection (exact match): '{name}' found in message")
                    return r["id"]
                
                # Fuzzy match with high threshold (rapidfuzz returns 0-100)
                ratio = fuzz.ratio(word, name.lower()) / 100.0
                if ratio > 0.8 and ratio > best_score:
                    best_score = ratio
                    best_match_id = r["id"]
                    match_method = f"fuzzy:{name}:{ratio:.2f}"
    
    # If fuzzy matching found something good, return it
    if best_match_id and best_score > 0.8:
        logger.info(f"Entity Detection ({match_method})")
        return best_match_id
    
    # METHOD 2: Embedding similarity as fallback - ONLY for very short queries
    # that might be just asking "Who is X?" style questions.
    # For longer queries, rely only on fuzzy matching to avoid false positives.
    if len(message_words) <= 4:  # Short query like "Tell me about Alek"
        if user_message_emb is None:
            user_message_emb = embeddings.embed_query(user_message)
        
        best_match_id = None
        best_score = 0.0
        
        for r in records:
            if r["emb"]:
                # Cosine similarity
                sim = sum(a*b for a,b in zip(user_message_emb, r["emb"])) / (
                    sum(a*a for a in user_message_emb)**0.5 * sum(b*b for b in r["emb"])**0.5
                )
                
                # High threshold (0.85) - only trigger for clear entity references
                if sim > 0.85 and sim > best_score:
                    best_score = sim
                    best_match_id = r["id"]
                    match_method = f"embedding:{r['name']}:{sim:.2f}"
        
        if best_match_id:
            logger.info(f"Entity Detection ({match_method})")
            return best_match_id
    
    return None

def get_context_aware_memories(user_message: str, top_k: int = 5) -> list[dict]:
    """
    Retrieves memories using a HYBRID approach:
    1. Vector Search (Semantic) for all memories.
    2. Structural Search (Graph) via 1-hop subgraph when entity is detected.
    
    Uses hybrid entity detection (fuzzy + embedding) to catch mentions like
    "alek znow mnie wkurwil" even when semantics differ from the entity name.
    
    Returns memories with connected entities and relationship types.
    """
    msg_emb = embeddings.embed_query(user_message)
    
    # Hybrid entity detection: fuzzy string matching + embedding similarity
    person_id = _detect_entity_hybrid(user_message, msg_emb)
    
    # Collect memories from different sources with scores
    all_memories = {}  # eid -> memory dict with score
    
    # 1. Vector Search (Semantic) - applies to all memories
    vector_records, _, _ = driver.execute_query(
        """
        MATCH (u:User {id: 'self'})-[:HAS_MEMORY]->(m:Memory)
        WITH m, vector.similarity.cosine(m.embedding, $emb) AS score
        WHERE score > 0.5
        RETURN elementId(m) as eid, m.id as id, m.type as type, m.summary as summary, score
        """,
        emb=msg_emb,
        database_="neo4j"
    )
    
    for r in vector_records:
        all_memories[r["eid"]] = {
            "eid": r["eid"],
            "id": r["id"],
            "type": r["type"],
            "summary": r["summary"],
            "score": r["score"],
            "source": "semantic"
        }
    
    # 2. Graph Search (1-hop subgraph) - if entity detected
    entity_context = None
    if person_id:
        logger.info(f"Hybrid Search: Retrieving 1-hop subgraph for entity ID: {person_id}")
        subgraph = _get_entity_subgraph(person_id, limit=top_k * 2)
        entity_context = {
            "name": subgraph["name"],
            "summary": subgraph["person_summary"]
        }
        
        # Add subgraph memories with HIGH score - entity mention means high relevance
        # When user explicitly mentions an entity, those memories should be prioritized
        for mem in subgraph["memories"]:
            eid = mem["eid"]
            # High base score (0.9) ensures entity memories rank above generic semantic matches
            structural_score = 0.9
            
            if eid in all_memories:
                # Boost existing semantic match - entity + semantic = very relevant
                all_memories[eid]["score"] = max(all_memories[eid]["score"], structural_score + 0.05)
                all_memories[eid]["relationship"] = mem["relationship"]
            else:
                # Add pure structural match with high score
                all_memories[eid] = {
                    "eid": eid,
                    "id": mem["id"],
                    "type": mem["type"],
                    "summary": mem["summary"],
                    "score": structural_score,
                    "source": "graph",
                    "relationship": mem["relationship"]
                }
    
    # 3. Sort by score and take top_k
    sorted_mems = sorted(all_memories.values(), key=lambda x: x["score"], reverse=True)[:top_k]
    
    # 4. Fetch additional context (connected people) for memories without relationship info
    results = []
    mem_eids_needing_context = [m["eid"] for m in sorted_mems if "relationship" not in m]
    
    context_map = {}
    if mem_eids_needing_context:
        context_query = """
            MATCH (m)-[r]->(p:Person)
            WHERE elementId(m) IN $eids
            RETURN elementId(m) as eid, collect({name: p.name_canonical, rel: type(r)}) as connections
        """
        context_records, _, _ = driver.execute_query(context_query, eids=mem_eids_needing_context, database_="neo4j")
        context_map = {r["eid"]: r["connections"] for r in context_records}
    
    # 5. Format results with relationship context
    for mem in sorted_mems:
        context_prefix = ""
        
        if "relationship" in mem and entity_context:
            # Direct entity match - use the relationship type
            context_prefix = f"[{mem['relationship']} {entity_context['name']}] "
        else:
            # Use fetched context
            connections = context_map.get(mem["eid"], [])
            if connections:
                conn_strs = [f"{c['rel']} {c['name']}" for c in connections if c.get('name')]
                if conn_strs:
                    context_prefix = f"[{', '.join(conn_strs)}] "
        
        results.append({
            "summary": context_prefix + mem["summary"],
            "score": mem["score"],
            "type": mem["type"]
        })
    
    return results


def list_memories_raw():
    records, _, _ = driver.execute_query(
        "MATCH (m:Memory) RETURN m.id as id, m.type as type, m.summary as summary", database_="neo4j"
    )
    return [dict(r) for r in records]


def delete_memory(memory_id: str) -> bool:
    """Delete a memory by its ID."""
    result = driver.execute_query(
        "MATCH (m:Memory {id: $mid}) DETACH DELETE m RETURN count(m) as deleted",
        mid=memory_id,
        database_="neo4j",
    )
    deleted = result[0][0]["deleted"] if result[0] else 0
    if deleted > 0:
        logger.info(f"Deleted memory: {memory_id}")
    return deleted > 0


def update_memory(memory_id: str, new_summary: str) -> bool:
    """Update a memory's summary and re-embed it."""
    new_emb = embeddings.embed_query(new_summary)
    result = driver.execute_query(
        """
        MATCH (m:Memory {id: $mid})
        SET m.summary = $summary, m.embedding = $emb, m.timestamp = $ts
        RETURN m.id as id
        """,
        mid=memory_id,
        summary=new_summary,
        emb=new_emb,
        ts=datetime.now().isoformat(),
        database_="neo4j",
    )
    updated = len(result[0]) > 0
    if updated:
        logger.info(f"Updated memory {memory_id}: {new_summary[:50]}...")
    return updated


def list_people() -> list[dict]:
    """List all people in the knowledge graph."""
    records, _, _ = driver.execute_query(
        """
        MATCH (p:Person)
        OPTIONAL MATCH (p)<-[r]-(m:Memory)
        RETURN p.name_canonical as name, 
               p.aliases as aliases,
               count(m) as memory_count
        ORDER BY memory_count DESC
        """,
        database_="neo4j",
    )
    return [dict(r) for r in records]
