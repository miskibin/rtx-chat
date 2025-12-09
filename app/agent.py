from typing import Literal
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama
from langchain.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from loguru import logger
import os
import dotenv
dotenv.load_dotenv()

from app.tools import get_tools
from app.tools.memory import get_memory_tools, list_people, retrieve_context, get_user_preferences
from app.tools.other import get_conversation_summary, set_conversation_summary
from app.graph_models import Mode

DEFAULT_PROMPT = """You are a helpful AI assistant.
Current date and time: {datetime}

{user_preferences}

{memories}

Be concise and helpful."""


def get_mode(name: str) -> Mode:
    mode = Mode.get(name)
    return mode if mode else Mode(name="default", prompt=DEFAULT_PROMPT, enabled_tools=[], max_memories=5, max_tool_runs=10)


def get_model_capabilities(model_name: str) -> list[str]:
    if not model_name:
        return []
    if model_name.startswith("grok"):
        return ["tools"]
    import ollama
    info = ollama.show(model_name)
    return info.capabilities or []


def create_agent(
    model_name: str = "qwen3:4b",
    supports_thinking: bool = False,
    enabled_tools: list[str] | None = None,
):
    logger.info(f"Creating agent: {model_name}, thinking={supports_thinking}")
    
    if model_name.startswith("grok"):
        llm = ChatOpenAI(
            model=model_name,
            api_key=os.getenv("LLM_API_KEY"),
            base_url=os.getenv("LLM_API_URL"),
        )
    else:
        llm = ChatOllama(model=model_name, reasoning=True if supports_thinking else None)

    local_tools = get_tools()
    all_tools = local_tools
    
    tools = [t for t in all_tools if enabled_tools is None or t.name in enabled_tools] if enabled_tools else all_tools
    logger.info(f"Loaded {len(tools)} tools: {[t.name for t in tools]}")
    
    llm_with_tools = llm.bind_tools(tools)

    def call_model(state: MessagesState):
        return {"messages": [llm_with_tools.invoke(state["messages"])]}

    def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
        if state["messages"][-1].tool_calls:
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
        self.max_memories = 5
        self.enabled_tools: list[str] | None = None

    def set_model(self, model_name: str):
        if model_name != self.model_name:
            logger.info(f"Switching model: {self.model_name} -> {model_name}")
            self.model_name = model_name
            self.capabilities = get_model_capabilities(model_name)
            self.agent = None

    def get_agent(self):
        if self.agent is None:
            supports_thinking = "thinking" in self.capabilities
            self.agent = create_agent(self.model_name, supports_thinking, self.enabled_tools)
        return self.agent

    def add_user_message(self, content: str):
        self.messages.append(HumanMessage(content=content))

    def add_assistant_message(self, content: str):
        self.messages.append(AIMessage(content=content))

    def get_memories(self, query: str) -> str:
        result = retrieve_context.invoke({"query": query, "limit": self.max_memories})
        return str(result) if result and result != "No results" else ""

    def get_preferences(self) -> str:
        result = get_user_preferences.invoke({})
        return str(result) if result and result != "No preferences" else ""

    def get_people(self) -> list[str]:
        return list_people()

    async def stream_response(self, user_input: str, mode_name: str = "psychological", history: list[dict] | None = None):
        mode = get_mode(mode_name)
        self.max_memories = mode.max_memories
        self.max_tool_runs = mode.max_tool_runs
        self.enabled_tools = mode.enabled_tools if mode.enabled_tools else None
        self.agent = None
        
        yield {"type": "memory_search_start", "query": user_input[:100]}
        memories_text = self.get_memories(user_input)
        yield {"type": "memory_search_end", "memories": memories_text.split("\n") if memories_text else []}

        preferences = self.get_preferences()
        preferences_text = f"User preferences:\n{preferences}" if preferences else ""

        people = self.get_people()
        known_people_text = f"Known people: {', '.join(people)}" if people else "No known people yet."

        system_msg = SystemMessage(
            content=mode.prompt.format(
                datetime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                user_preferences=preferences_text,
                memories=f"Relevant memories:\n{memories_text}" if memories_text else "",
                known_people=known_people_text,
            )
        )

        if history is not None:
            self.messages = [system_msg]
            logger.info(f"Processing history with {len(history)} message(s)")
            for idx, msg in enumerate(history):
                msg_attachments = msg.get("experimental_attachments")
                if msg["role"] == "user":
                    if msg_attachments:
                        logger.info(f"  History msg {idx}: user message with {len(msg_attachments)} attachment(s)")
                        content_parts: list[dict] = [{"type": "text", "text": msg["content"]}]
                        for att in msg_attachments:
                            if att["type"].startswith("image/"):
                                content_parts.append({
                                    "type": "image_url",
                                    "image_url": {"url": att["data"]}
                                })
                        self.messages.append(HumanMessage(content=content_parts))  # type: ignore
                    else:
                        self.messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    self.messages.append(AIMessage(content=msg["content"]))
        else:
            if not self.messages:
                self.messages.append(system_msg)
            else:
                self.messages[0] = system_msg

            self.add_user_message(user_input)

        summary = get_conversation_summary()
        if summary and len(self.messages) > 15:
            system_msg = self.messages[0]
            recent_msgs = self.messages[-6:]
            summary_msg = SystemMessage(content=f"[Previous conversation summary: {summary}]")
            self.messages = [system_msg, summary_msg] + recent_msgs

        agent = self.get_agent()
        config = {"recursion_limit": self.max_tool_runs * 2 + 1}

        logger.info(f"Invoking agent with {len(self.messages)} messages")
        for i, m in enumerate(self.messages):
            msg_type = type(m).__name__
            if isinstance(m.content, list):
                logger.info(f"  Message {i} ({msg_type}): multi-part content with {len(m.content)} parts")
                for j, part in enumerate(m.content):
                    if isinstance(part, dict):
                        logger.info(f"    Part {j}: {part.get('type', 'unknown')}")
            else:
                content_preview = str(m.content)[:100] if m.content else "<empty>"
                logger.info(f"  Message {i} ({msg_type}): {content_preview}")

        full_response = ""
        full_thinking = ""
        pending_tool_calls = {}
        all_messages = list(self.messages)

        async for event in agent.astream_events({"messages": self.messages}, version="v2", config=config):
            kind = event["event"]
            name = event.get("name", "")
            
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                    for tc in chunk.tool_call_chunks:
                        tool_id = tc.get("id")
                        tool_name = tc.get("name", "")
                        if tool_id and tool_name and tool_id not in pending_tool_calls:
                            pending_tool_calls[tool_id] = {"name": tool_name, "args": {}}
                            yield {"type": "tool_start", "name": tool_name, "input": {}, "run_id": tool_id}

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
                            pending_tool_calls[tool_id] = {"name": tool_name, "args": tool_args}
                            yield {"type": "tool_start", "name": tool_name, "input": tool_args, "run_id": tool_id}
                        else:
                            pending_tool_calls[tool_id]["args"] = tool_args

            elif kind == "on_chain_end" and name == "tools":
                output = event.get("data", {}).get("output", {})
                for msg in output.get("messages", []):
                    if isinstance(msg, ToolMessage):
                        tool_id = msg.tool_call_id
                        tool_info = pending_tool_calls.get(tool_id, {})
                        tool_name = tool_info.get("name", "unknown")
                        tool_input = tool_info.get("args", {})
                        yield {"type": "tool_end", "name": tool_name, "input": tool_input, "output": str(msg.content), "run_id": tool_id}
                        all_messages.append(msg)

            elif kind == "on_chain_end" and name == "LangGraph":
                final_output = event.get("data", {}).get("output", {})
                if "messages" in final_output:
                    all_messages = final_output["messages"]

        self.messages = all_messages

    def clear(self):
        self.messages = []
        self.capabilities = []
        set_conversation_summary("")


conversation = ConversationManager()
