# RTX Chat

AI-powered chat application with local LLM support and persistent memory management using knowledge graphs.

## Features

### Tools

- **Code Execution** - Run Python code with automatic chart generation (PNG, JPG, SVG) and display
- **Filesystem** - Read/write files, list directories
- **Web Crawling** - Fetch and parse website content with JavaScript rendering via Crawl4AI
- **Memory Management** - Query and update semantic knowledge graph (per-agent isolation)
- **Knowledge Base** - Upload documents (PDF, TXT, MD) to give agents specific knowledge
- **Conversation Summaries** - Auto-summarize long conversations

### Memory System

Memories are stored in a Neo4j graph database with vector embeddings (embeddinggemma model). Each agent has **isolated memories** - memories created by one agent are not visible to others.

**Node Types:**
- **Person** - Individuals with dynamic descriptions. Tracked relationships include sentiment (positive/negative/neutral/complicated) and relation type (colleague, friend, family, etc.)
- **Event** - Occurrences with date, description, and participants
- **Fact** - Discrete knowledge organized by category (possessions, interests, achievements, etc.)
- **Preference** - User preferences for AI behavior (e.g., communication style, response length)
- **User** - Profile with bio

**Relationships:**
- `KNOWS` - User→Person with sentiment, relation type, and since date
- `PARTICIPATED_IN` - Person→Event with role
- `MENTIONS` - Event→Person (relevant mentions)
- `HAS_PREFERENCE` - User→Preference
- `HAS_FACT` - User→Fact
- `HAS_PERSON` / `HAS_EVENT` / `HAS_FACT` / `HAS_PREFERENCE` - Agent→Memory (isolation)

**Memory Tools:**
- `retrieve_context()` - Query by semantic similarity or entity names
- `add_or_update_person()` - Create/update person with sentiment and relationship type
- `add_event()` - Create event with participants and mentioned entities
- `add_fact()` - Add categorical fact about user
- `check_relationship()` - Get relationship details and associated events
- `get_user_preferences()` - Retrieve active preferences

### Knowledge Base

Each agent can have its own knowledge base of uploaded documents. Documents are processed using the `unstructured` library for intelligent partitioning and chunking.

**Supported Formats:** `.txt`, `.md`, `.pdf`

**Features:**
- Semantic chunking that respects document structure
- Optional LLM enrichment for chunk summaries and classification
- Document outline generation for better context during processing
- Vector similarity search for retrieval
- Automatic retry on connection failures

**Content Tags:**
Chunks are classified into content types: `overview`, `detail`, `definition`, `explanation`, `instruction`, `example`, `reference`, `narrative`, `analysis`, `comparison`, `opinion`, `quote`, `question`, `list`, `data`, `code`, `tip`, `warning`, `context`, `dialogue`

## Agents

Agents are configurable AI personas with isolated knowledge and memories. Each agent has its own:
- **System prompt** - Customizable with variable placeholders
- **Enabled tools** - Control which tools the AI can use
- **Knowledge base** - Uploaded documents specific to this agent
- **Memories** - People, events, facts, preferences stored separately

### Agent Configuration

| Setting | Description |
|---------|-------------|
| **prompt** | System prompt template with variable placeholders |
| **enabled_tools** | List of tools the AI can use |
| **max_memories** | Maximum memories to retrieve per request |
| **max_tool_runs** | Maximum tool invocations per response |
| **is_template** | Whether this is a built-in template |

### Template Variables

| Variable | Description |
|----------|-------------|
| `{datetime}` | Current date and time |
| `{memories}` | Retrieved relevant memories (triggers memory search) |
| `{user_preferences}` | User preferences from knowledge graph |
| `{known_people}` | List of known people from memory |
| `{agent_knowledge}` | Relevant content from agent's knowledge base |

**Note:** Memory search is only performed if `{memories}` is present in the prompt.

### Built-in Templates

| Agent | Description | Tools | Max Memories |
|-------|-------------|-------|--------------|
| **minimal** | Brief assistant, no memory tools | Code, Web, Filesystem | 3 |
| **normal** | General-purpose with all tools | All | 5 |
| **psychological** | Empathetic support with memory guidelines | All | 10 |

## Agent Architecture

- **State Management** - LangGraph with MessagesState for multi-turn conversations
- **Tool Binding** - LLM invokes tools automatically within agent loop
- **Streaming** - Server-Sent Events (SSE) for real-time response streaming
- **Memory Integration** - Automatic context injection before generation
- **Agent Isolation** - Each agent has separate knowledge base and memories
- **Configurable Execution** - Control max tool runs, memory retrieval limit, and enabled tools per agent

## LLM Support

- **Local** - Ollama (default: qwen3:4b with reasoning capability)
- **Remote** - OpenAI (GPT-4, etc.) and Grok via API
- **Model Switching** - Dynamic model selection per request
- **Thinking** - Extended reasoning when model supports it

## API Endpoints

### Chat
- `POST /chat/stream` - Stream chat response with memory integration
- `POST /chat/confirm` - Confirm/deny pending tool calls
- `POST /chat/clear` - Clear conversation state

### Agents
- `GET /agents` - List all agents with variables and available tools
- `GET /agents/{name}` - Get agent details
- `POST /agents` - Create new agent
- `PUT /agents/{name}` - Update existing agent
- `DELETE /agents/{name}` - Delete agent

### Knowledge Base (per-agent)
- `POST /agents/{name}/knowledge/upload` - Upload document to agent's knowledge base
- `GET /agents/{name}/knowledge` - List agent's documents
- `GET /agents/{name}/knowledge/{doc_id}` - Get document with chunks
- `GET /agents/{name}/knowledge/status/{task_id}` - Check processing status
- `DELETE /agents/{name}/knowledge/{doc_id}` - Delete document

### Memories (per-agent)
- `GET /agents/{name}/memories` - List agent's memories
- `GET /agents/{name}/memories/{entity_id}` - Get specific memory
- `PUT /agents/{name}/memories/{entity_id}` - Update memory
- `DELETE /agents/{name}/memories/{entity_id}` - Delete memory
- `POST /agents/{name}/memories/merge` - Merge duplicate entities

### Models
- `GET /models` - List available models with capabilities
- `GET /tools` - List all available tools by category

### Conversations
- `GET /conversations` - List all conversations
- `POST /conversations` - Create new conversation
- `GET /conversations/{id}` - Get conversation with messages
- `PUT /conversations/{id}` - Update conversation
- `DELETE /conversations/{id}` - Delete conversation
- `POST /conversations/generate-title` - Generate title from messages

### Settings
- `GET /settings` - Get global application settings
- `PUT /settings` - Update global settings

### Artifacts
- `GET /artifacts/{id}` - Serve generated files (charts, code output)

## Architecture

- **Backend** - FastAPI with LangGraph, LangChain
- **Agent** - Multi-turn conversation with tool loop and memory injection
- **Memory DB** - Neo4j (graph) with vector indexes
- **Embeddings** - Ollama embeddinggemma model (768 dimensions)
- **Document Processing** - unstructured library for PDF/text parsing
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
uv run uvicorn app.main:app --reload
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

## Screenshots

<img width="1916" height="1018" alt="Chat interface" src="https://github.com/user-attachments/assets/48013273-6aa0-45d5-b56c-f250996653a9" />

<img width="1834" height="921" alt="Agent configuration" src="https://github.com/user-attachments/assets/8e9f6991-4b9b-4139-abf0-3088a0ae0e30" />
