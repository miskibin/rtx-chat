from typing import Literal
from datetime import datetime
from langchain_ollama import ChatOllama
from langchain.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from loguru import logger
from mem0 import Memory

from app.tools import get_tools

USER_ID = "default_user"

def create_memory(model_name: str) -> Memory:
    logger.info(f"Creating mem0 memory with model: {model_name}")
    config = {
        "llm": {"provider": "ollama", "config": {"model": model_name, "temperature": 0, "max_tokens": 2000}},
        "embedder": {"provider": "ollama", "config": {"model": "embeddinggemma"}},
        "vector_store": {"provider": "chroma", "config": {"collection_name": "ollama_ui_memory", "path": "./memory_db"}}
    }
    return Memory.from_config(config)

SYSTEM_PROMPT = """You are a helpful AI assistant.
Current date and time: {datetime}

{memories}

Be concise and helpful."""

SYSTEM_PROMPT_WITH_TOOLS = """You are a helpful AI assistant with access to tools.
Current date and time: {datetime}

{memories}

Use tools when needed to help the user. Be concise and helpful."""

def get_model_capabilities(model_name: str) -> list[str]:
    try:
        import ollama
        info = ollama.show(model_name)
        return info.capabilities or []
    except:
        return []

def create_agent(model_name: str = "qwen3:4b", use_tools: bool = True, supports_thinking: bool = False):
    logger.info(f"Creating agent with model: {model_name}, tools={use_tools}, thinking={supports_thinking}")
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
    
    tools = get_tools()
    logger.info(f"Loaded {len(tools)} tools")
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

    def set_model(self, model_name: str):
        if model_name != self.model_name:
            logger.info(f"Switching model: {self.model_name} -> {model_name}")
            self.model_name = model_name
            self.capabilities = get_model_capabilities(model_name)
            logger.info(f"Model capabilities: {self.capabilities}")
            self.agent = None
            self.memory = create_memory(model_name)
        elif self.memory is None:
            self.memory = create_memory(model_name)

    def get_agent(self):
        if self.agent is None:
            use_tools = "tools" in self.capabilities
            supports_thinking = "thinking" in self.capabilities
            self.agent = create_agent(self.model_name, use_tools=use_tools, supports_thinking=supports_thinking)
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
        memories_list = [r['memory'] for r in results["results"]]
        memories_text = "\n".join([f"- {m}" for m in memories_list])
        logger.info(f"Found {len(memories_list)} memories:\n{memories_text}")
        return f"Relevant memories about this user:\n{memories_text}", memories_list

    def save_memory(self, user_msg: str, assistant_msg: str) -> list[str]:
        conversation_text = f"User: {user_msg}\nAssistant: {assistant_msg}"
        logger.debug(f"Saving to memory: {conversation_text[:100]}...")
        result = self.memory.add(conversation_text, user_id=USER_ID)
        logger.info(f"Memory save result: {result}")
        saved = [r.get("memory", "") for r in result.get("results", []) if r.get("event") in ["ADD", "UPDATE"]]
        logger.info(f"Saved memories: {saved}")
        return saved

    async def stream_response(self, user_input: str):
        yield {"type": "memory_search_start", "query": user_input[:100]}
        memories_text, memories_list = self.get_memories(user_input)
        yield {"type": "memory_search_end", "memories": memories_list}
        
        if not self.messages:
            use_tools = "tools" in self.capabilities
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
        agent = self.get_agent()
        supports_thinking = "thinking" in self.capabilities
        logger.info(f"Streaming response, history={len(self.messages)} messages, thinking={supports_thinking}")
        
        full_response = ""
        full_thinking = ""
        
        async for event in agent.astream_events({"messages": self.messages}, version="v2"):
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
                logger.info(f"Tool invoked: {event['name']} with input: {event.get('data', {}).get('input', {})}")
                yield {"type": "tool_start", "name": event["name"], "input": event.get("data", {}).get("input", {})}
            elif kind == "on_tool_end":
                logger.info(f"Tool result: {event['name']}")
                yield {"type": "tool_end", "name": event["name"], "output": str(event["data"]["output"])}
        
        final_state = await agent.ainvoke({"messages": self.messages})
        last_msg = final_state["messages"][-1]
        if isinstance(last_msg, AIMessage):
            self.messages = final_state["messages"]
            logger.info(f"Conversation updated, total={len(self.messages)} messages")
        
        if full_thinking:
            logger.info(f"Total thinking content: {len(full_thinking)} chars")

        yield {"type": "memory_save_start"}
        saved_memories = self.save_memory(user_input, full_response)
        yield {"type": "memory_save_end", "memories": saved_memories}

    def clear(self):
        logger.info(f"Clearing {len(self.messages)} messages")
        self.messages = []
        self.capabilities = []

conversation = ConversationManager()
