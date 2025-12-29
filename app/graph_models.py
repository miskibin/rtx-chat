from datetime import datetime
from pydantic import BaseModel, Field
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
import os
from dotenv import load_dotenv

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
_driver = GraphDatabase.driver(URI, auth=AUTH, max_connection_lifetime=300, keep_alive=True)
_embeddings = OllamaEmbeddings(model="embeddinggemma")


class Neo4jModel(BaseModel):
    embedding: list[float] | None = None
    
    @property
    def embedding_text(self) -> str:
        raise NotImplementedError
    
    @property
    def _label(self) -> str:
        return self.__class__.__name__
    
    @property
    def _merge_key(self) -> dict:
        raise NotImplementedError
    
    def save(self) -> str:
        if not self.embedding:
            self.embedding = _embeddings.embed_query(self.embedding_text)
        
        fields = self.model_dump(exclude_none=True)
        merge_key = self._merge_key
        
        set_fields = {k: v for k, v in fields.items() if k not in merge_key}
        
        merge_clause = ", ".join(f"{k}: ${k}" for k in merge_key.keys())
        set_clause = ", ".join(f"n.{k} = ${k}" for k in set_fields.keys())
        
        cypher = f"MERGE (n:{self._label} {{{merge_clause}}}) SET {set_clause} RETURN elementId(n) as id"
        
        with _driver.session() as session:
            result = session.run(cypher, **fields)
            record = result.single()
            return record["id"] if record else ""


class User(Neo4jModel):
    name: str
    profile_summary: str = Field(description="High-level bio: e.g., 'Male, 30s, software engineer living in Poland'")
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        return f"{self.name} {self.profile_summary}"
    
    @property
    def _merge_key(self) -> dict:
        return {"name": self.name}
    
    def __str__(self) -> str:
        return f"{self.name}: {self.profile_summary}"


class Person(Neo4jModel):
    name: str
    description: str = Field(description="Dynamic bio that updates. e.g., 'Alek is a childhood friend who is very protective'")
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        return f"{self.name} {self.description}"
    
    @property
    def _merge_key(self) -> dict:
        return {"name": self.name}
    
    def __str__(self) -> str:
        return f"{self.name}: {self.description}"


class Event(Neo4jModel):
    description: str = Field(description="e.g., 'Alek told User that Ala wasn't worth his time'")
    date: str
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        parts = [self.description, self.date]
        return " ".join(parts)
    
    @property
    def _merge_key(self) -> dict:
        return {"date": self.date, "description": self.description}
    
    def __str__(self) -> str:
        date_str = f"[{self.date}] " if self.date else ""
        return f"{date_str}{self.description}"


class Fact(Neo4jModel):
    content: str = Field(description="e.g., 'User owns a white Mazda'")
    category: str = Field(description="e.g., 'possession', 'habit', 'location', 'medical'")
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        return f"{self.content} {self.category}"
    
    @property
    def _merge_key(self) -> dict:
        return {"content": self.content}
    
    def __str__(self) -> str:
        return f"{self.content} ({self.category})"


class Preference(Neo4jModel):
    instruction: str
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        return self.instruction
    
    @property
    def _merge_key(self) -> dict:
        return {"instruction": self.instruction}
    
    def __str__(self) -> str:
        return self.instruction


class KnowledgeDocument(BaseModel):
    """A document uploaded to an agent's knowledge base."""
    id: str
    agent_name: str
    filename: str
    doc_type: str  # "pdf", "url", "image", "text"
    source_url: str | None = None
    file_path: str | None = None
    chunk_count: int = 0
    created_at: str

    def save(self) -> str:
        with _driver.session() as session:
            session.run(
                """
                MERGE (d:KnowledgeDocument {id: $id})
                SET d.agent_name = $agent_name,
                    d.filename = $filename,
                    d.doc_type = $doc_type,
                    d.source_url = $source_url,
                    d.file_path = $file_path,
                    d.chunk_count = $chunk_count,
                    d.created_at = $created_at
                WITH d
                MATCH (a:Agent {name: $agent_name})
                MERGE (a)-[:HAS_DOCUMENT]->(d)
                """,
                **self.model_dump()
            )
        return self.id

    @staticmethod
    def get(doc_id: str) -> "KnowledgeDocument | None":
        with _driver.session() as session:
            rec = session.run(
                "MATCH (d:KnowledgeDocument {id: $id}) RETURN d",
                id=doc_id
            ).single()
            return KnowledgeDocument(**dict(rec["d"])) if rec else None

    @staticmethod
    def get_by_agent(agent_name: str) -> list["KnowledgeDocument"]:
        with _driver.session() as session:
            return [
                KnowledgeDocument(**dict(r["d"]))
                for r in session.run(
                    "MATCH (d:KnowledgeDocument {agent_name: $agent_name}) RETURN d ORDER BY d.created_at DESC",
                    agent_name=agent_name
                )
            ]

    @staticmethod
    def delete(doc_id: str):
        """Delete document and all its chunks."""
        with _driver.session() as session:
            session.run(
                """
                MATCH (d:KnowledgeDocument {id: $id})
                OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:KnowledgeChunk)
                DETACH DELETE d, c
                """,
                id=doc_id
            )


class KnowledgeChunk(Neo4jModel):
    """A chunk of text from a knowledge document, enriched with LLM summary and topics."""
    document_id: str
    agent_name: str
    content: str
    summary: str = ""
    topics: list[str] = []
    chunk_index: int
    embedding: list[float] | None = None

    @property
    def embedding_text(self) -> str:
        # Embed on summary + topics for better semantic matching
        topics_str = ", ".join(self.topics) if self.topics else ""
        return f"{self.summary} {topics_str}" if self.summary else self.content[:500]

    @property
    def _merge_key(self) -> dict:
        return {"document_id": self.document_id, "chunk_index": self.chunk_index}

    def save(self) -> str:
        node_id = super().save()
        # Create relationship to document
        with _driver.session() as session:
            session.run(
                """
                MATCH (d:KnowledgeDocument {id: $doc_id})
                MATCH (c:KnowledgeChunk {document_id: $doc_id, chunk_index: $chunk_index})
                MERGE (d)-[:HAS_CHUNK]->(c)
                """,
                doc_id=self.document_id, chunk_index=self.chunk_index
            )
        return node_id

    @staticmethod
    def get_by_document(document_id: str) -> list["KnowledgeChunk"]:
        with _driver.session() as session:
            return [
                KnowledgeChunk(**dict(r["c"]))
                for r in session.run(
                    "MATCH (c:KnowledgeChunk {document_id: $doc_id}) RETURN c ORDER BY c.chunk_index",
                    doc_id=document_id
                )
            ]

    def __str__(self) -> str:
        topics_str = f" [{', '.join(self.topics)}]" if self.topics else ""
        return f"{self.summary}{topics_str}"


class KnowsRelationship(BaseModel):
    relation_type: str = Field(description="e.g., 'friend', 'ex-girlfriend', 'colleague', 'family'")
    since: str | None = None
    sentiment: str = Field(description="e.g., 'positive', 'negative', 'neutral', 'complicated'")


class ParticipatedInRelationship(BaseModel):
    role: str = Field(description="e.g., 'speaker', 'listener', 'observer'")


class MentionsRelationship(BaseModel):
    sentiment: str | None = Field(default=None, description="e.g., 'positive', 'negative', 'neutral'. How they were talked about")


class Agent(BaseModel):
    name: str
    prompt: str
    enabled_tools: list[str] = []
    max_memories: int = 5
    max_tool_runs: int = 10
    is_template: bool = False
    min_similarity: float = 0.7
    # Context compression settings
    context_compression: bool = True  # Enable/disable context compression
    context_max_tokens: int = 6000    # Max tokens before compression
    context_window_tokens: int = 2000  # Recent tokens to keep uncompressed

    def save(self):
        with _driver.session() as session:
            session.run(
                """MERGE (a:Agent {name: $name}) 
                SET a.prompt = $prompt, 
                    a.enabled_tools = $enabled_tools, 
                    a.max_memories = $max_memories, 
                    a.max_tool_runs = $max_tool_runs, 
                    a.is_template = $is_template, 
                    a.min_similarity = $min_similarity,
                    a.context_compression = $context_compression,
                    a.context_max_tokens = $context_max_tokens,
                    a.context_window_tokens = $context_window_tokens""",
                **self.model_dump()
            )
        return self.name

    @staticmethod
    def get(name: str) -> "Agent | None":
        with _driver.session() as session:
            rec = session.run("MATCH (a:Agent {name: $name}) RETURN a", name=name).single()
            return Agent(**dict(rec["a"])) if rec else None

    @staticmethod
    def all() -> list["Agent"]:
        with _driver.session() as session:
            return [Agent(**dict(r["a"])) for r in session.run("MATCH (a:Agent) RETURN DISTINCT a ORDER BY a.is_template DESC, a.name")]

    @staticmethod
    def delete(name: str):
        with _driver.session() as session:
            session.run("MATCH (a:Agent {name: $name}) DELETE a", name=name)


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    messages: str  # JSON-serialized full message array
    agent: str = "psychological"
    model: str = "qwen3:4b"
    summary_chunks: str = "[]"  # JSON array of rolling summaries

    def save(self) -> str:
        with _driver.session() as session:
            session.run(
                """
                MERGE (c:Conversation {id: $id})
                SET c.title = $title,
                    c.created_at = $created_at,
                    c.updated_at = $updated_at,
                    c.messages = $messages,
                    c.agent = $agent,
                    c.model = $model,
                    c.summary_chunks = $summary_chunks
                """,
                **self.model_dump()
            )
        return self.id
    
    def update_summary(self, summary: str) -> str:
        """Update the conversation summary."""
        import json
        chunks = json.loads(self.summary_chunks) if self.summary_chunks else []
        chunks.append({
            "summary": summary,
            "created_at": datetime.now().isoformat()
        })
        # Keep only the last summary (rolling)
        self.summary_chunks = json.dumps([chunks[-1]] if chunks else [])
        self.updated_at = datetime.now().isoformat()
        return self.save()
    
    def get_latest_summary(self) -> str:
        """Get the most recent summary text."""
        import json
        try:
            chunks = json.loads(self.summary_chunks) if self.summary_chunks else []
            if chunks:
                return chunks[-1].get("summary", "")
        except (json.JSONDecodeError, KeyError, IndexError):
            pass
        return ""

    def update_messages(self, messages: str) -> str:
        self.messages = messages
        self.updated_at = datetime.now().isoformat()
        return self.save()

    @staticmethod
    def get(conversation_id: str) -> "Conversation | None":
        with _driver.session() as session:
            rec = session.run(
                "MATCH (c:Conversation {id: $id}) RETURN c",
                id=conversation_id
            ).single()
            return Conversation(**dict(rec["c"])) if rec else None

    @staticmethod
    def all() -> list["Conversation"]:
        with _driver.session() as session:
            return [
                Conversation(**dict(r["c"]))
                for r in session.run(
                    "MATCH (c:Conversation) RETURN c ORDER BY c.updated_at DESC"
                )
            ]

    @staticmethod
    def all_metadata() -> list[dict]:
        """Return only id, title, updated_at for listing (without full messages)."""
        with _driver.session() as session:
            return [
                {"id": r["c"]["id"], "title": r["c"]["title"], "updated_at": r["c"]["updated_at"], "agent": r["c"]["agent"], "model": r["c"]["model"]}
                for r in session.run(
                    "MATCH (c:Conversation) RETURN c ORDER BY c.updated_at DESC"
                )
            ]

    @staticmethod
    def delete(conversation_id: str):
        with _driver.session() as session:
            session.run("MATCH (c:Conversation {id: $id}) DELETE c", id=conversation_id)