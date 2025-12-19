"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Trash2, AlertTriangle, PlusIcon, WrenchIcon, BrainIcon, SparklesIcon, UploadIcon, FileTextIcon, Loader2Icon, FileIcon, EyeIcon, HashIcon, GlobeIcon, ImageIcon } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useChatStore, type AgentData } from "@/lib/store"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type KnowledgeDocument = {
  id: string
  filename: string
  doc_type: string
  source_url?: string
  chunk_count: number
  created_at: string
}

type KnowledgeChunk = {
  index: number
  content: string
  summary: string
  topics: string[]
}

type AgentMemory = {
  id: string
  type: string
  content: string
}

// Universal content tags with their colors (works for any domain)
const TAG_COLORS: Record<string, string> = {
  overview: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  detail: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  definition: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
  explanation: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  instruction: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  example: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  reference: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  narrative: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30",
  analysis: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  comparison: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  opinion: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  quote: "bg-stone-500/15 text-stone-600 dark:text-stone-400 border-stone-500/30",
  question: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  list: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  data: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  code: "bg-lime-500/15 text-lime-600 dark:text-lime-400 border-lime-500/30",
  tip: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  warning: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  context: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30",
  dialogue: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30",
}

const ALL_TAGS = Object.keys(TAG_COLORS)

export function AgentsTab() {
  const {
    availableAgents,
    promptVariables,
    allTools,
    toolsByCategory,
    fetchAgentsIfStale,
    fetchModelsIfStale,
    invalidateCache,
    models,
  } = useChatStore(
    useShallow((s) => ({
      availableAgents: s.availableAgents,
      promptVariables: s.promptVariables,
      allTools: s.allTools,
      toolsByCategory: s.toolsByCategory,
      fetchAgentsIfStale: s.fetchAgentsIfStale,
      fetchModelsIfStale: s.fetchModelsIfStale,
      invalidateCache: s.invalidateCache,
      models: s.models,
    }))
  )

  const [editingAgent, setEditingAgent] = useState<AgentData | null>(null)
  const [editingName, setEditingName] = useState("")
  const [warning, setWarning] = useState<string | null>(null)

  // Knowledge base state
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const [enrichmentModel, setEnrichmentModel] = useState("grok-4-1-fast-non-reasoning")

  // Document chunks dialog state
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null)
  const [documentChunks, setDocumentChunks] = useState<KnowledgeChunk[]>([])
  const [isLoadingChunks, setIsLoadingChunks] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  // Memories state
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [isLoadingMemories, setIsLoadingMemories] = useState(false)
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string | null>(null)

  // Polling / cancellation
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)
  const editingAgentNameRef = useRef<string | null>(null)

  useEffect(() => {
    editingAgentNameRef.current = editingAgent?.name ?? null
  }, [editingAgent?.name])

  const cleanupPolling = useCallback(() => {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    pollTimeoutRef.current = null
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      cleanupPolling()
    }
  }, [cleanupPolling])

  // Fetch agents/models only when this tab mounts (i.e., when the user opens it)
  useEffect(() => {
    fetchAgentsIfStale()
    fetchModelsIfStale()
  }, [fetchAgentsIfStale, fetchModelsIfStale])

  const saveAgent = async () => {
    if (!editingAgent) return
    const agentToSave = { ...editingAgent, name: editingName }
    const exists = availableAgents.find((a) => a.name === editingName)
    const method = exists ? "PUT" : "POST"
    const url = method === "PUT" ? `${API_URL}/agents/${editingName}` : `${API_URL}/agents`
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentToSave),
    })
    const data = await res.json()
    setWarning(data.warning || null)
    invalidateCache("agents")
    await fetchAgentsIfStale()
    setEditingAgent(null)
  }

  const deleteAgent = async (name: string) => {
    await fetch(`${API_URL}/agents/${name}`, { method: "DELETE" })
    invalidateCache("agents")
    await fetchAgentsIfStale()
    if (editingAgent?.name === name) setEditingAgent(null)
  }

  const startEdit = (a: AgentData) => {
    setEditingAgent(a)
    setEditingName(a.name)
  }

  const startNewAgent = () => {
    setEditingAgent({
      name: "",
      prompt: "",
      enabled_tools: [],
      max_memories: 5,
      max_tool_runs: 10,
      is_template: false,
    })
    setEditingName("")
  }

  const insertVariable = (v: string) => {
    if (!editingAgent) return
    setEditingAgent({ ...editingAgent, prompt: editingAgent.prompt + v })
  }

  const toggleTool = (tool: string) => {
    if (!editingAgent) return
    const tools = new Set(editingAgent.enabled_tools)
    if (tools.has(tool)) tools.delete(tool)
    else tools.add(tool)
    setEditingAgent({ ...editingAgent, enabled_tools: Array.from(tools) })
  }

  const toggleCategory = (categoryTools: string[], enable: boolean) => {
    if (!editingAgent) return
    const tools = new Set(editingAgent.enabled_tools)
    categoryTools.forEach((t) => (enable ? tools.add(t) : tools.delete(t)))
    setEditingAgent({ ...editingAgent, enabled_tools: Array.from(tools) })
  }

  const fetchDocuments = useCallback(async (agentName: string) => {
    try {
      const res = await fetch(`${API_URL}/agents/${agentName}/knowledge`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents || [])
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error)
    }
  }, [])

  const fetchMemories = useCallback(async (agentName: string) => {
    setIsLoadingMemories(true)
    try {
      const res = await fetch(`${API_URL}/agents/${agentName}/memories?limit=100`)
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories || [])
      }
    } catch (error) {
      console.error("Failed to fetch memories:", error)
    } finally {
      setIsLoadingMemories(false)
    }
  }, [])

  const deleteMemory = async (memoryId: string) => {
    if (!editingAgent) return
    try {
      await fetch(`${API_URL}/agents/${editingAgent.name}/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" })
      fetchMemories(editingAgent.name)
    } catch (error) {
      console.error("Failed to delete memory:", error)
    }
  }

  const pollTaskStatus = useCallback(
    async (taskId: string) => {
      const checkStatus = async () => {
        const agentName = editingAgentNameRef.current
        if (!agentName || unmountedRef.current) return

        try {
          pollAbortRef.current?.abort()
          const ctrl = new AbortController()
          pollAbortRef.current = ctrl

          const res = await fetch(`${API_URL}/agents/${agentName}/knowledge/status/${taskId}`, {
            signal: ctrl.signal,
          })

          if (!res.ok) return
          const data = await res.json()
          if (unmountedRef.current) return

          setUploadStatus(data.message)

          if (data.total_chunks > 0) {
            setUploadProgress({ current: data.current_chunk, total: data.total_chunks })
          }

          if (data.status === "completed") {
            setIsUploading(false)
            setUploadProgress(null)
            fetchDocuments(agentName)
            pollTimeoutRef.current = setTimeout(() => setUploadStatus(null), 3000)
            return
          }

          if (data.status === "error") {
            setIsUploading(false)
            setUploadProgress(null)
            pollTimeoutRef.current = setTimeout(() => setUploadStatus(null), 5000)
            return
          }

          pollTimeoutRef.current = setTimeout(checkStatus, 500)
        } catch (error) {
          // Ignore aborts; otherwise surface a lightweight error state.
          if ((error as { name?: string }).name === "AbortError") return
          setIsUploading(false)
          setUploadProgress(null)
          setUploadStatus("Failed to check status")
        }
      }

      cleanupPolling()
      checkStatus()
    },
    [cleanupPolling, fetchDocuments]
  )

  const uploadFile = async (file: File) => {
    if (!editingAgent?.name) return
    cleanupPolling()
    setIsUploading(true)
    setUploadStatus("Uploading...")
    setUploadProgress(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      const useEnrichment = enrichmentModel !== "none"
      formData.append("enrich_with_llm", useEnrichment.toString())
      if (useEnrichment) formData.append("enrichment_model", enrichmentModel)

      const res = await fetch(`${API_URL}/agents/${editingAgent.name}/knowledge/upload`, {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        setUploadStatus("Upload failed")
        setIsUploading(false)
        return
      }

      const data = await res.json()
      setUploadStatus("Processing...")
      pollTaskStatus(data.task_id)
    } catch (error) {
      setUploadStatus("Upload failed")
      setIsUploading(false)
    }
  }

  const deleteDocument = async (docId: string) => {
    if (!editingAgent?.name) return
    try {
      const res = await fetch(`${API_URL}/agents/${editingAgent.name}/knowledge/${docId}`, { method: "DELETE" })
      if (res.ok) fetchDocuments(editingAgent.name)
    } catch (error) {
      console.error("Failed to delete document:", error)
    }
  }

  const fetchDocumentChunks = async (doc: KnowledgeDocument | null) => {
    if (!editingAgent?.name || !doc) return
    setSelectedDocument(doc)
    setIsLoadingChunks(true)
    setDocumentChunks([])

    try {
      const res = await fetch(`${API_URL}/agents/${editingAgent.name}/knowledge/${doc.id}`)
      if (res.ok) {
        const data = await res.json()
        setDocumentChunks(data.chunks || [])
      }
    } catch (error) {
      console.error("Failed to fetch document chunks:", error)
    } finally {
      setIsLoadingChunks(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length > 0) uploadFile(files[0])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) uploadFile(files[0])
  }

  // Fetch documents and memories when editing agent changes; also stop any ongoing polling.
  useEffect(() => {
    cleanupPolling()
    setUploadProgress(null)
    setUploadStatus(null)
    setIsUploading(false)

    if (editingAgent?.name) {
      fetchDocuments(editingAgent.name)
      fetchMemories(editingAgent.name)
    } else {
      setDocuments([])
      setMemories([])
    }
  }, [cleanupPolling, editingAgent?.name, fetchDocuments, fetchMemories])

  const getDocTypeIcon = (docType: string) => {
    switch (docType) {
      case "pdf":
        return <FileTextIcon className="size-4" />
      case "url":
        return <GlobeIcon className="size-4" />
      case "image":
        return <ImageIcon className="size-4" />
      default:
        return <FileIcon className="size-4" />
    }
  }

  return (
    <div className="flex h-full">
      {/* Agent List - Left Panel */}
      <div className="w-80 border-r p-4 flex flex-col gap-3 overflow-auto bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Agents</h3>
          <Button size="sm" variant="outline" onClick={startNewAgent} className="gap-1">
            <PlusIcon className="size-4" />
            New agent
          </Button>
        </div>

        {warning && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 text-sm">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="text-xs">{warning}</span>
          </div>
        )}

        <div className="space-y-2">
          {availableAgents.map((m) => (
            <div
              key={m.name}
              onClick={() => startEdit(m)}
              className={`relative group p-3 rounded-lg border cursor-pointer transition-all hover:border-primary/50 hover:bg-accent/50 ${
                editingAgent?.name === m.name ? "ring-2 ring-primary bg-accent border-primary" : "bg-card"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{m.name}</span>
                {m.is_template && (
                  <Badge variant="secondary" className="text-[10px]">
                    template
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
                <span className="flex items-center gap-1">
                  <BrainIcon className="size-3" />
                  <span className="text-foreground/70">{m.max_memories}</span>
                </span>
                <span className="flex items-center gap-1">
                  <WrenchIcon className="size-3" />
                  <span className="text-foreground/70">
                    {m.enabled_tools.length}/{allTools.length}
                  </span>
                </span>
              </div>
              {!m.is_template && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 absolute top-2 right-2 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteAgent(m.name)
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Agent Editor - Right Panel */}
      <div className="flex-1 p-6 overflow-auto">
        {editingAgent ? (
          <div className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="max-w-xs text-lg font-semibold h-10"
                  placeholder="Agent name"
                />
                {editingName !== editingAgent.name && editingAgent.name && <Badge variant="default">Save as new</Badge>}
                {editingAgent.is_template && <Badge variant="secondary">template</Badge>}
              </div>
              <div className="flex gap-2">
                {!editingAgent.is_template && editingAgent.name && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      deleteAgent(editingAgent.name)
                      setEditingAgent(null)
                    }}
                  >
                    <Trash2 className="size-4 mr-1" />
                    Delete
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setEditingAgent(null)}>
                  Cancel
                </Button>
                <Button onClick={saveAgent} disabled={!editingName.trim()}>
                  {editingName !== editingAgent.name && editingAgent.name ? "Save as New" : "Save"}
                </Button>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">System Prompt</CardTitle>
                <CardDescription>
                  Available variables:
                  <span className="flex gap-1 mt-2 flex-wrap">
                    {promptVariables.map((v) => (
                      <Button
                        key={v.name}
                        variant="outline"
                        size="sm"
                        onClick={() => insertVariable(v.name)}
                        title={v.desc}
                        className="text-xs h-6 px-2"
                      >
                        {v.name}
                      </Button>
                    ))}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={editingAgent.prompt}
                  onChange={(e) => setEditingAgent({ ...editingAgent, prompt: e.target.value })}
                  rows={10}
                  className="font-mono text-sm"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Limits</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Max Memories</Label>
                      <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingAgent.max_memories}</span>
                    </div>
                    <Slider
                      value={[editingAgent.max_memories]}
                      min={1}
                      max={20}
                      onValueChange={([v]) => setEditingAgent({ ...editingAgent, max_memories: v })}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Max Tool Runs</Label>
                      <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingAgent.max_tool_runs}</span>
                    </div>
                    <Slider
                      value={[editingAgent.max_tool_runs]}
                      min={1}
                      max={50}
                      onValueChange={([v]) => setEditingAgent({ ...editingAgent, max_tool_runs: v })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Tools</CardTitle>
                    <CardDescription>
                      {editingAgent.enabled_tools.length} of {allTools.length} enabled
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingAgent({ ...editingAgent, enabled_tools: allTools })}>
                      Enable All
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingAgent({ ...editingAgent, enabled_tools: [] })}>
                      Disable All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(toolsByCategory).map(([cat, data]) => {
                  const catTools = data.tools.map((t) => t.name)
                  const enabledCount = catTools.filter((t) => editingAgent.enabled_tools.includes(t)).length
                  return (
                    <div key={cat} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {data.label} <span className="text-muted-foreground">({enabledCount}/{catTools.length})</span>
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => toggleCategory(catTools, true)}
                          >
                            All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => toggleCategory(catTools, false)}
                          >
                            None
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.tools.map((tool) => (
                          <div
                            key={tool.name}
                            onClick={() => toggleTool(tool.name)}
                            title={tool.description}
                            className={`px-2.5 py-1 text-xs rounded-md cursor-pointer border transition-colors ${
                              editingAgent.enabled_tools.includes(tool.name)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted text-foreground hover:bg-accent border-border"
                            }`}
                          >
                            {tool.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Knowledge Base Card (per-agent) */}
            {editingAgent.name && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm">Agent Knowledge Base</CardTitle>
                      <CardDescription>
                        Upload documents to give this agent specific knowledge. Use {"{agent_knowledge}"} in the prompt to inject relevant content.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">LLM enrichment</Label>
                      <Select value={enrichmentModel} onValueChange={setEnrichmentModel}>
                        <SelectTrigger className="w-52 h-8 text-xs">
                          <SelectValue placeholder="Model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-xs">
                            None (faster)
                          </SelectItem>
                          {models.map((m) => (
                            <SelectItem key={m.name} value={m.name} className="text-xs">
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Upload Status */}
                  {uploadStatus && (
                    <div
                      className={`p-3 rounded-lg text-sm ${
                        isUploading
                          ? "bg-blue-500/10 text-blue-600"
                          : uploadStatus.includes("failed") || uploadStatus.includes("error")
                            ? "bg-red-500/10 text-red-600"
                            : "bg-green-500/10 text-green-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isUploading && <Loader2Icon className="size-4 animate-spin" />}
                        <span className="flex-1">{uploadStatus}</span>
                        {uploadProgress && uploadProgress.total > 0 && (
                          <span className="text-xs font-mono">
                            {uploadProgress.current}/{uploadProgress.total}
                          </span>
                        )}
                      </div>
                      {uploadProgress && uploadProgress.total > 0 && (
                        <div className="mt-2 h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* File Upload Zone */}
                  <div
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                    className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer"
                  >
                    <input
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-upload"
                      accept=".pdf,.txt,.md"
                      disabled={isUploading}
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <UploadIcon className="size-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium">Drop files here or click to upload</p>
                      <p className="text-xs text-muted-foreground mt-1">Supported: .txt, .md, .pdf</p>
                    </label>
                  </div>

                  {/* Documents List */}
                  {documents.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Documents ({documents.length})</Label>
                      <div className="space-y-2 max-h-48 overflow-auto">
                        {documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors cursor-pointer"
                            onClick={() => fetchDocumentChunks(doc)}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="text-muted-foreground">{getDocTypeIcon(doc.doc_type)}</div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{doc.filename}</p>
                                <p className="text-xs text-muted-foreground">
                                  {doc.chunk_count} chunks • {new Date(doc.created_at).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-primary"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  fetchDocumentChunks(doc)
                                }}
                              >
                                <EyeIcon className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deleteDocument(doc.id)
                                }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {documents.length === 0 && !isUploading && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No documents uploaded yet. Add files or URLs to build this agent&apos;s knowledge base.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Memories Card (per-agent) */}
            {editingAgent.name && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm">Agent Memories</CardTitle>
                      <CardDescription>
                        Memories stored by this agent during conversations. Each agent has isolated memory.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {memories.length} memories
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Type Filter */}
                  <div className="flex items-center gap-2 mb-4">
                    <Label className="text-xs text-muted-foreground">Filter:</Label>
                    <div className="flex gap-1">
                      {["All", "Person", "Event", "Fact", "Preference"].map((type) => (
                        <Badge
                          key={type}
                          variant={memoryTypeFilter === (type === "All" ? null : type) ? "default" : "outline"}
                          className="text-xs cursor-pointer"
                          onClick={() => setMemoryTypeFilter(type === "All" ? null : type)}
                        >
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Memories List */}
                  {isLoadingMemories ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : memories.length > 0 ? (
                    <ScrollArea className="h-64">
                      <div className="space-y-2 pr-4">
                        {memories
                          .filter((m) => !memoryTypeFilter || m.type === memoryTypeFilter)
                          .map((mem) => (
                            <div
                              key={mem.id}
                              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors group"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {mem.type}
                                </Badge>
                                <span className="text-sm truncate">{mem.content}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
                                onClick={() => deleteMemory(mem.id)}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                          ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No memories stored yet. Memories will be created during conversations with this agent.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <SparklesIcon className="size-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">Select an agent to edit</p>
            <p className="text-sm">Or create a new one to get started</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={startNewAgent}>
              <PlusIcon className="size-4" />
              Create New Agent
            </Button>
          </div>
        )}
      </div>

      {/* Document Chunks Dialog */}
      <Dialog
        open={selectedDocument !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDocument(null)
            setTagFilter(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {selectedDocument && getDocTypeIcon(selectedDocument.doc_type)}
              {selectedDocument?.filename}
            </DialogTitle>
            <DialogDescription>
              {selectedDocument?.chunk_count} chunks •{" "}
              {selectedDocument && new Date(selectedDocument.created_at).toLocaleDateString()}
              {selectedDocument?.source_url && <span className="block text-xs mt-1 truncate">{selectedDocument.source_url}</span>}
            </DialogDescription>
          </DialogHeader>

          {/* Tag Filter Bar */}
          {documentChunks.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap shrink-0 pb-2 border-b">
              <span className="text-xs text-muted-foreground mr-1">Filter:</span>
              <Badge
                variant={tagFilter === null ? "default" : "outline"}
                className="text-xs cursor-pointer"
                onClick={() => setTagFilter(null)}
              >
                All
              </Badge>
              {ALL_TAGS.filter((tag) => documentChunks.some((c) => c.topics.includes(tag))).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={`text-xs cursor-pointer border ${tagFilter === tag ? TAG_COLORS[tag] : "hover:bg-accent"}`}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              {isLoadingChunks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : documentChunks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No chunks found</p>
              ) : (
                <div className="space-y-4 py-4">
                  {documentChunks
                    .filter((chunk) => !tagFilter || chunk.topics.includes(tagFilter))
                    .map((chunk) => (
                      <div key={chunk.index} className="p-4 rounded-lg border bg-muted/30">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            <HashIcon className="size-3 mr-1" />
                            {chunk.index}
                          </Badge>
                          {chunk.topics.length > 0 &&
                            chunk.topics.map((topic) => (
                              <Badge key={topic} variant="outline" className={`text-xs border ${TAG_COLORS[topic] || ""}`}>
                                {topic}
                              </Badge>
                            ))}
                        </div>
                        {chunk.summary && <p className="text-sm font-medium mb-2">{chunk.summary}</p>}
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{chunk.content}</p>
                      </div>
                    ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


