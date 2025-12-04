from app.neo4j_client import save_memory, get_relevant_memories, list_people, list_memories
from loguru import logger

logger.info("Creating test knowledge graph...")

# User preferences
save_memory("preference", "User prefers concise explanations without long digressions", [], 0.9, "long")
save_memory("preference", "User likes Python and FastAPI for backend development", [], 0.8, "long")
save_memory("preference", "User enjoys dark mode and minimal UI designs", [], 0.7, "medium")

# Events with people
save_memory("event", "Had coffee with Alek at Starbucks, discussed new project idea", ["Alek"], 0.8, "medium")
save_memory("event", "Aleksander helped me debug Neo4j connection issue", ["Aleksander"], 0.9, "long")
save_memory("event", "Met Ola at the conference, she presented on graph databases", ["Ola"], 0.7, "medium")
save_memory("event", "Went to dinner with Olo, talked about AI memory systems", ["Olo"], 0.8, "medium")

# Facts about people
save_memory("person", "Alek is a senior software engineer specializing in distributed systems", ["Alek"], 0.9, "long")
save_memory("person", "Ola works at Neo4j as a developer advocate", ["Ola"], 0.8, "long")

# General facts
save_memory("fact", "Neo4j uses Cypher as query language", [], 0.6, "long")
save_memory("fact", "Embedding models convert text to vectors for semantic search", [], 0.7, "long")

logger.info("\n" + "="*50)
logger.info("PEOPLE IN GRAPH:")
people = list_people()
for p in people:
    logger.info(f"  {p['name']} (aliases: {p['aliases']}, importance: {p['importance']})")

logger.info("\n" + "="*50)
logger.info("ALL MEMORIES:")
memories = list_memories()
for m in memories[:5]:
    logger.info(f"  [{m['type']}] {m['summary'][:60]}...")

logger.info("\n" + "="*50)
logger.info("QUERY 1: 'Tell me about Alek'")
results = get_relevant_memories("Tell me about Alek", top_k=3)
for r in results:
    logger.info(f"  [{r['type']}] {r['summary']} (sim:{r['similarity']:.2f})")

logger.info("\n" + "="*50)
logger.info("QUERY 2: 'What are my coding preferences?'")
results = get_relevant_memories("What are my coding preferences?", top_k=3)
for r in results:
    logger.info(f"  [{r['type']}] {r['summary']} (sim:{r['similarity']:.2f})")

logger.info("\n" + "="*50)
logger.info("QUERY 3: 'Who did I meet recently?'")
results = get_relevant_memories("Who did I meet recently?", top_k=4)
for r in results:
    logger.info(f"  [{r['type']}] {r['summary']} (sim:{r['similarity']:.2f})")

logger.info("\n" + "="*50)
logger.info("CHECKING PERSON CANONICALIZATION:")
logger.info("Should merge: Alek/Aleksander (same person), Ola/Olo (same person)")
people = list_people()
logger.info(f"Total unique people: {len(people)}")
for p in people:
    logger.info(f"  {p['name']} with aliases: {p['aliases']}")
