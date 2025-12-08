import { create } from "zustand"
import { persist } from "zustand/middleware"

type ToolCall = { name: string; status: "started" | "completed"; input?: Record<string, unknown>; output?: string; artifacts?: string[]; id?: string }
type MemorySearchOp = { type: "search"; status: "started" | "completed"; query?: string; memories?: string[] }
type MemoryOp = MemorySearchOp
type ThinkingBlock = { id: string; content: string; isStreaming: boolean }
type MessageBranch = { id: string; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; branches?: MessageBranch[]; currentBranch?: number }
type Model = { name: string; supports_tools: boolean; supports_thinking: boolean }

type SystemPromptType = "normal" | "psychological"

type Settings = {
  maxToolRuns: number
  maxMemories: number
  enabledTools: string[]
}

type ChatStore = {
  messages: MessageType[]
  input: string
  status: "ready" | "streaming"
  models: Model[]
  selectedModel: string
  currentThinkingId: string | null
  editingMessageId: string | null
  systemPrompt: SystemPromptType
  settings: Settings
  setMessages: (fn: (msgs: MessageType[]) => MessageType[]) => void
  addMessage: (msg: MessageType) => void
  setInput: (input: string) => void
  setStatus: (status: "ready" | "streaming") => void
  setModels: (models: Model[]) => void
  setSelectedModel: (model: string) => void
  setCurrentThinkingId: (id: string | null) => void
  setEditingMessageId: (id: string | null) => void
  setSystemPrompt: (prompt: SystemPromptType) => void
  setSettings: (settings: Partial<Settings>) => void
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
      systemPrompt: "psychological",
      settings: { maxToolRuns: 10, maxMemories: 5, enabledTools: [] },
      setMessages: (fn) => set((state) => ({ messages: fn(state.messages) })),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      setInput: (input) => set({ input }),
      setStatus: (status) => set({ status }),
      setModels: (models) => set({ models }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setCurrentThinkingId: (currentThinkingId) => set({ currentThinkingId }),
      setEditingMessageId: (editingMessageId) => set({ editingMessageId }),
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      setSettings: (settings) => set((s) => ({ settings: { ...s.settings, ...settings } })),
      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: "chat-storage",
      partialize: (state) => ({
        messages: state.messages,
        selectedModel: state.selectedModel,
        systemPrompt: state.systemPrompt,
        settings: state.settings,
      }),
    }
  )
)

export type { ToolCall, MemoryOp, MemorySearchOp, ThinkingBlock, MessageType, MessageBranch, Model, SystemPromptType }
