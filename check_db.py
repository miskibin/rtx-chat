import os
from dotenv import load_dotenv
from neo4j import GraphDatabase
from loguru import logger

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))

logger.add("check_db.log", level="DEBUG")

def check_db():
    try:
        driver = GraphDatabase.driver(URI, auth=AUTH, max_connection_lifetime=300)
        with driver.session(database="neo4j") as session:
            logger.info("✓ Connected to Neo4j")
            
            result = session.run("MATCH (n) RETURN count(n) as count")
            count = result.single()["count"]
            logger.info(f"✓ Total nodes: {count}")
            
            result = session.run("MATCH ()-[r]->() RETURN count(r) as count")
            rel_count = result.single()["count"]
            logger.info(f"✓ Total relationships: {rel_count}")
            
            logger.info("\n=== PEOPLE ===")
            result = session.run("MATCH (p:Person) RETURN elementId(p) as id, p.name as name, p.description as description")
            for rec in result:
                logger.info(f"  {rec['name']} (ID: {rec['id']})")
                if rec['description']:
                    logger.info(f"    {rec['description']}")
            
            logger.info("\n=== EVENTS ===")
            result = session.run("MATCH (e:Event) OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(e) RETURN elementId(e) as id, e.description as description, e.date as date, collect(DISTINCT p.name) as participants")
            for rec in result:
                logger.info(f"  {rec['description']} ({rec['date']})")
                if rec['participants']:
                    logger.info(f"    Participants: {', '.join([p for p in rec['participants'] if p])}")
            
            logger.info("\n=== FACTS ===")
            result = session.run("MATCH (f:Fact) RETURN elementId(f) as id, f.content as content, f.category as category")
            for rec in result:
                logger.info(f"  {rec['content']} (Category: {rec['category']}, ID: {rec['id']})")
            
            logger.info("\n=== PREFERENCES ===")
            result = session.run("MATCH (p:Preference) RETURN elementId(p) as id, p.instruction as instruction")
            for rec in result:
                logger.info(f"  {rec['instruction']} (ID: {rec['id']})")
            
            logger.info("\n=== RELATIONSHIPS ===")
            result = session.run("MATCH (n1)-[r]->(n2) RETURN labels(n1)[0] as from_type, n1.name as from_name, type(r) as rel_type, labels(n2)[0] as to_type, n2.name as to_name, r")
            for rec in result:
                rel_str = f"{rec['from_name']} -[{rec['rel_type']}]-> {rec['to_name']}"
                props = dict(rec['r'])
                if props:
                    props_str = ", ".join(f"{k}={v}" for k, v in props.items() if k != "embedding")
                    logger.info(f"  {rel_str} ({props_str})")
                else:
                    logger.info(f"  {rel_str}")
            
            driver.close()
            logger.info("\n✓ Database check complete")
    except Exception as e:
        logger.error(f"✗ Database error: {e}")

if __name__ == "__main__":
    check_db()
