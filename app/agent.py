from typing import Literal
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from loguru import logger
import chromadb
import os
import dotenv
dotenv.load_dotenv()
from app.tools import get_tools, get_conversation_summary, set_conversation_summary

_chroma_client = None
_collection = None
_embeddings = None


def _get_memory_collection():
    global _chroma_client, _collection, _embeddings
    if _collection is None:
        _chroma_client = chromadb.PersistentClient(path="./memory_db_direct")
        _collection = _chroma_client.get_or_create_collection("memories")
        _embeddings = OllamaEmbeddings(model="embeddinggemma")
    return _collection, _embeddings


def get_user_preferences() -> list[str]:
    collection, _ = _get_memory_collection()
    results = collection.get(where={"type": "preference"})
    preferences = []
    if results and results.get("ids"):
        for i, _ in enumerate(results["ids"]):
            doc = results["documents"][i]
            clean = doc.replace("[preference]", "").strip()
            preferences.append(clean)
    return preferences


MEMORY_INSTRUCTION = """AUTOMATIC MEMORY SAVING:
Save important user information IMMEDIATELY using save_memory when user shares:
- People names (friends, family, partners)
- Emotions or feelings
- Life events (work, relationships, health)
- Chat interaction preferences (how they want to be addressed, language, style)
- Goals or challenges

SAVE EACH FACT SEPARATELY - call save_memory multiple times if needed!

RULES:
1. ONE atomic fact per save_memory (max 200 chars)
2. Always start with date: "YYYY-MM-DD:"
3. If save_memory returns "DUPLICATE" with an ID, use update_memory with that ID
4. NEVER merge multiple facts into one memory

Memory types: event, belief, preference, goal, challenge, emotion

WORKFLOW: First save memories, THEN respond to user.
NEVER mention saving in your response."""

NORMAL_PROMPT = """You are a helpful AI assistant.
Current date and time: {datetime}

{user_preferences}

{memories}

Be concise and helpful."""

PSYCH_PROMPT = """You are a compassionate psychological support assistant providing emotional support and helping with personal growth.

Current date and time: {datetime}

{user_preferences}

{memories}

Guidelines:
- Be warm, empathetic, and non-judgmental
- Ask thoughtful questions to understand deeper
- Validate emotions before offering perspectives
- Remember and reference past conversations and patterns

{memory_instruction}"""


def get_model_capabilities(model_name: str) -> list[str]:
    if model_name.startswith("grok"):
        return ["tools"]
    try:
        import ollama

        info = ollama.show(model_name)
        return info.capabilities or []
    except:
        return []


def create_agent(
    model_name: str = "qwen3:4b",
    use_tools: bool = True,
    supports_thinking: bool = False,
    enabled_tools: list[str] | None = None,
):
    logger.info(
        f"Creating agent with model: {model_name}, thinking={supports_thinking}, enabled_tools={enabled_tools}"
    )
    if model_name.startswith("grok"):
        llm = ChatOpenAI(
            model=model_name,
            api_key=os.getenv("LLM_API_KEY"),
            base_url=os.getenv("LLM_API_URL"),
        )
    else:
        llm = ChatOllama(
            model=model_name, reasoning=True if supports_thinking else None
        )

    all_tools = get_tools()
    tools = (
        [t for t in all_tools if enabled_tools is None or t.name in enabled_tools]
        if enabled_tools
        else all_tools
    )
    logger.info(
        f"Loaded {len(tools)}/{len(all_tools)} tools: {[t.name for t in tools]}"
    )
    llm_with_tools = llm.bind_tools(tools)

    def call_model(state: MessagesState):
        response = llm_with_tools.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: MessagesState) -> Literal["tools", END]:
        last_message = state["messages"][-1]
        if last_message.tool_calls:
            return "tools"
        return END

    builder = StateGraph(MessagesState)
    builder.add_node("model", call_model)
    builder.add_node("tools", ToolNode(tools))
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", should_continue, ["tools", END])
    builder.add_edge("tools", "model")

    return builder.compile()


class ConversationManager:
    def __init__(self):
        self.messages: list = []
        self.agent = None
        self.model_name = "qwen3:4b"
        self.capabilities: list[str] = []
        self.max_tool_runs = 10
        self.enabled_tools: list[str] | None = None

    def set_model(self, model_name: str):
        if model_name != self.model_name:
            logger.info(f"Switching model: {self.model_name} -> {model_name}")
            self.model_name = model_name
            self.capabilities = get_model_capabilities(model_name)
            logger.info(f"Model capabilities: {self.capabilities}")
            self.agent = None

    def set_settings(
        self, max_tool_runs: int = 10, enabled_tools: list[str] | None = None
    ):
        if max_tool_runs != self.max_tool_runs or enabled_tools != self.enabled_tools:
            self.max_tool_runs = max_tool_runs
            self.enabled_tools = enabled_tools
            self.agent = None
            logger.info(
                f"Settings updated: max_tool_runs={max_tool_runs}, enabled_tools={enabled_tools}"
            )

    def get_agent(self):
        if self.agent is None:
            supports_thinking = "thinking" in self.capabilities
            self.agent = create_agent(
                self.model_name,
                use_tools=True,
                supports_thinking=supports_thinking,
                enabled_tools=self.enabled_tools,
            )
        return self.agent

    def add_user_message(self, content: str):
        logger.debug(f"User: {content[:100]}...")
        self.messages.append(HumanMessage(content=content))

    def add_assistant_message(self, content: str):
        self.messages.append(AIMessage(content=content))

    def get_memories(self, query: str) -> tuple[str, list[str]]:
        logger.debug(f"Searching memories for: {query[:50]}...")
        collection, embeddings = _get_memory_collection()
        embedding = embeddings.embed_query(query)
        results = collection.query(query_embeddings=[embedding], n_results=5)

        if not results or not results.get("documents") or not results["documents"][0]:
            logger.info("No relevant memories found")
            return "", []

        memories_list = []
        memories_with_ids = []
        for i, doc in enumerate(results["documents"][0]):
            mem_id = results["ids"][0][i]
            memories_list.append(doc)
            memories_with_ids.append(f"[id:{mem_id}] {doc}")

        memories_text = "\n".join([f"- {m}" for m in memories_with_ids])
        logger.info(f"Found {len(memories_list)} memories:\n{memories_text}")
        return f"Existing memories (use id to update):\n{memories_text}", memories_list

    async def stream_response(
        self, user_input: str, system_prompt: str = "psychological"
    ):
        yield {"type": "memory_search_start", "query": user_input[:100]}
        memories_text, memories_list = self.get_memories(user_input)
        yield {"type": "memory_search_end", "memories": memories_list}

        preferences = get_user_preferences()
        preferences_text = ""
        if preferences:
            preferences_text = "User preferences for this chat:\n" + "\n".join(
                [f"- {p}" for p in preferences]
            )
            logger.info(f"Loaded {len(preferences)} user preferences")

        logger.info(f"Capabilities: {self.capabilities}, system_prompt={system_prompt}")

        prompt = PSYCH_PROMPT if system_prompt == "psychological" else NORMAL_PROMPT
        
        system_msg = SystemMessage(
            content=prompt.format(
                datetime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                user_preferences=preferences_text,
                memories=memories_text,
                memory_instruction=MEMORY_INSTRUCTION if system_prompt == "psychological" else "",
            )
        )

        if not self.messages:
            self.messages.append(system_msg)
        else:
            self.messages[0] = system_msg

        logger.debug(f"System prompt: {system_msg.content[:200]}...")

        self.add_user_message(user_input)

        summary = get_conversation_summary()
        if summary and len(self.messages) > 15:
            logger.info(
                f"Compressing history with summary, had {len(self.messages)} messages"
            )
            system_msg = self.messages[0]
            recent_msgs = self.messages[-6:]
            summary_msg = SystemMessage(
                content=f"[Previous conversation summary: {summary}]"
            )
            self.messages = [system_msg, summary_msg] + recent_msgs
            logger.info(f"Compressed to {len(self.messages)} messages")

        agent = self.get_agent()
        supports_thinking = "thinking" in self.capabilities
        logger.info(
            f"Streaming response, history={len(self.messages)} messages, thinking={supports_thinking}, max_tool_runs={self.max_tool_runs}"
        )

        full_response = ""
        full_thinking = ""
        config = {"recursion_limit": self.max_tool_runs * 2 + 1}

        pending_tool_calls = {}
        all_messages = list(self.messages)

        async for event in agent.astream_events(
            {"messages": self.messages}, version="v2", config=config
        ):
            kind = event["event"]
            name = event.get("name", "")
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                    for tc in chunk.tool_call_chunks:
                        tool_id = tc.get("id")
                        tool_name = tc.get("name", "")
                        if tool_id and tool_name and tool_id not in pending_tool_calls:
                            pending_tool_calls[tool_id] = {
                                "name": tool_name,
                                "args": {},
                            }
                            logger.info(
                                f"Tool call started (chunk): {tool_name} (id: {tool_id})"
                            )
                            yield {
                                "type": "tool_start",
                                "name": tool_name,
                                "input": {},
                                "run_id": tool_id,
                            }

                reasoning = chunk.additional_kwargs.get("reasoning_content", "")
                if reasoning:
                    full_thinking += reasoning
                    yield {"type": "thinking", "content": reasoning}
                if chunk.content:
                    full_response += chunk.content
                    yield {"type": "content", "content": chunk.content}

            elif kind == "on_chat_model_end":
                output = event.get("data", {}).get("output")
                if output and hasattr(output, "tool_calls") and output.tool_calls:
                    for tc in output.tool_calls:
                        tool_id = tc.get("id", str(len(pending_tool_calls)))
                        tool_name = tc.get("name", "unknown")
                        tool_args = tc.get("args", {})
                        if tool_id not in pending_tool_calls:
                            pending_tool_calls[tool_id] = {
                                "name": tool_name,
                                "args": tool_args,
                            }
                            logger.info(
                                f"Tool call from model_end: {tool_name} (id: {tool_id})"
                            )
                            yield {
                                "type": "tool_start",
                                "name": tool_name,
                                "input": tool_args,
                                "run_id": tool_id,
                            }
                        else:
                            pending_tool_calls[tool_id]["args"] = tool_args

            elif kind == "on_chain_end" and name == "tools":
                output = event.get("data", {}).get("output", {})
                messages = output.get("messages", [])
                for msg in messages:
                    if isinstance(msg, ToolMessage):
                        tool_id = msg.tool_call_id
                        tool_name = pending_tool_calls.get(tool_id, {}).get(
                            "name", "unknown"
                        )
                        tool_output = str(msg.content)
                        logger.info(
                            f"Tool result (chain_end): {tool_name} (id: {tool_id}) -> {tool_output[:100]}"
                        )
                        yield {
                            "type": "tool_end",
                            "name": tool_name,
                            "output": tool_output,
                            "run_id": tool_id,
                        }
                        all_messages.append(msg)

            elif kind == "on_chain_end" and name == "LangGraph":
                final_output = event.get("data", {}).get("output", {})
                if "messages" in final_output:
                    all_messages = final_output["messages"]

        self.messages = all_messages
        logger.info(f"Conversation updated, total={len(self.messages)} messages")

        if full_thinking:
            logger.info(f"Total thinking content: {len(full_thinking)} chars")

    def clear(self):
        logger.info(f"Clearing {len(self.messages)} messages")
        self.messages = []
        self.capabilities = []
        set_conversation_summary("")


conversation = ConversationManager()
