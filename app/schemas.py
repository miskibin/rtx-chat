from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    model: str = "qwen3:4b"

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
