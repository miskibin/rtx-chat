import { create } from "zustand"
import { persist } from "zustand/middleware"

type Attachment = { id: string; name: string; type: string; size: number; data: string }
type ToolCall = { name: string; status: "started" | "completed" | "pending_confirmation" | "denied"; input?: Record<string, unknown>; output?: string; artifacts?: string[]; id?: string; category?: string }
type MemorySearchOp = { type: "search"; status: "started" | "completed"; query?: string; memories?: string[] }
type MemoryOp = MemorySearchOp
type ThinkingBlock = { id: string; content: string; isStreaming: boolean }
type MessageBranch = { id: string; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type LiveContent = { content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type MessageMetadata = { elapsed_time: number; input_tokens: number; output_tokens: number; tokens_per_second: number }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; branches?: MessageBranch[]; currentBranch?: number; liveContent?: LiveContent; metadata?: MessageMetadata; experimental_attachments?: Attachment[] }
type Model = { name: string; supports_tools: boolean; supports_thinking: boolean; supports_vision: boolean }
type PromptVariable = { name: string; desc: string }
type ModeData = { name: string; prompt: string; enabled_tools: string[]; max_memories: number; max_tool_runs: number; is_template: boolean }

type ChatStore = {
  messages: MessageType[]
  input: string
  status: "ready" | "streaming"
  models: Model[]
  selectedModel: string
  currentThinkingId: string | null
  editingMessageId: string | null
  selectedMode: string
  availableModes: ModeData[]
  promptVariables: PromptVariable[]
  allTools: string[]
  setMessages: (fn: (msgs: MessageType[]) => MessageType[]) => void
  addMessage: (msg: MessageType) => void
  setInput: (input: string) => void
  setStatus: (status: "ready" | "streaming") => void
  setModels: (models: Model[]) => void
  setSelectedModel: (model: string) => void
  setCurrentThinkingId: (id: string | null) => void
  setEditingMessageId: (id: string | null) => void
  setSelectedMode: (mode: string) => void
  setAvailableModes: (modes: ModeData[], variables: PromptVariable[], allTools: string[]) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      input: "",
      status: "ready",
      models: [],
      selectedModel: "qwen3:4b",
      currentThinkingId: null,
      editingMessageId: null,
      selectedMode: "psychological",
      availableModes: [],
      promptVariables: [],
      allTools: [],
      setMessages: (fn) => set((state) => ({ messages: fn(state.messages) })),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      setInput: (input) => set({ input }),
      setStatus: (status) => set({ status }),
      setModels: (models) => set({ models }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setCurrentThinkingId: (currentThinkingId) => set({ currentThinkingId }),
      setEditingMessageId: (editingMessageId) => set({ editingMessageId }),
      setSelectedMode: (selectedMode) => set({ selectedMode }),
      setAvailableModes: (modes, variables, allTools) => set({ availableModes: modes, promptVariables: variables, allTools }),
      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: "chat-storage",
      partialize: (state) => ({
        messages: state.messages,
        selectedModel: state.selectedModel,
        selectedMode: state.selectedMode,
      }),
    }
  )
)

export type { Attachment, ToolCall, MemoryOp, MemorySearchOp, ThinkingBlock, MessageType, MessageBranch, LiveContent, MessageMetadata, Model, ModeData, PromptVariable }
