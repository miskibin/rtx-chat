from pydantic import BaseModel

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    messages: list[ChatMessage] | None = None
    model: str = "qwen3:4b"
    system_prompt: str = "psychological"
    max_tool_runs: int = 10
    max_memories: int = 5
    enabled_tools: list[str] | None = None

class ChatResponse(BaseModel):
    content: str

class ModelInfo(BaseModel):
    name: str
    context_length: int
    supports_tools: bool
    supports_thinking: bool
    supports_vision: bool = False
    parameters: str
    family: str

class ModelsResponse(BaseModel):
    models: list[ModelInfo]
