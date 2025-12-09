# RTX Chat

AI-powered chat application with local LLM support and persistent memory management using knowledge graphs.

## Features

### Tools

- **Code Execution** - Run Python code with automatic chart generation (PNG, JPG, SVG) and display
- **Filesystem** - Read/write files, list directories
- **Web Crawling** - Fetch and parse website content with JavaScript rendering via Crawl4AI
- **Memory Management** - Query and update semantic knowledge graph
- **Conversation Summaries** - Auto-summarize long conversations

### Memory System

Memories are stored in a Neo4j graph database with vector embeddings (embeddinggemma model). Enables both semantic search and entity-based queries.

**Node Types:**
- **Person** - Individuals with dynamic descriptions. Tracked relationships include sentiment (positive/negative/neutral/complicated) and relation type (colleague, friend, family, etc.)
- **Event** - Occurrences with date, description, and participants
- **Fact** - Discrete knowledge organized by category (possessions, interests, achievements, achievements, etc.)
- **Preference** - User preferences for AI behavior (e.g., communication style, response length)
- **User** - Profile with bio

**Relationships:**
- `KNOWS` - User→Person with sentiment, relation type, and since date
- `PARTICIPATED_IN` - Person→Event with role
- `MENTIONS` - Event→Person (relevant mentions)
- `HAS_PREFERENCE` - User→Preference
- `HAS_FACT` - User→Fact

**Memory Tools:**
- `retrieve_context()` - Query by semantic similarity or entity names. Returns up to N results with similarity scores
- `add_or_update_person()` - Create/update person with sentiment and relationship type
- `add_event()` - Create event with participants and mentioned entities
- `add_fact()` - Add categorical fact about user
- `check_relationship()` - Get relationship details and associated events for a person
- `get_user_preferences()` - Retrieve active preferences

## Agent Architecture

- **State Management** - LangGraph with MessagesState for multi-turn conversations
- **Tool Binding** - LLM invokes tools automatically within agent loop
- **Streaming** - Server-Sent Events (SSE) for real-time response streaming
- **Memory Integration** - Automatic context injection before generation
- **Configurable Execution** - Control max tool runs, memory retrieval limit, and enabled tools per request

## LLM Support

- **Local** - Ollama (default: qwen3:4b with reasoning capability)
- **Remote** - OpenAI (GPT-4, etc.) and Grok via API
- **Model Switching** - Dynamic model selection per request
- **Thinking** - Extended reasoning when model supports it

## System Prompts

- **Normal** - General-purpose helpful assistant
- **Psychological** - Compassionate support mode with empathetic guidelines

System prompts automatically inject:
- Current datetime
- User preferences
- Retrieved memories
- Memory management instructions (concise extraction vs. verbatim saving)

## API Endpoints

- `POST /chat/stream` - Stream chat response with memory integration
- `GET /models` - List available models with capabilities
- `GET /memories/{entity_id}` - Retrieve specific memory
- `POST /memories/merge` - Merge duplicate entities
- `PUT /memories/{entity_id}` - Update memory
- `GET /artifacts/{id}` - Serve generated files (charts, code output)

## Architecture

- **Backend** - FastAPI with LangGraph, LangChain
- **Agent** - Multi-turn conversation with tool loop and memory injection
- **Memory DB** - Neo4j (graph) 
- **Embeddings** - Ollama embeddinggemma model
- **Frontend** - Next.js 15+ with TypeScript and shadcn/ui
- **Observability** - Loguru logging, optional Langfuse integration

## Setup

### Requirements
- Python 3.13+
- Neo4j 5.0+
- Ollama (for local LLM and embeddings)

### Installation

```bash
uv sync
uv run app/main.py
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
OLLAMA_BASE_URL=http://localhost:11434
LLM_API_KEY=  # For OpenAI/Grok models
LLM_API_URL=  # For custom LLM endpoints
```
