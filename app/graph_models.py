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
    """A document uploaded to a mode's knowledge base."""
    id: str
    mode_name: str
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
                SET d.mode_name = $mode_name,
                    d.filename = $filename,
                    d.doc_type = $doc_type,
                    d.source_url = $source_url,
                    d.file_path = $file_path,
                    d.chunk_count = $chunk_count,
                    d.created_at = $created_at
                WITH d
                MATCH (m:Mode {name: $mode_name})
                MERGE (m)-[:HAS_DOCUMENT]->(d)
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
    def get_by_mode(mode_name: str) -> list["KnowledgeDocument"]:
        with _driver.session() as session:
            return [
                KnowledgeDocument(**dict(r["d"]))
                for r in session.run(
                    "MATCH (d:KnowledgeDocument {mode_name: $mode_name}) RETURN d ORDER BY d.created_at DESC",
                    mode_name=mode_name
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
    mode_name: str
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


class Mode(BaseModel):
    name: str
    prompt: str
    enabled_tools: list[str] = []
    max_memories: int = 5
    max_tool_runs: int = 10
    is_template: bool = False

    def save(self):
        with _driver.session() as session:
            session.run(
                "MERGE (m:Mode {name: $name}) SET m.prompt = $prompt, m.enabled_tools = $enabled_tools, m.max_memories = $max_memories, m.max_tool_runs = $max_tool_runs, m.is_template = $is_template",
                **self.model_dump()
            )
        return self.name

    @staticmethod
    def get(name: str) -> "Mode | None":
        with _driver.session() as session:
            rec = session.run("MATCH (m:Mode {name: $name}) RETURN m", name=name).single()
            return Mode(**dict(rec["m"])) if rec else None

    @staticmethod
    def all() -> list["Mode"]:
        with _driver.session() as session:
            return [Mode(**dict(r["m"])) for r in session.run("MATCH (m:Mode) RETURN DISTINCT m ORDER BY m.is_template DESC, m.name")]

    @staticmethod
    def delete(name: str):
        with _driver.session() as session:
            session.run("MATCH (m:Mode {name: $name}) DELETE m", name=name)


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    messages: str  # JSON-serialized full message array
    mode: str = "psychological"
    model: str = "qwen3:4b"

    def save(self) -> str:
        with _driver.session() as session:
            session.run(
                """
                MERGE (c:Conversation {id: $id})
                SET c.title = $title,
                    c.created_at = $created_at,
                    c.updated_at = $updated_at,
                    c.messages = $messages,
                    c.mode = $mode,
                    c.model = $model
                """,
                **self.model_dump()
            )
        return self.id

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
                {"id": r["c"]["id"], "title": r["c"]["title"], "updated_at": r["c"]["updated_at"], "mode": r["c"]["mode"], "model": r["c"]["model"]}
                for r in session.run(
                    "MATCH (c:Conversation) RETURN c ORDER BY c.updated_at DESC"
                )
            ]

    @staticmethod
    def delete(conversation_id: str):
        with _driver.session() as session:
            session.run("MATCH (c:Conversation {id: $id}) DELETE c", id=conversation_id)