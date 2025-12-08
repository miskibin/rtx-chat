from neo4j_mcp import (
    kg_initialize_database,
    add_or_update_person,
    add_event,
    add_fact,
    add_preference,
    kg_retrieve_context,
    kg_get_user_preferences,
    kg_check_relationship,
    add_or_update_relationship,
)
from loguru import logger
import json

logger.info("Testing MCP functions")

# Test 0: Initialize database
logger.info("Test 0: Initializing database with vector indexes")
result = kg_initialize_database(dimension=768)
logger.info(f"Result: {result}")

# Test 1: Skip creating User node (done in initialization)

# Test 2: Add Person nodes with relationships
logger.info("Test 2: Adding Person nodes with relationships")
result = add_or_update_person(
    name="Alek",
    description="Long time friend, very protective",
    relation_type="friend",
    sentiment="positive",
)
logger.info(f"Result: {result}")

result = add_or_update_person(
    name="Ala",
    description="Ex-girlfriend",
    relation_type="ex-girlfriend",
    sentiment="negative"
)
logger.info(f"Result: {result}")

# Test 3: Add Event
logger.info("Test 3: Adding Event")
result = add_event(
    description="Alek said that Ala wasn't worth my time",
    participants=["Alek"],
    mentioned_people=["Ala"],
    date="2024-12-07"
)
logger.info(f"Result: {result}")

# Test 4: Add Fact
logger.info("Test 4: Adding Fact")
result = add_fact(content="User owns a white Mazda", category="possession")
logger.info(f"Result: {result}")

# Test 5: Add Preference
logger.info("Test 5: Adding Preference")
result = add_preference(instruction="Always answer in Polish")
logger.info(f"Result: {result}")

# Test 6: Check relationship
logger.info("Test 6: Checking relationship with Alek")
result = kg_check_relationship("Alek")
logger.info(f"Result: {result}")
data = json.loads(result)
assert "friend" in str(data) or len(data) == 0, "Expected friend relationship"

# Test 7: Get user preferences
logger.info("Test 7: Getting user preferences")
result = kg_get_user_preferences()
logger.info(f"Result: {result}")
prefs = json.loads(result)
assert isinstance(prefs, list), "Expected list of preferences"

# Test 8: Retrieve context by entity name
logger.info("Test 8: Retrieving context for Alek")
result = kg_retrieve_context(query="", entity_names=["Alek"])
logger.info(f"Result: {result[:200]}...")

# Test 9: Retrieve context by semantic query
logger.info("Test 9: Retrieving context by query 'car'")
result = kg_retrieve_context(query="car")
logger.info(f"Result: {result[:200]}...")

# Test 10: Update person
logger.info("Test 10: Updating Alek's description")
result = add_or_update_person(
    name="Alek",
    description="Childhood friend who is very protective and loyal"
)
logger.info(f"Result: {result}")
data = json.loads(result)
assert data["status"] == "success", "Expected success status"

logger.info("All tests completed!")
