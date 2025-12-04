from app.neo4j_client import save_memory, get_context_aware_memories, get_person_state, list_memories_raw
from loguru import logger
import time

logger.info("--- Creating Test Knowledge Graph (Cleaned) ---")

# User preferences (Original memories to establish baseline)
save_memory("preference", "User prefers concise explanations without long digressions", [], 0.9, "long")
save_memory("preference", "User enjoys dark mode and minimal UI designs", [], 0.7, "medium")

# Initial Backend Preference (Target for Upsert Test)
save_memory("preference", "User likes Python and FastAPI for backend development", [], 0.8, "long")

# Events with people - Storing concise text, relying on relationships for context
save_memory("event", "Had coffee at Starbucks, discussed new project idea", ["Alek"], 0.8, "medium")
save_memory("event", "Helped me debug Neo4j connection issue", ["Aleksander"], 0.9, "long")
save_memory("event", "Met at the conference, she presented on graph databases", ["Ola"], 0.7, "medium")
save_memory("event", "Went to dinner, talked about AI memory systems", ["Olo"], 0.8, "medium")

# Facts about people (These auto-update the Person node's 'bio' property)
save_memory("person", "Alek is a senior software engineer specializing in distributed systems", ["Alek"], 0.9, "long")
save_memory("person", "Ola works at Neo4j as a developer advocate", ["Ola"], 0.8, "long")

# General facts
save_memory("fact", "Neo4j uses Cypher as query language", [], 0.6, "long")
save_memory("fact", "Embedding models convert text to vectors for semantic search", [], 0.7, "long")


# --- 1. Testing UPSERT Logic (Fixing the 2 nodes -> 1 node problem) ---
logger.info("\n" + "="*50)
logger.info("--- 1. Testing Preference Upsert (Should overwrite existing backend preference) ---")
# This should overwrite "User likes Python..." because the topic is "backend preference"
save_memory("preference", "Actually, I prefer GoLang for backend now, not Python", [], 0.9, "long")

# Query the updated preference using the NEW context-aware function
results = get_context_aware_memories("What language do I like?", top_k=1)
logger.info(f"Current Backend Preference: {results[0]['summary']} (Score: {results[0]['score']:.2f})")

# Verify we have only ONE backend preference node in the DB
all_mems = list_memories_raw()
backend_pref_count = sum(1 for m in all_mems if "backend" in m['summary'])
logger.info(f"Total backend preference nodes in DB: {backend_pref_count} (Target: 1)")


# --- 2. Testing Context-Aware Retrieval (The Graph-Native approach) ---
logger.info("\n" + "="*50)
logger.info("--- 2. Testing Context-Aware Retrieval (Fetching clean memory + entity name) ---")
# Query 1: Retrieval for Alek
results_alek = get_context_aware_memories("Who is Alek?", top_k=1)
logger.info(f"Query 'Who is Alek?': {results_alek[0]['summary']} (Score: {results_alek[0]['score']:.2f})")

# Query 2: Retrieval for Ola (Should show the clean stored text with the name prefixed)
results_ola = get_context_aware_memories("What did Ola present on?", top_k=1)
logger.info(f"Query 'What did Ola present on?': {results_ola[0]['summary']} (Score: {results_ola[0]['score']:.2f})")


# --- 3. Testing Entity State Evolution (Fixing the key access 'summary' -> 'bio') ---
logger.info("\n" + "="*50)
logger.info("--- 3. Testing Person Entity Evolution (Bio field) ---")
# New memories that refine the person's status
save_memory("person", "Alek starts working as a Junior Dev", ["Alek"], 0.8, "long")
save_memory("fact", "Alek was promoted to Senior Architect", ["Alek"], 0.9, "long")

# Fetch the consolidated "State" of Alek
alek_state = get_person_state("Alek")
logger.info(f"Name: {alek_state['name']}")
logger.info(f"Bio (Consolidated): {alek_state['summary']}")

logger.info("\nTest run complete.")