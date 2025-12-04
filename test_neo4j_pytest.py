import pytest
from app.neo4j_client import (
    save_memory, get_context_aware_memories,
    list_memories_raw, get_person_state, _canonicalize_person
)
from app.neo4j_client import driver
from loguru import logger

@pytest.fixture(scope="module")
def setup_knowledge_graph():
    """Create test knowledge graph once for all tests"""
    logger.info("Setting up test knowledge graph...")
    
    # Clear existing data
    with driver.session(database="neo4j") as session:
        session.run("MATCH (n) DETACH DELETE n")
        logger.info("Cleared database")
    
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
    
    # More diverse memories for harder queries
    save_memory("event", "Debugged memory leak in production, took 6 hours", [], 0.9, "long")
    save_memory("event", "Presented graph database architecture to the team", ["Ola"], 0.7, "medium")
    save_memory("fact", "User's favorite programming language is Rust for systems programming", [], 0.8, "long")
    save_memory("preference", "Prefer async/await over callbacks for async code", [], 0.7, "medium")
    save_memory("goal", "Learn more about vector databases and RAG systems", [], 0.8, "long")
    save_memory("goal", "Build a personal knowledge graph with 1000+ memories", [], 0.6, "medium")
    save_memory("event", "Fixed critical bug in authentication service at 3am", [], 0.9, "long")
    save_memory("person", "Ola is also interested in knowledge graphs and AI agents", ["Ola"], 0.7, "long")
    save_memory("fact", "GraphRAG combines graph databases with retrieval augmented generation", [], 0.8, "long")
    save_memory("preference", "Dislike overly verbose logging that clutters console output", [], 0.6, "short")
    save_memory("event", "Aleksander recommended using FastMCP for MCP server development", ["Aleksander"], 0.8, "medium")
    
    yield
    logger.info("Test knowledge graph ready")


def test_person_canonicalization(setup_knowledge_graph):
    """Test that similar names are merged correctly"""
    # Query for all people via Cypher
    with driver.session(database="neo4j") as session:
        result = session.run("MATCH (p:Person) RETURN p.name_canonical AS name, p.aliases AS aliases")
        people = [{"name": r["name"], "aliases": r["aliases"] or []} for r in result]
    
    logger.info(f"\n=== Person Canonicalization Test ===")
    logger.info(f"Total unique people: {len(people)}")
    for p in people:
        logger.info(f"  {p['name']} (aliases: {p['aliases']})")
    
    # Should have merged Alek/Aleksander and Ola/Olo
    assert len(people) == 2, f"Expected 2 unique people, got {len(people)}"
    
    # Check Alek/Aleksander merge
    alek = next((p for p in people if p['name'] == 'Alek'), None)
    assert alek is not None, "Alek not found"
    assert 'Aleksander' in alek['aliases'], "Aleksander should be alias of Alek"
    
    # Check Ola/Olo merge
    ola = next((p for p in people if p['name'] == 'Ola'), None)
    assert ola is not None, "Ola not found"
    assert 'Olo' in ola['aliases'], "Olo should be alias of Ola"


def test_semantic_search_about_person(setup_knowledge_graph):
    """Test semantic search for person-related queries"""
    query = "Alek coffee Starbucks project"
    results = get_context_aware_memories(query, top_k=3)
    
    logger.info(f"\n=== Query: '{query}' ===")
    for i, r in enumerate(results, 1):
        logger.info(f"{i}. [{r['type']}] {r['summary'][:80]}... (score: {r['score']:.3f})")
    
    # Should find event about Alek at Starbucks
    assert len(results) >= 1, "Should find at least 1 relevant memory"
    
    # Top result should be the coffee event
    top = results[0]
    assert 'alek' in top['summary'].lower() or 'coffee' in top['summary'].lower(), \
        "Top result should mention Alek or coffee event"


def test_semantic_search_preferences(setup_knowledge_graph):
    """Test semantic search for user preferences"""
    query = "What are my coding preferences?"
    results = get_context_aware_memories(query, top_k=3)
    
    logger.info(f"\n=== Query: '{query}' ===")
    for i, r in enumerate(results, 1):
        logger.info(f"{i}. [{r['type']}] {r['summary'][:80]}... (score: {r['score']:.3f})")
    
    # Should return preference-type memories with high score
    assert len(results) >= 1, "Should find at least 1 preference"
    
    # Check top result is about preferences
    top_result = results[0]
    assert 'python' in top_result['summary'].lower() or 'prefer' in top_result['summary'].lower(), \
        "Top result should be about coding preferences"


def test_semantic_search_preferences(setup_knowledge_graph):
    """Test semantic search for user preferences"""
    query = "What are my coding preferences?"
    results = get_context_aware_memories(query, top_k=3)
    
    logger.info(f"\n=== Query: '{query}' ===")
    for i, r in enumerate(results, 1):
        logger.info(f"{i}. [{r['type']}] {r['summary'][:80]}... (score: {r['score']:.3f})")
    
    # Should return preference-type memories with high score
    assert len(results) >= 1, "Should find at least 1 preference"
    
    # Check top result is about preferences
    top_result = results[0]
    assert 'python' in top_result['summary'].lower() or 'prefer' in top_result['summary'].lower(), \
        "Top result should be about coding preferences"


def test_memory_update_via_similarity(setup_knowledge_graph):
    """Test that similar memories update instead of duplicating"""
    # Save initial preference
    mem_id_1 = save_memory("preference", "I prefer TypeScript for frontend", [], 0.9, "long")
    
    # Try to save very similar preference (should update, not duplicate)
    mem_id_2 = save_memory("preference", "I like TypeScript for frontend development", [], 0.9, "long")
    
    logger.info(f"\n=== Memory Update Test ===")
    logger.info(f"First ID: {mem_id_1}")
    logger.info(f"Second ID: {mem_id_2}")
    
    # Check if they're the same (updated) or different (duplicated)
    all_mems = list_memories_raw()
    typescript_count = sum(1 for m in all_mems if 'typescript' in m['summary'].lower())
    
    logger.info(f"Total TypeScript preferences in DB: {typescript_count}")
    assert typescript_count == 1, f"Should have 1 TypeScript preference (updated), not {typescript_count}"


def test_person_state_consolidation(setup_knowledge_graph):
    """Test that person state is consolidated from multiple memories"""
    # Get Alek's consolidated state
    alek_state = get_person_state("Alek")
    
    logger.info(f"\n=== Person State Test ===")
    logger.info(f"Name: {alek_state['name']}")
    logger.info(f"Aliases: {alek_state['aliases']}")
    logger.info(f"Summary: {alek_state['summary']}")
    logger.info(f"Raw memories count: {len(alek_state['raw_memories'])}")
    
    assert alek_state['name'] == 'Alek', "Name should be Alek"
    assert 'Aleksander' in alek_state['aliases'], "Should have Aleksander as alias"
    assert len(alek_state['raw_memories']) >= 2, "Should have multiple memories about Alek"


def test_hybrid_search_with_entity_detection(setup_knowledge_graph):
    """Test that hybrid search detects entities and boosts relevant memories"""
    query = "Alek"  # Simple query - should trigger entity detection
    results = get_context_aware_memories(query, top_k=3)
    
    logger.info(f"\n=== Hybrid Search Test (Entity: 'Alek') ===")
    for i, r in enumerate(results, 1):
        logger.info(f"{i}. [{r['type']}] {r['summary'][:80]}... (score: {r['score']:.3f})")
    
    # Should find memories specifically about Alek via graph search
    assert len(results) >= 2, "Should find at least 2 memories about Alek"
    
    # At least one should mention Alek explicitly or have [With Alek] prefix
    alek_mentioned = any('alek' in r['summary'].lower() for r in results)
    assert alek_mentioned, "Results should mention Alek"


def test_similarity_scores_are_reasonable(setup_knowledge_graph):
    """Test that similarity scores are in valid range and make sense"""
    query = "graph databases"
    results = get_context_aware_memories(query, top_k=3)
    
    logger.info(f"\n=== Similarity Score Test ===")
    logger.info(f"Query: '{query}'")
    for i, r in enumerate(results, 1):
        logger.info(f"{i}. [{r['type']}] {r['summary'][:50]}... (score: {r['score']:.3f})")
    
    # All scores should be between 0 and 1
    for r in results:
        assert 0.0 <= r['score'] <= 1.0, f"Score {r['score']} out of range [0,1]"
    
    # Results should be ordered by score (descending)
    for i in range(len(results) - 1):
        assert results[i]['score'] >= results[i+1]['score'], "Results should be ordered by score descending"


def test_hard_queries_find_relevant_in_top5(setup_knowledge_graph):
    """Test harder queries - valid result should be in top 5"""
    
    test_cases = [
        {
            "query": "late night emergency production issues",
            "expected_keywords": ["3am", "authentication", "bug", "critical"],
            "description": "Should find 3am authentication bug fix"
        },
        {
            "query": "Aleksander MCP server recommendation",
            "expected_keywords": ["fastmcp", "mcp", "aleksander", "recommended"],
            "description": "Should find FastMCP recommendation from Aleksander"
        },
        {
            "query": "Rust systems programming",
            "expected_keywords": ["rust", "systems", "programming", "language"],
            "description": "Should find Rust preference"
        },
        {
            "query": "vector databases RAG learning",
            "expected_keywords": ["vector", "rag", "learn", "goal"],
            "description": "Should find RAG/vector database learning goal"
        },
        {
            "query": "Ola knowledge graphs AI",
            "expected_keywords": ["ola", "knowledge graph", "ai agents"],
            "description": "Should find Ola's interests via hybrid search"
        },
        {
            "query": "GraphRAG retrieval augmented generation",
            "expected_keywords": ["graphrag", "graph database", "retrieval"],
            "description": "Should find GraphRAG fact"
        }
    ]
    
    for tc in test_cases:
        results = get_context_aware_memories(tc["query"], top_k=5)
        
        logger.info(f"\n=== Hard Query: '{tc['query']}' ===")
        logger.info(f"Expected: {tc['description']}")
        for i, r in enumerate(results, 1):
            logger.info(f"{i}. [{r['type']}] {r['summary'][:70]}... (score: {r['score']:.3f})")
        
        # Check if any result in top 5 contains expected keywords
        found = False
        for r in results:
            summary_lower = r['summary'].lower()
            if any(kw.lower() in summary_lower for kw in tc['expected_keywords']):
                found = True
                break
        
        assert found, f"Query '{tc['query']}' - Expected result not in top 5: {tc['description']}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
