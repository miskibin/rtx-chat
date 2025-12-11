from langchain.tools import tool
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
from datetime import datetime
from typing import Literal, Optional
from loguru import logger
import os
from dotenv import load_dotenv

from app.graph_models import (
    Person, Event, Fact, Preference,
    KnowsRelationship, ParticipatedInRelationship, MentionsRelationship,
)

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
_driver = GraphDatabase.driver(URI, auth=AUTH, max_connection_lifetime=300, keep_alive=True)
_embeddings = OllamaEmbeddings(model="embeddinggemma")

def get_session():
    return _driver.session(database="neo4j")


def check_duplicate(label: str, embedding: list[float], threshold: float = 0.93) -> tuple[bool, str | None, float]:
    with get_session() as session:
        result = session.run(
            f"CALL db.index.vector.queryNodes('embedding_index_{label}', 1, $embedding) YIELD node, score RETURN node, score, elementId(node) as id",
            embedding=embedding
        ).single()
        if result and result["score"] >= threshold:
            node = result["node"]
            content = node.get("content") or node.get("instruction") or node.get("description") or ""
            return True, result["id"], result["score"], content
        return False, None, 0.0, None


def list_people() -> list[str]:
    with get_session() as session:
        result = session.run("MATCH (p:Person) RETURN p.name as name")
        return [r["name"] for r in result]


SIMILARITY_THRESHOLD = 0.65


@tool
def retrieve_context(
    query: str, entity_names: list[str] = [], node_labels: list[str] = [], limit: int = 5
) -> str:
    """Semantic search in memory database. Returns facts, people, events, preferences.
    
    Args:
        query: Search text. Use descriptive phrases like "user's work", "hobbies", "family members"
        entity_names: ONLY for Person lookup by exact name, e.g. ["Oliwka", "Jan"]. NOT for "User"!
        node_labels: Filter results: ["Person", "Fact", "Event", "Preference"]
    """
    label_to_model = {"Person": Person, "Event": Event, "Fact": Fact, "Preference": Preference}
    
    with get_session() as session:
        if entity_names:
            result = session.run(
                """MATCH (p:Person) WHERE p.name IN $names
                OPTIONAL MATCH (u:User)-[k:KNOWS]->(p)
                OPTIONAL MATCH (p)-[r:PARTICIPATED_IN]->(e:Event)
                RETURN p, k, collect(DISTINCT {event: e, rel: r}) as events, elementId(p) as id""",
                names=entity_names
            )
            output = []
            for rec in result:
                person_str = str(Person(**dict(rec["p"])))
                if rec["k"]:
                    person_str += f" [{rec['k']['relation_type']}, {rec['k']['sentiment']}]"
                output.append(f"{person_str} [ID: {rec['id']}]")
                for evt in rec["events"]:
                    if evt["event"]:
                        output.append(f"  → {str(Event(**dict(evt['event'])))}")
            return "\n".join(output) if output else "No results"
        
        query_embedding = _embeddings.embed_query(query)
        labels = node_labels or ["Person", "Event", "Fact", "Preference"]
        all_results = []
        
        for label in labels:
            if label == "Person":
                result = session.run(
                    f"CALL db.index.vector.queryNodes('embedding_index_{label}', $limit, $embedding) YIELD node, score "
                    f"OPTIONAL MATCH (u:User)-[k:KNOWS]->(node) RETURN node, score, k, elementId(node) as id",
                    embedding=query_embedding, limit=limit
                )
                for rec in result:
                    if rec["score"] < SIMILARITY_THRESHOLD:
                        logger.debug(f"Skipping Person with score {rec['score']}")
                        continue
                    person = Person(**dict(rec["node"]))
                    rel = f" → {rec['k']['relation_type']} ({rec['k']['sentiment']})" if rec["k"] else ""
                    logger.debug(f"Retrieved Person: {person.name} (score: {rec['score']:.3f})")
                    all_results.append({"output": f"Person: {person}{rel} [ID: {rec['id']}]", "score": rec["score"]})
            elif label == "Event":
                result = session.run(
                    f"CALL db.index.vector.queryNodes('embedding_index_{label}', $limit, $embedding) YIELD node, score "
                    f"OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(node) "
                    f"RETURN node, score, collect(DISTINCT p.name) as participants, elementId(node) as id",
                    embedding=query_embedding, limit=limit
                )
                for rec in result:
                    if rec["score"] < SIMILARITY_THRESHOLD:
                        logger.debug(f"Skipping Event with score {rec['score']}")
                        continue
                    event = Event(**dict(rec["node"]))
                    parts = [p for p in rec["participants"] if p]
                    detail = f" | 👥 {', '.join(parts)}" if parts else ""
                    logger.debug(f"Retrieved Event: {event.description[:50]} (score: {rec['score']:.3f})")
                    all_results.append({"output": f"Event: {event}{detail} [ID: {rec['id']}]", "score": rec["score"]})
            else:
                result = session.run(
                    f"CALL db.index.vector.queryNodes('embedding_index_{label}', $limit, $embedding) YIELD node, score RETURN node, score, elementId(node) as id",
                    embedding=query_embedding, limit=limit
                )
                for rec in result:
                    if rec["score"] < SIMILARITY_THRESHOLD:
                        logger.debug(f"Skipping {label} with score {rec['score']}")
                        continue
                    model = label_to_model[label]
                    node_obj = model(**dict(rec['node']))
                    logger.debug(f"Retrieved {label}: {str(node_obj)[:50]} (score: {rec['score']:.3f})")
                    all_results.append({"output": f"{label}: {node_obj} [ID: {rec['id']}]", "score": rec["score"]})
        
        all_results.sort(key=lambda x: x["score"], reverse=True)
        return "\n".join(r["output"] for r in all_results[:limit]) or "No results"


@tool
def get_user_preferences() -> str:
    """Get stored AI behavior preferences (communication style, format, topics to avoid)."""
    with get_session() as session:
        result = session.run("MATCH (u:User)-[:HAS_PREFERENCE]->(p:Preference) RETURN p.instruction as instruction")
        prefs = [r["instruction"] for r in result]
        return "\n".join(f"- {p}" for p in prefs) if prefs else "No preferences"


@tool
def check_relationship(person_name: str) -> str:
    """Get User's relationship with a person: type, sentiment, since when, events."""
    with get_session() as session:
        result = session.run(
            """MATCH (u:User)-[r:KNOWS]->(p:Person {name: $name})
            OPTIONAL MATCH (p)-[:PARTICIPATED_IN]->(e:Event)
            RETURN r.relation_type as relation, r.sentiment as sentiment, r.since as since, collect(e.description) as events""",
            name=person_name
        )
        rec = result.single()
        if not rec:
            return f"No relationship with {person_name}"
        output = f"{rec['relation']} | {rec['sentiment']} | since: {rec['since']}"
        events = [e for e in rec["events"] if e]
        if events:
            output += "\nEvents:\n" + "\n".join(f"  - {e}" for e in events)
        return output


@tool
def add_or_update_person(
    name: str,
    description: str | None = None,
    relation_type: str | None = None,
    sentiment: Literal["positive", "negative", "neutral", "complicated"] | None = None,
) -> str:
    """Save a person to memory.
    
    Examples:
        name="Oliwka", description="colleague", relation_type="coworker", sentiment="positive"
        name="Jan", description="brother", relation_type="family", sentiment="positive"
    """
    person = Person(name=name, description=description or "")
    person.save()
    
    if relation_type and sentiment:
        knows = KnowsRelationship(relation_type=relation_type, sentiment=sentiment, since=datetime.now().date().isoformat())
        with get_session() as session:
            session.run(
                "MATCH (u:User) MATCH (p:Person {name: $name}) MERGE (u)-[r:KNOWS]->(p) SET r += $props",
                name=name, props=knows.model_dump(exclude_none=True)
            )
    
    rel = f" | {relation_type} ({sentiment})" if relation_type and sentiment else ""
    return f"Person added: {name}{rel}"


@tool
def add_event(description: str, participants: list[str], mentioned_people: list[str] = [], date: str | None = None) -> str:
    """Save an event. Participants must exist in memory first!
    
    Examples:
        description="Trip to Kraków", participants=["Jan", "Oliwka"], date="2024-03-15"
    """
    date = date or datetime.now().date().isoformat()
    event = Event(description=description, date=date)
    event.save()
    
    with get_session() as session:
        for p in participants:
            session.run(
                "MATCH (e:Event {description: $desc}) MATCH (p:Person {name: $name}) MERGE (p)-[r:PARTICIPATED_IN]->(e) SET r.role = 'participant'",
                name=p, desc=description
            )
        for m in mentioned_people:
            session.run(
                "MATCH (e:Event {description: $desc}) MATCH (p:Person {name: $name}) MERGE (e)-[r:MENTIONS]->(p) SET r.sentiment = 'neutral'",
                desc=description, name=m
            )
    return f"Event added: {description}"


@tool
def add_fact(content: str, category: str) -> str:
    """Save a fact about user.
    
    Examples:
        content="Has dog named Rex", category="personal"
        content="Works as programmer", category="work"
    """
    fact = Fact(content=content, category=category)
    embedding = _embeddings.embed_query(fact.embedding_text)
    is_dup, dup_id, score, existing = check_duplicate("Fact", embedding)
    if is_dup:
        return f"Similar fact already exists (similarity: {score:.2f}): '{existing}'. Use update_fact_or_preference with ID: {dup_id}"
    fact.save()
    with get_session() as session:
        session.run("MATCH (u:User) MATCH (f:Fact {content: $content}) MERGE (u)-[:HAS_FACT]->(f)", content=content)
    return f"Fact added: {content}"


@tool
def add_preference(instruction: str) -> str:
    """Save AI behavior preference.
    
    Examples: "Always respond in Polish", "Keep answers short", "Avoid politics"
    """
    pref = Preference(instruction=instruction)
    embedding = _embeddings.embed_query(pref.embedding_text)
    is_dup, dup_id, score, existing = check_duplicate("Preference", embedding)
    if is_dup:
        return f"Similar preference already exists (similarity: {score:.2f}): '{existing}'. Use update_fact_or_preference with ID: {dup_id}"
    pref.save()
    with get_session() as session:
        session.run("MATCH (u:User) MATCH (p:Preference {instruction: $instruction}) MERGE (u)-[:HAS_PREFERENCE]->(p)", instruction=instruction)
    return f"Preference added: {instruction}"


@tool
def add_or_update_relationship(
    start_person: str,
    end_person: str,
    relation_type: str,
    sentiment: Literal["positive", "negative", "neutral", "complicated"] | None = None,
) -> str:
    """Link two people (not User). Example: start_person="Jan", end_person="Oliwka", relation_type="married" """
    with get_session() as session:
        session.run(
            "MATCH (p1:Person {name: $start}) MATCH (p2:Person {name: $end}) MERGE (p1)-[r:KNOWS]->(p2) SET r.relation_type = $rel, r.sentiment = $sent",
            start=start_person, end=end_person, rel=relation_type, sent=sentiment
        )
    return f"Relationship: {start_person} -[{relation_type}]-> {end_person}"


@tool
def update_fact_or_preference(item_id: str, new_value: str) -> str:
    """Update fact/preference by ID (from search results [ID: ...])."""
    with get_session() as session:
        fact_rec = session.run("MATCH (f:Fact) WHERE elementId(f) = $id RETURN f.category as category", id=item_id).single()
        if fact_rec:
            fact = Fact(content=new_value, category=fact_rec["category"])
            embedding = _embeddings.embed_query(fact.embedding_text)
            session.run(
                "MATCH (f:Fact) WHERE elementId(f) = $id SET f.content = $content, f.embedding = $embedding",
                id=item_id, content=new_value, embedding=embedding
            )
            return f"Fact updated: {new_value}"
        
        pref_rec = session.run("MATCH (p:Preference) WHERE elementId(p) = $id RETURN p", id=item_id).single()
        if pref_rec:
            pref = Preference(instruction=new_value)
            embedding = _embeddings.embed_query(pref.embedding_text)
            session.run(
                "MATCH (p:Preference) WHERE elementId(p) = $id SET p.instruction = $instruction, p.embedding = $embedding",
                id=item_id, instruction=new_value, embedding=embedding
            )
            return f"Preference updated: {new_value}"
        
        return "Memory not found"


@tool
def delete_memory(item_id: str) -> str:
    """Delete memory by ID (from search results [ID: ...])."""
    with get_session() as session:
        result = session.run("MATCH (n) WHERE elementId(n) = $id DETACH DELETE n RETURN count(n) as deleted", id=item_id).single()
        return "Memory deleted" if result["deleted"] > 0 else "Memory not found"


def get_memory_tools():
    return [ retrieve_context, get_user_preferences, check_relationship, add_or_update_person, add_event, add_fact, add_preference, add_or_update_relationship, update_fact_or_preference, delete_memory]
