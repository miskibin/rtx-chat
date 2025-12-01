from typing import Literal
from datetime import datetime
import asyncio
from langchain_ollama import ChatOllama
from langchain.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from loguru import logger
from mem0 import Memory

from app.tools import get_tools, get_conversation_summary, set_conversation_summary

USER_ID = "default_user"
DEFAULT_MEMORY_MODEL = "qwen3:1.7b"

def create_memory(model_name: str) -> Memory:
    logger.info(f"Creating mem0 memory with model: {model_name}")
    config = {
        "llm": {"provider": "ollama", "config": {"model": model_name, "temperature": 0, "max_tokens": 2000}},
        "embedder": {"provider": "ollama", "config": {"model": "embeddinggemma"}},
        "vector_store": {"provider": "chroma", "config": {"collection_name": "ollama_ui_memory", "path": "./memory_db"}}
    }
    return Memory.from_config(config)

MEMORY_INSTRUCTION = """Use the save_memory tool to remember important user information.
Use update_memory tool to update existing memories when you have their ID.
Save memories for: personal facts, preferences, important events, goals, challenges."""

PSYCH_MEMORY_INSTRUCTION = """Use the save_memory tool to remember therapeutic information about the user.

MEMORY RULES:
1. Each memory should be focused - ONE main fact/event per save_memory call
2. Keep memories under 250 characters
3. If user shares multiple distinct facts, make separate save_memory calls
4. Check existing memories first - do NOT save duplicates

Memory types:
- "event" - life event (date, what happened, key emotion)
- "belief" - belief or pattern about self/others
- "preference" - therapy/communication preference  
- "goal" - goal or aspiration
- "challenge" - current challenge or stressor
- "emotion" - emotional state and context

GOOD examples:
- save_memory("Breakup with Alia Feb 2025, 3-year relationship ended due to betrayal", "event")
- save_memory("Alia: narcissistic, manipulative, presents as religious but hypocritical", "belief")
- save_memory("Nov 2025: Alia posted song portraying herself as victim at user's expense", "event")

NEVER write memory notes in your response text.

CONVERSATION SUMMARY:
When conversation gets long (15+ messages), use create_summary to compress history."""

SYSTEM_PROMPT = f"""You are a helpful AI assistant.
Current date and time: {{datetime}}

{{memories}}

Be concise and helpful.

{MEMORY_INSTRUCTION}"""

SYSTEM_PROMPT_WITH_TOOLS = f"""You are a helpful AI assistant with access to tools.
Current date and time: {{datetime}}

{{memories}}

Use tools when needed to help the user. Be concise and helpful.

{MEMORY_INSTRUCTION}"""

PSYCH_SYSTEM_PROMPT = f"""You are a compassionate psychological support assistant. Your role is to provide emotional support, help process feelings, and assist with personal growth.

Current date and time: {{datetime}}

{{memories}}

Guidelines:
- Be warm, empathetic, and non-judgmental
- Ask thoughtful questions to understand deeper
- Validate emotions before offering perspectives
- Use therapeutic techniques (CBT, ACT, mindfulness) when appropriate
- Remember and reference past conversations and patterns
- Help identify recurring themes and growth opportunities
- Never diagnose or replace professional therapy
- Respect boundaries and pace of the user

When responding:
1. Acknowledge feelings first
2. Reflect back what you hear
3. Offer gentle exploration questions
4. Suggest coping strategies when appropriate
5. Celebrate progress and wins

IMPORTANT: You MUST use save_memory tool when user shares emotional content, life events, or personal information.
After using the tool, respond naturally without mentioning that you saved anything.
NEVER print memory notes like "[type]:", "Krótka notatka pamięciowa", or "(Zapisane w pamięci)" in your text response.

{PSYCH_MEMORY_INSTRUCTION}"""

PSYCH_SYSTEM_PROMPT_WITH_TOOLS = f"""You are a compassionate psychological support assistant with access to tools. Your role is to provide emotional support, help process feelings, and assist with personal growth.

Current date and time: {{datetime}}

{{memories}}

Guidelines:
- Be warm, empathetic, and non-judgmental
- Ask thoughtful questions to understand deeper
- Validate emotions before offering perspectives
- Use therapeutic techniques (CBT, ACT, mindfulness) when appropriate
- Remember and reference past conversations and patterns
- Help identify recurring themes and growth opportunities
- Never diagnose or replace professional therapy
- Respect boundaries and pace of the user

When responding:
1. Acknowledge feelings first
2. Reflect back what you hear
3. Offer gentle exploration questions
4. Suggest coping strategies when appropriate
5. Celebrate progress and wins

Use tools when needed to help the user.

IMPORTANT: You MUST use save_memory tool when user shares emotional content, life events, or personal information.
After using the tool, respond naturally without mentioning that you saved anything.
NEVER print memory notes like "[type]:", "Krótka notatka pamięciowa", or "(Zapisane w pamięci)" in your text response.

{PSYCH_MEMORY_INSTRUCTION}"""

def get_model_capabilities(model_name: str) -> list[str]:
    try:
        import ollama
        info = ollama.show(model_name)
        return info.capabilities or []
    except:
        return []

def create_agent(model_name: str = "qwen3:4b", use_tools: bool = True, supports_thinking: bool = False, enabled_tools: list[str] | None = None):
    logger.info(f"Creating agent with model: {model_name}, tools={use_tools}, thinking={supports_thinking}, enabled_tools={enabled_tools}")
    llm = ChatOllama(model=model_name, reasoning=True if supports_thinking else None)
    
    if not use_tools:
        def call_model(state: MessagesState):
            response = llm.invoke(state["messages"])
            return {"messages": [response]}
        
        builder = StateGraph(MessagesState)
        builder.add_node("model", call_model)
        builder.add_edge(START, "model")
        builder.add_edge("model", END)
        return builder.compile()
    
    all_tools = get_tools()
    tools = [t for t in all_tools if enabled_tools is None or t.name in enabled_tools] if enabled_tools else all_tools
    logger.info(f"Loaded {len(tools)}/{len(all_tools)} tools: {[t.name for t in tools]}")
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
        self.memory: Memory | None = None
        self.max_tool_runs = 10
        self.enabled_tools: list[str] | None = None

    def set_model(self, model_name: str):
        if model_name != self.model_name:
            logger.info(f"Switching model: {self.model_name} -> {model_name}")
            self.model_name = model_name
            self.capabilities = get_model_capabilities(model_name)
            logger.info(f"Model capabilities: {self.capabilities}")
            self.agent = None
        if self.memory is None:
            self.memory = create_memory(DEFAULT_MEMORY_MODEL)

    def set_settings(self, max_tool_runs: int = 10, enabled_tools: list[str] | None = None):
        if max_tool_runs != self.max_tool_runs or enabled_tools != self.enabled_tools:
            self.max_tool_runs = max_tool_runs
            self.enabled_tools = enabled_tools
            self.agent = None
            logger.info(f"Settings updated: max_tool_runs={max_tool_runs}, enabled_tools={enabled_tools}")

    def get_agent(self):
        if self.agent is None:
            use_tools = "tools" in self.capabilities
            supports_thinking = "thinking" in self.capabilities
            self.agent = create_agent(self.model_name, use_tools=use_tools, supports_thinking=supports_thinking, enabled_tools=self.enabled_tools)
        return self.agent

    def add_user_message(self, content: str):
        logger.debug(f"User: {content[:100]}...")
        self.messages.append(HumanMessage(content=content))

    def add_assistant_message(self, content: str):
        self.messages.append(AIMessage(content=content))

    def get_memories(self, query: str) -> tuple[str, list[str]]:
        logger.debug(f"Searching memories for: {query[:50]}...")
        results = self.memory.search(query, user_id=USER_ID, limit=5)
        logger.debug(f"Memory search results: {results}")
        if not results or not results.get("results"):
            logger.info("No relevant memories found")
            return "", []
        memories_list = [f"{r['memory']}" for r in results["results"]]
        memories_with_ids = [f"[id:{r['id']}] {r['memory']}" for r in results["results"]]
        memories_text = "\n".join([f"- {m}" for m in memories_with_ids])
        logger.info(f"Found {len(memories_list)} memories:\n{memories_text}")
        return f"Existing memories (use id to update):\n{memories_text}", memories_list

    async def stream_response(self, user_input: str, psychological_mode: bool = False):
        yield {"type": "memory_search_start", "query": user_input[:100]}
        memories_text, memories_list = self.get_memories(user_input)
        yield {"type": "memory_search_end", "memories": memories_list}
        
        use_tools = "tools" in self.capabilities
        logger.info(f"Capabilities: {self.capabilities}, use_tools={use_tools}, psych_mode={psychological_mode}")
        
        if not self.messages:
            if psychological_mode:
                prompt = PSYCH_SYSTEM_PROMPT_WITH_TOOLS if use_tools else PSYCH_SYSTEM_PROMPT
            else:
                prompt = SYSTEM_PROMPT_WITH_TOOLS if use_tools else SYSTEM_PROMPT
            system_msg = SystemMessage(content=prompt.format(
                datetime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                memories=memories_text
            ))
            self.messages.append(system_msg)
            logger.debug(f"System prompt: {system_msg.content[:200]}...")
        elif memories_text:
            self.messages[0] = SystemMessage(content=self.messages[0].content.split("Relevant memories")[0].strip() + "\n\n" + memories_text)
            logger.debug(f"Updated system prompt with memories")
            
        self.add_user_message(user_input)
        
        summary = get_conversation_summary()
        if summary and len(self.messages) > 15:
            logger.info(f"Compressing history with summary, had {len(self.messages)} messages")
            system_msg = self.messages[0]
            recent_msgs = self.messages[-6:]
            summary_msg = SystemMessage(content=f"[Previous conversation summary: {summary}]")
            self.messages = [system_msg, summary_msg] + recent_msgs
            logger.info(f"Compressed to {len(self.messages)} messages")
        
        agent = self.get_agent()
        supports_thinking = "thinking" in self.capabilities
        logger.info(f"Streaming response, history={len(self.messages)} messages, thinking={supports_thinking}, max_tool_runs={self.max_tool_runs}")
        
        full_response = ""
        full_thinking = ""
        config = {"recursion_limit": self.max_tool_runs * 2 + 1}
        
        async for event in agent.astream_events({"messages": self.messages}, version="v2", config=config):
            kind = event["event"]
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                reasoning = chunk.additional_kwargs.get("reasoning_content", "")
                if reasoning:
                    full_thinking += reasoning
                    yield {"type": "thinking", "content": reasoning}
                if chunk.content:
                    full_response += chunk.content
                    yield {"type": "content", "content": chunk.content}
            elif kind == "on_tool_start":
                tool_input = event.get("data", {}).get("input", {})
                tool_name = event.get("name", "unknown")
                run_id = event.get("run_id", "")
                logger.info(f"Tool invoked: {tool_name} (run_id: {run_id}) with input: {tool_input}")
                yield {"type": "tool_start", "name": tool_name, "input": tool_input, "run_id": run_id}
            elif kind == "on_tool_end":
                tool_name = event.get("name", "unknown")
                tool_output = str(event.get("data", {}).get("output", ""))
                run_id = event.get("run_id", "")
                logger.info(f"Tool result: {tool_name} (run_id: {run_id}) -> {tool_output[:100]}")
                yield {"type": "tool_end", "name": tool_name, "output": tool_output, "run_id": run_id}
            elif kind == "on_chain_error":
                err = str(event.get("data", {}).get("error", "Unknown error"))
                if "error parsing tool call" in err.lower():
                    logger.warning(f"Tool parsing error (will retry): {err[:200]}")
                    yield {"type": "error", "message": "I had trouble formatting that. Let me try again..."}
                else:
                    logger.error(f"Chain error: {err}")
        
        final_state = await agent.ainvoke({"messages": self.messages}, config=config)
        last_msg = final_state["messages"][-1]
        if isinstance(last_msg, AIMessage):
            self.messages = final_state["messages"]
            logger.info(f"Conversation updated, total={len(self.messages)} messages")
        
        if full_thinking:
            logger.info(f"Total thinking content: {len(full_thinking)} chars")

    def clear(self):
        logger.info(f"Clearing {len(self.messages)} messages")
        self.messages = []
        self.capabilities = []
        set_conversation_summary("")

conversation = ConversationManager()
