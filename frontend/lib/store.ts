import { create } from "zustand"
import { persist } from "zustand/middleware"

type ToolCall = { name: string; status: "started" | "completed"; input?: Record<string, unknown>; output?: string; artifacts?: string[] }
type MemoryOp = { type: "search"; status: "started" | "completed"; query?: string; memories?: string[] }
type ThinkingBlock = { id: string; content: string; isStreaming: boolean }
type MessageBranch = { id: string; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; branches?: MessageBranch[]; currentBranch?: number }
type Model = { name: string; supports_tools: boolean; supports_thinking: boolean }

type ChatStore = {
  messages: MessageType[]
  input: string
  status: "ready" | "streaming"
  models: Model[]
  selectedModel: string
  memoryModel: string
  currentThinkingId: string | null
  editingMessageId: string | null
  setMessages: (fn: (msgs: MessageType[]) => MessageType[]) => void
  addMessage: (msg: MessageType) => void
  setInput: (input: string) => void
  setStatus: (status: "ready" | "streaming") => void
  setModels: (models: Model[]) => void
  setSelectedModel: (model: string) => void
  setMemoryModel: (model: string) => void
  setCurrentThinkingId: (id: string | null) => void
  setEditingMessageId: (id: string | null) => void
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
      memoryModel: "qwen3:1.7b",
      currentThinkingId: null,
      editingMessageId: null,
      setMessages: (fn) => set((s) => ({ messages: fn(s.messages) })),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      setInput: (input) => set({ input }),
      setStatus: (status) => set({ status }),
      setModels: (models) => set({ models }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setMemoryModel: (memoryModel) => set({ memoryModel }),
      setCurrentThinkingId: (currentThinkingId) => set({ currentThinkingId }),
      setEditingMessageId: (editingMessageId) => set({ editingMessageId }),
      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: "chat-storage",
      partialize: (state) => ({
        messages: state.messages,
        selectedModel: state.selectedModel,
        memoryModel: state.memoryModel,
      }),
    }
  )
)

export type { ToolCall, MemoryOp, ThinkingBlock, MessageType, MessageBranch, Model }
