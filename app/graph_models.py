from datetime import datetime
from pydantic import BaseModel, Field
from neo4j import GraphDatabase
from langchain_ollama import OllamaEmbeddings
import os
from dotenv import load_dotenv

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USERNAME", "neo4j"), os.getenv("NEO4J_PASSWORD", "password"))
_driver = GraphDatabase.driver(URI, auth=AUTH)
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


class KnowsRelationship(BaseModel):
    relation_type: str = Field(description="e.g., 'friend', 'ex-girlfriend', 'colleague', 'family'")
    since: str | None = None
    sentiment: str = Field(description="e.g., 'positive', 'negative', 'neutral', 'complicated'")


class ParticipatedInRelationship(BaseModel):
    role: str = Field(description="e.g., 'speaker', 'listener', 'observer'")


class MentionsRelationship(BaseModel):
    sentiment: str | None = Field(default=None, description="e.g., 'positive', 'negative', 'neutral'. How they were talked about")
