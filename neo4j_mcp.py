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

def list_people() -> list[str]:
    """List all Person names in the database."""
    with driver.session() as session:
        result = session.run("MATCH (p:Person) RETURN p.name as name")
        names = [record["name"] for record in result]
    return names

@mcp.tool()
def kg_retrieve_context(
    query: str,
    entity_names: list[str] = [],
    node_labels: list[str] = [],
) -> str:
    """Retrieves nodes and related edges based on a query or entities. Supports hybrid search (vector + graph)."""
    label_to_model = {"Person": Person, "Event": Event, "Fact": Fact, "Preference": Preference, "User": User}
    
    with driver.session() as session:
        if entity_names:
            result = session.run(
                """MATCH (p:Person) WHERE p.name IN $names
                OPTIONAL MATCH (u:User)-[k:KNOWS]->(p)
                OPTIONAL MATCH (p)-[r:PARTICIPATED_IN]->(e:Event)
                RETURN p, k, collect(DISTINCT {event: e, rel: r}) as events""",
                names=entity_names
            )
            output = []
            for rec in result:
                person_str = str(Person(**dict(rec["p"])))
                if rec["k"]:
                    relation = f" [{rec['k']['relation_type']}, {rec['k']['sentiment']}]"
                    person_str += relation
                output.append(person_str)
                for evt in rec["events"]:
                    if evt["event"]:
                        output.append(f"  → {str(Event(**dict(evt['event'])))}")
            return "\n".join(output) if output else "No results"
        
        query_embedding = _get_embedding(query)
        labels = node_labels or ["Person", "Event", "Fact", "Preference"]
        all_results = []
        for label in labels:
            try:
                if label == "Person":
                    result = session.run(
                        f"CALL db.index.vector.queryNodes('embedding_index_{label}', 3, $embedding) YIELD node, score "
                        f"MATCH (u:User)-[k:KNOWS]->(node) RETURN node, score, k",
                        embedding=query_embedding
                    )  # type: ignore
                    for rec in result:
                        person = Person(**dict(rec["node"]))
                        rel_info = ""
                        if rec["k"]:
                            rel_info = f" → {rec['k']['relation_type']} ({rec['k']['sentiment']})"
                        all_results.append({"output": f"Person: {person}{rel_info}", "score": rec["score"]})
                elif label == "Event":
                    result = session.run(
                        f"CALL db.index.vector.queryNodes('embedding_index_{label}', 3, $embedding) YIELD node, score "
                        f"OPTIONAL MATCH (p:Person)-[r:PARTICIPATED_IN]->(node) "
                        f"OPTIONAL MATCH (node)-[m:MENTIONS]->(mentioned:Person) "
                        f"RETURN node, score, "
                        f"collect(DISTINCT {{person: p.name, role: r.role}}) as participants, "
                        f"collect(DISTINCT {{person: mentioned.name, sentiment: m.sentiment}}) as mentioned",
                        embedding=query_embedding
                    )  # type: ignore
                    for rec in result:
                        event = Event(**dict(rec["node"]))
                        details = []
                        participants = [p for p in rec["participants"] if p["person"]]
                        if participants:
                            details.append("👥 " + ", ".join(p["person"] for p in participants))
                        mentioned = [m for m in rec["mentioned"] if m["person"]]
                        if mentioned:
                            details.append("💬 " + ", ".join(m["person"] for m in mentioned))
                        detail_str = " | " + " | ".join(details) if details else ""
                        all_results.append({"output": f"Event: {event}{detail_str}", "score": rec["score"]})
                else:
                    result = session.run(
                        f"CALL db.index.vector.queryNodes('embedding_index_{label}', 3, $embedding) YIELD node, score RETURN node, score",
                        embedding=query_embedding
                    )  # type: ignore
                    for rec in result:
                        model_class = label_to_model[label]
                        all_results.append({"output": f"{label}: {str(model_class(**dict(rec['node'])))}", "score": rec["score"]})
            except Exception as e:
                logger.warning(f"Vector search failed for {label}: {e}")
        
        all_results.sort(key=lambda x: x["score"], reverse=True)
        output = [item["output"] for item in all_results[:10]]
        return "\n".join(output) if output else "No results"


@mcp.tool()
def kg_get_user_preferences() -> str:
    """Retrieves all Preference nodes connected to the User."""
    with driver.session() as session:
        cypher = "MATCH (u:User)-[:HAS_PREFERENCE]->(p:Preference) RETURN p.instruction as instruction"
        result = session.run(cypher)
        preferences = [record["instruction"] for record in result]
        return "\n".join(f"- {p}" for p in preferences) if preferences else "No preferences"


@mcp.tool()
def kg_check_relationship(person_name: str) -> str:
    """Checks relationship status and history between User and a specific Person."""
    with driver.session() as session:
        cypher = """
        MATCH (u:User)-[r:KNOWS]->(p:Person {name: $name})
        OPTIONAL MATCH (p)-[:PARTICIPATED_IN]->(e:Event)
        RETURN r.relation_type as relation_type, r.sentiment as sentiment, r.since as since,
               collect(e.description) as related_events
        """
        result = session.run(cypher, name=person_name)
        record = result.single()
        if not record:
            return f"No relationship with {person_name}"
        relation = record["relation_type"]
        sentiment = record["sentiment"]
        since = record["since"]
        events = [e for e in record["related_events"] if e]
        output = f"{relation} | {sentiment} | since: {since}"
        if events:
            output += "\nEvents:\n" + "\n".join(f"  - {e}" for e in events)
        return output


@mcp.tool()
def add_event(
    description: str,
    participants: list[str],
    mentioned_people: list[str] = [],
    date: str | None = None,
) -> str:
    """Add an event with participants and optionally mentioned people."""
    if not date:
        date = datetime.now().date().isoformat()

    event = Event(description=description, date=date)
    event.save()

    with driver.session() as session:
        for participant in participants:
            participated = ParticipatedInRelationship(role="participant")
            cypher = "MATCH (p:Person {name: $name}), (e:Event {description: $desc}) MERGE (p)-[r:PARTICIPATED_IN]->(e) SET r += $props"
            session.run(
                cypher,
                name=participant,
                desc=description,
                props=participated.model_dump(exclude_none=True),
            )

        if mentioned_people:
            for mentioned in mentioned_people:
                mentions = MentionsRelationship(sentiment="neutral")
                cypher = "MATCH (e:Event {description: $desc}), (p:Person {name: $name}) MERGE (e)-[r:MENTIONS]->(p) SET r += $props"
                session.run(
                    cypher,
                    desc=description,
                    name=mentioned,
                    props=mentions.model_dump(exclude_none=True),
                )

    return f"Event added: {description}"


@mcp.tool()
def add_fact(content: str, category: str) -> str:
    """Add a fact about the user."""
    fact = Fact(content=content, category=category)
    fact.save()

    with driver.session() as session:
        cypher = (
            "MATCH (u:User), (f:Fact {content: $content}) MERGE (u)-[:HAS_FACT]->(f)"
        )
        session.run(cypher, content=content)

    return f"Fact added: {content}"


@mcp.tool()
def add_preference(instruction: str) -> str:
    """Add a user preference/instruction for AI behavior."""
    pref = Preference(instruction=instruction)
    pref.save()

    with driver.session() as session:
        cypher = "MATCH (u:User), (p:Preference {instruction: $instruction}) MERGE (u)-[:HAS_PREFERENCE]->(p)"
        session.run(cypher, instruction=instruction)

    return f"Preference added: {instruction}"


@mcp.tool()
def add_or_update_person(
    name: str,
    description: str | None = None,
    relation_type: str | None = None,
    sentiment: Literal["positive", "negative", "neutral", "complicated"] | None = None,
) -> str:
    """Add or update person's description or relationship with User."""
    with driver.session() as session:
        person = Person(name=name, description=description or "")
        person_id = person.save()

        if relation_type and sentiment:
            knows = KnowsRelationship(
                relation_type=relation_type,
                sentiment=sentiment,
                since=datetime.now().date().isoformat(),
            )
            cypher = "MATCH (u:User), (p:Person {name: $name}) MERGE (u)-[r:KNOWS]->(p) SET r += $props"
            session.run(
                cypher,
                name=name,
                props=knows.model_dump(exclude_none=True),
            )
    rel_info = f" | {relation_type} ({sentiment})" if relation_type and sentiment else ""
    return f"Person added: {name}{rel_info}"

@mcp.tool()
def add_or_update_relationship(
    start_person_name: str,
    end_person_name: str,
    relation_type: str,
    sentiment: Literal["positive", "negative", "neutral", "complicated"] | None = None,
    since: str | None = None,
) -> str:
    """Add or update a KNOWS relationship between two persons."""
    with driver.session() as session:
        updates = {
            "relation_type": relation_type,
            "sentiment": sentiment,
        }
        if since:
            updates["since"] = since

        cypher = """
        MATCH (p1:Person {name: $start_name}), (p2:Person {name: $end_name})
        MERGE (p1)-[r:KNOWS]->(p2)
        SET r += $props
        """
        session.run(
            cypher,
            start_name=start_person_name,
            end_name=end_person_name,
            props=updates,
        )

    return f"{start_person_name} -[{relation_type}]-> {end_person_name}"
