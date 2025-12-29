import { create } from "zustand"
import { persist } from "zustand/middleware"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

const CACHE_DURATIONS = {
  models: 30 * 60 * 1000,      // 30 minutes (models rarely change)
  agents: 30 * 60 * 1000,       // 30 minutes (agents rarely change)
  conversations: 2 * 60 * 1000, // 2 minutes
  memories: 2 * 60 * 1000,      // 2 minutes
}

type CacheTimestamps = {
  models: number
  agents: number
  conversations: number
  memories: number
}

type Attachment = { id: string; name: string; type: string; size: number; data: string }
type ToolCall = { name: string; status: "started" | "completed" | "pending_confirmation" | "denied"; input?: Record<string, unknown>; output?: string; artifacts?: string[]; id?: string; category?: string }
type MemorySearchOp = { type: "search"; status: "started" | "completed"; query?: string; memories?: string[] }
type MemoryOp = MemorySearchOp
type KnowledgeSearchOp = { type: "search"; status: "started" | "completed"; query?: string; chunks?: string[] }
type KnowledgeOp = KnowledgeSearchOp
type ContextCompressionOp = { status: "completed"; summary: string; messages_summarized: number; tokens_before: number; tokens_after: number; tokens_saved: number }
type ThinkingBlock = { id: string; content: string; isStreaming: boolean }
type MessageBranch = { id: string; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; knowledgeOps?: KnowledgeOp[] }
type LiveContent = { content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; knowledgeOps?: KnowledgeOp[] }
type MessageMetadata = { elapsed_time: number; input_tokens: number; output_tokens: number; tokens_per_second: number; model?: string }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[]; knowledgeOps?: KnowledgeOp[]; contextCompression?: ContextCompressionOp; branches?: MessageBranch[]; currentBranch?: number; liveContent?: LiveContent; metadata?: MessageMetadata; experimental_attachments?: Attachment[] }
type Model = { name: string; supports_tools: boolean; supports_thinking: boolean; supports_vision: boolean }
type PromptVariable = { name: string; desc: string }
type AgentData = { name: string; prompt: string; enabled_tools: string[]; max_memories: number; max_tool_runs: number; is_template: boolean; min_similarity?: number; context_compression?: boolean; context_max_tokens?: number; context_window_tokens?: number }
type ConversationMeta = { id: string; title: string; updated_at: string; agent: string; model: string }
type Person = { id: string; name: string; description: string; relation: string; sentiment: string }
type Event = { id: string; description: string; date: string; participants: string[] }
type Memory = { id: string; type: string; content: string }
type Duplicate = { id1: string; id2: string; content1: string; content2: string; score: number; type: string }
type GraphNode = { id: string; type: string; name: string }
type GraphLink = { source: string; target: string; type: string }
type GraphData = { nodes: GraphNode[]; links: GraphLink[] }
type MemoriesData = { memories: Memory[]; people: Person[]; events: Event[]; duplicates: Duplicate[]; graphData: GraphData }
type GlobalSettings = { knowledge_min_similarity: number; memory_min_similarity: number }

type ChatStore = {
  messages: MessageType[]
  input: string
  status: "ready" | "streaming"
  models: Model[]
  selectedModel: string
  currentThinkingId: string | null
  editingMessageId: string | null
  selectedAgent: string
  availableAgents: AgentData[]
  promptVariables: PromptVariable[]
  allTools: string[]
  toolsByCategory: Record<string, { label: string; tools: { name: string; description: string }[] }>
  conversations: ConversationMeta[]
  currentConversationId: string | null
  titleGeneration: boolean
  autoSave: boolean
  memoriesData: MemoriesData
  globalSettings: GlobalSettings
  cacheTimestamps: CacheTimestamps
  setMessages: (fn: (msgs: MessageType[]) => MessageType[]) => void
  addMessage: (msg: MessageType) => void
  setInput: (input: string) => void
  setStatus: (status: "ready" | "streaming") => void
  setModels: (models: Model[]) => void
  setSelectedModel: (model: string) => void
  setCurrentThinkingId: (id: string | null) => void
  setEditingMessageId: (id: string | null) => void
  setSelectedAgent: (agent: string) => void
  setAvailableAgents: (agents: AgentData[], variables: PromptVariable[], allTools: string[]) => void
  setToolsByCategory: (toolsByCategory: Record<string, { label: string; tools: { name: string; description: string }[] }>) => void
  clearMessages: () => void
  setConversations: (conversations: ConversationMeta[]) => void
  setCurrentConversationId: (id: string | null) => void
  loadConversation: (id: string, messages: MessageType[], agent?: string, model?: string) => void
  startNewConversation: () => void
  setTitleGeneration: (enabled: boolean) => void
  setAutoSave: (enabled: boolean) => void
  setMemoriesData: (data: MemoriesData) => void
  setGlobalSettings: (settings: GlobalSettings) => void
  fetchGlobalSettings: () => Promise<GlobalSettings>
  updateGlobalSettings: (patch: Partial<GlobalSettings>) => Promise<GlobalSettings>
  fetchInitData: () => Promise<{ models: Model[]; agents: AgentData[]; conversations: ConversationMeta[] }>
  fetchModelsIfStale: () => Promise<Model[]>
  fetchAgentsIfStale: () => Promise<AgentData[]>
  fetchConversationsIfStale: () => Promise<ConversationMeta[]>
  invalidateCache: (key: keyof CacheTimestamps) => void
  _hasHydrated: boolean
  setHasHydrated: (state: boolean) => void
}

const isCacheValid = (timestamp: number, duration: number) => Date.now() - timestamp < duration

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      input: "",
      status: "ready",
      models: [],
      selectedModel: "",
      currentThinkingId: null,
      editingMessageId: null,
      selectedAgent: "",
      availableAgents: [],
      promptVariables: [],
      allTools: [],
      toolsByCategory: {},
      conversations: [],
      currentConversationId: null,
      titleGeneration: true,
      autoSave: true,
      memoriesData: { memories: [], people: [], events: [], duplicates: [], graphData: { nodes: [], links: [] } },
      globalSettings: { knowledge_min_similarity: 0.7, memory_min_similarity: 0.65 },
      cacheTimestamps: { models: 0, agents: 0, conversations: 0, memories: 0 },
      setMessages: (fn) => set((state) => ({ messages: fn(state.messages) })),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      setInput: (input) => set({ input }),
      setStatus: (status) => set({ status }),
      setModels: (models) => set({ models }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setCurrentThinkingId: (currentThinkingId) => set({ currentThinkingId }),
      setEditingMessageId: (editingMessageId) => set({ editingMessageId }),
      setSelectedAgent: (selectedAgent) => set({ selectedAgent }),
      setAvailableAgents: (agents, variables, allTools) => set({ availableAgents: agents, promptVariables: variables, allTools }),
      setToolsByCategory: (toolsByCategory) => set({ toolsByCategory }),
      clearMessages: () => set({ messages: [], currentConversationId: null }),
      setConversations: (conversations) => set({ conversations }),
      setCurrentConversationId: (currentConversationId) => set({ currentConversationId }),
      loadConversation: (id, messages, agent, model) => set({ 
        currentConversationId: id, 
        messages,
        ...(agent && { selectedAgent: agent }),
        ...(model && { selectedModel: model }),
      }),
      startNewConversation: () => set({ messages: [], currentConversationId: null }),
      setTitleGeneration: (titleGeneration) => set({ titleGeneration }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setMemoriesData: (memoriesData) => set({ memoriesData }),
      setGlobalSettings: (globalSettings) => set({ globalSettings }),
      fetchGlobalSettings: async () => {
        const res = await fetch(`${API_URL}/settings`)
        const settings = await res.json()
        set({ globalSettings: settings })
        return settings
      },
      updateGlobalSettings: async (patch) => {
        const res = await fetch(`${API_URL}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        })
        const settings = await res.json()
        set({ globalSettings: settings })
        return settings
      },
      invalidateCache: (key) => set((state) => ({ cacheTimestamps: { ...state.cacheTimestamps, [key]: 0 } })),
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

      fetchInitData: async () => {
        const state = get()
        const now = Date.now()
        const modelsValid = state.models.length > 0 && isCacheValid(state.cacheTimestamps.models, CACHE_DURATIONS.models)
        const agentsValid = state.availableAgents.length > 0 && isCacheValid(state.cacheTimestamps.agents, CACHE_DURATIONS.agents)
        const conversationsValid = state.conversations.length > 0 && isCacheValid(state.cacheTimestamps.conversations, CACHE_DURATIONS.conversations)
        
        // If all caches are valid, return cached data
        if (modelsValid && agentsValid && conversationsValid) {
          return { models: state.models, agents: state.availableAgents, conversations: state.conversations }
        }
        
        // Fetch combined data from /init endpoint
        const res = await fetch(`${API_URL}/init`)
        const data = await res.json()
        const models = data.models || []
        const agents = data.agents || []
        const conversations = data.conversations || []
        
        set({ 
          models,
          availableAgents: agents,
          promptVariables: data.variables || [],
          allTools: data.all_tools || [],
          toolsByCategory: data.tools_by_category || {},
          conversations,
          cacheTimestamps: { 
            ...get().cacheTimestamps, 
            models: now, 
            agents: now, 
            conversations: now 
          } 
        })
        
        return { models, agents, conversations }
      },

      fetchModelsIfStale: async () => {
        const state = get()
        if (state.models.length > 0 && isCacheValid(state.cacheTimestamps.models, CACHE_DURATIONS.models)) {
          return state.models
        }
        const res = await fetch(`${API_URL}/models`)
        const data = await res.json()
        const models = data.models || []
        set({ models, cacheTimestamps: { ...get().cacheTimestamps, models: Date.now() } })
        return models
      },

      fetchAgentsIfStale: async () => {
        const state = get()
        if (state.availableAgents.length > 0 && isCacheValid(state.cacheTimestamps.agents, CACHE_DURATIONS.agents)) {
          return state.availableAgents
        }
        const res = await fetch(`${API_URL}/agents`)
        const data = await res.json()
        const agents = data.agents || []
        set({ 
          availableAgents: agents, 
          promptVariables: data.variables || [], 
          allTools: data.all_tools || [],
          toolsByCategory: data.tools_by_category || {},
          cacheTimestamps: { ...get().cacheTimestamps, agents: Date.now() } 
        })
        return agents
      },

      fetchConversationsIfStale: async () => {
        const state = get()
        if (state.conversations.length > 0 && isCacheValid(state.cacheTimestamps.conversations, CACHE_DURATIONS.conversations)) {
          return state.conversations
        }
        const res = await fetch(`${API_URL}/conversations`)
        const data = await res.json()
        const conversations = data.conversations || []
        set({ conversations, cacheTimestamps: { ...get().cacheTimestamps, conversations: Date.now() } })
        return conversations
      },
    }),
    {
      name: "chat-storage",
      skipHydration: true,
      partialize: (state) => ({
        messages: state.messages,
        selectedModel: state.selectedModel,
        selectedAgent: state.selectedAgent,
        currentConversationId: state.currentConversationId,
        titleGeneration: state.titleGeneration,
        autoSave: state.autoSave,
        models: state.models,
        availableAgents: state.availableAgents,
        cacheTimestamps: state.cacheTimestamps,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

export type { Attachment, ToolCall, MemoryOp, MemorySearchOp, KnowledgeOp, KnowledgeSearchOp, ContextCompressionOp, ThinkingBlock, MessageType, MessageBranch, LiveContent, MessageMetadata, Model, AgentData, PromptVariable, ConversationMeta, MemoriesData, Person, Event, Memory, Duplicate, GraphData, GlobalSettings }
