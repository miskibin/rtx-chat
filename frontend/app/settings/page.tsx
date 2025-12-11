"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { SidebarInset } from "@/components/ui/sidebar"
import { PageHeader } from "@/components/page-header"
import { 
  Trash2, 
  AlertTriangle, 
  PlusIcon, 
  WrenchIcon,
  BrainIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  MessageSquareIcon,
  UploadIcon,
  LinkIcon,
  FileTextIcon,
  Loader2Icon,
  FileIcon,
  GlobeIcon,
  ImageIcon,
  EyeIcon,
  HashIcon
} from "lucide-react"
import { useChatStore, ModeData } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export default function SettingsPage() {
  const { 
    availableModes,
    promptVariables,
    allTools,
    toolsByCategory,
    fetchModesIfStale,
    invalidateCache,
    titleGeneration,
    setTitleGeneration,
    autoSave,
    setAutoSave,
    models,
    fetchModelsIfStale
  } = useChatStore()
  const [editingMode, setEditingMode] = useState<ModeData | null>(null)
  const [editingName, setEditingName] = useState("")
  const [warning, setWarning] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("general")
  
  // Knowledge base state
  const [documents, setDocuments] = useState<Array<{
    id: string
    filename: string
    doc_type: string
    source_url?: string
    chunk_count: number
    created_at: string
  }>>([])
  const [urlInput, setUrlInput] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [enrichWithLlm, setEnrichWithLlm] = useState(true)
  const [enrichmentModel, setEnrichmentModel] = useState("qwen3:4b")
  
  // Document chunks dialog state
  const [selectedDocument, setSelectedDocument] = useState<{
    id: string
    filename: string
    doc_type: string
    source_url?: string
    chunk_count: number
    created_at: string
  } | null>(null)
  const [documentChunks, setDocumentChunks] = useState<Array<{
    index: number
    content: string
    summary: string
    topics: string[]
  }>>([])
  const [isLoadingChunks, setIsLoadingChunks] = useState(false)

  // Load modes and models from cache or fetch if stale
  useEffect(() => { 
    fetchModesIfStale()
    fetchModelsIfStale()
  }, [fetchModesIfStale, fetchModelsIfStale])

  const saveMode = async () => {
    if (!editingMode) return
    const modeToSave = { ...editingMode, name: editingName }
    const exists = availableModes.find(m => m.name === editingName)
    const method = exists ? "PUT" : "POST"
    const url = method === "PUT" ? `${API_URL}/modes/${editingName}` : `${API_URL}/modes`
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(modeToSave) })
    const data = await res.json()
    setWarning(data.warning || null)
    // Invalidate cache and refetch
    invalidateCache("modes")
    await fetchModesIfStale()
    setEditingMode(null)
  }

  const deleteMode = async (name: string) => {
    await fetch(`${API_URL}/modes/${name}`, { method: "DELETE" })
    // Invalidate cache and refetch
    invalidateCache("modes")
    await fetchModesIfStale()
    if (editingMode?.name === name) setEditingMode(null)
  }

  const startEdit = (m: ModeData) => {
    setEditingMode(m)
    setEditingName(m.name)
  }

  const startNewMode = () => {
    setEditingMode({
      name: "",
      prompt: "",
      enabled_tools: [],
      max_memories: 5,
      max_tool_runs: 10,
      is_template: false,
      min_similarity: 0.7
    })
    setEditingName("")
  }

  const insertVariable = (v: string) => {
    if (!editingMode) return
    setEditingMode({ ...editingMode, prompt: editingMode.prompt + v })
  }

  const toggleTool = (tool: string) => {
    if (!editingMode) return
    const tools = new Set(editingMode.enabled_tools)
    if (tools.has(tool)) tools.delete(tool)
    else tools.add(tool)
    setEditingMode({ ...editingMode, enabled_tools: Array.from(tools) })
  }

  const toggleCategory = (categoryTools: string[], enable: boolean) => {
    if (!editingMode) return
    const tools = new Set(editingMode.enabled_tools)
    categoryTools.forEach(t => enable ? tools.add(t) : tools.delete(t))
    setEditingMode({ ...editingMode, enabled_tools: Array.from(tools) })
  }

  // Knowledge base functions
  const fetchDocuments = async (modeName: string) => {
    try {
      const res = await fetch(`${API_URL}/modes/${modeName}/knowledge`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents || [])
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error)
    }
  }

  const uploadFile = async (file: File) => {
    if (!editingMode?.name) return
    setIsUploading(true)
    setUploadStatus("Uploading...")
    
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("enrich_with_llm", enrichWithLlm.toString())
      formData.append("enrichment_model", enrichmentModel)
      
      const res = await fetch(`${API_URL}/modes/${editingMode.name}/knowledge/upload`, {
        method: "POST",
        body: formData
      })
      
      if (res.ok) {
        const data = await res.json()
        setUploadStatus("Processing...")
        // Poll for status
        pollTaskStatus(data.task_id)
      } else {
        setUploadStatus("Upload failed")
        setIsUploading(false)
      }
    } catch (error) {
      setUploadStatus("Upload failed")
      setIsUploading(false)
    }
  }

  const uploadUrl = async () => {
    if (!editingMode?.name || !urlInput.trim()) return
    setIsUploading(true)
    setUploadStatus("Fetching URL...")
    
    try {
      const res = await fetch(`${API_URL}/modes/${editingMode.name}/knowledge/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput, enrich_with_llm: enrichWithLlm, enrichment_model: enrichmentModel })
      })
      
      if (res.ok) {
        const data = await res.json()
        setUploadStatus("Processing...")
        setUrlInput("")
        // Poll for status
        pollTaskStatus(data.task_id)
      } else {
        setUploadStatus("Failed to process URL")
        setIsUploading(false)
      }
    } catch (error) {
      setUploadStatus("Failed to process URL")
      setIsUploading(false)
    }
  }

  const pollTaskStatus = async (taskId: string) => {
    if (!editingMode?.name) return
    
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/modes/${editingMode.name}/knowledge/status/${taskId}`)
        if (res.ok) {
          const data = await res.json()
          setUploadStatus(data.message)
          
          if (data.status === "completed") {
            setIsUploading(false)
            fetchDocuments(editingMode.name)
            setTimeout(() => setUploadStatus(null), 3000)
          } else if (data.status === "error") {
            setIsUploading(false)
            setTimeout(() => setUploadStatus(null), 5000)
          } else {
            // Still processing, poll again
            setTimeout(checkStatus, 1000)
          }
        }
      } catch (error) {
        setIsUploading(false)
        setUploadStatus("Failed to check status")
      }
    }
    
    checkStatus()
  }

  const deleteDocument = async (docId: string) => {
    if (!editingMode?.name) return
    
    try {
      const res = await fetch(`${API_URL}/modes/${editingMode.name}/knowledge/${docId}`, {
        method: "DELETE"
      })
      if (res.ok) {
        fetchDocuments(editingMode.name)
      }
    } catch (error) {
      console.error("Failed to delete document:", error)
    }
  }

  const fetchDocumentChunks = async (doc: typeof selectedDocument) => {
    if (!editingMode?.name || !doc) return
    
    setSelectedDocument(doc)
    setIsLoadingChunks(true)
    setDocumentChunks([])
    
    try {
      const res = await fetch(`${API_URL}/modes/${editingMode.name}/knowledge/${doc.id}`)
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
    if (files.length > 0) {
      uploadFile(files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      uploadFile(files[0])
    }
  }

  // Fetch documents when editing mode changes
  useEffect(() => {
    if (editingMode?.name) {
      fetchDocuments(editingMode.name)
    } else {
      setDocuments([])
    }
  }, [editingMode?.name])

  const getDocTypeIcon = (docType: string) => {
    switch (docType) {
      case "pdf": return <FileTextIcon className="size-4" />
      case "url": return <GlobeIcon className="size-4" />
      case "image": return <ImageIcon className="size-4" />
      default: return <FileIcon className="size-4" />
    }
  }

  return (
    <SidebarInset className="flex flex-col h-screen bg-background">
      <PageHeader title="Settings" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6">
          <TabsList className="h-11 mt-2">
            <TabsTrigger value="general" className="gap-2">
              <SlidersHorizontalIcon className="size-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="modes" className="gap-2">
              <SparklesIcon className="size-4" />
              Modes
              <Badge variant="secondary" className="ml-1 rounded text-[10px] px-1.5">{availableModes.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* General Tab */}
        <TabsContent value="general" className="flex-1 overflow-auto mt-0 p-6">
          <div className="mx-auto max-w-2xl space-y-6">
            
            {/* Conversation Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-amber-500/10">
                    <MessageSquareIcon className="size-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Conversations</CardTitle>
                    <CardDescription>Control how conversations are managed</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-save conversations</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically save conversations as you chat
                    </p>
                  </div>
                  <Switch 
                    checked={autoSave} 
                    onCheckedChange={setAutoSave}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>AI-generated titles</Label>
                    <p className="text-xs text-muted-foreground">
                      Use the LLM to generate conversation titles
                    </p>
                  </div>
                  <Switch 
                    checked={titleGeneration} 
                    onCheckedChange={setTitleGeneration}
                  />
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>

        {/* Modes Tab */}
        <TabsContent value="modes" className="flex-1 overflow-auto mt-0">
          <div className="flex h-full">
            {/* Mode List - Left Panel */}
            <div className="w-80 border-r p-4 flex flex-col gap-3 overflow-auto bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Modes</h3>
                <Button size="sm" variant="outline" onClick={startNewMode} className="gap-1">
                  <PlusIcon className="size-4" />
                  New
                </Button>
              </div>
              
              {warning && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 text-sm">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span className="text-xs">{warning}</span>
                </div>
              )}

              <div className="space-y-2">
                {availableModes.map(m => (
                  <div 
                    key={m.name} 
                    onClick={() => startEdit(m)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all hover:border-primary/50 hover:bg-accent/50 ${editingMode?.name === m.name ? "ring-2 ring-primary bg-accent border-primary" : "bg-card"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{m.name}</span>
                      {m.is_template && <Badge variant="secondary" className="text-[10px]">template</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
                      <span className="flex items-center gap-1">
                        <BrainIcon className="size-3" />
                        <span className="text-foreground/70">{m.max_memories}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <WrenchIcon className="size-3" />
                        <span className="text-foreground/70">{m.enabled_tools.length}/{allTools.length}</span>
                      </span>
                    </div>
                    {!m.is_template && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-6 absolute top-2 right-2 opacity-0 group-hover:opacity-100" 
                        onClick={(e) => { e.stopPropagation(); deleteMode(m.name) }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Mode Editor - Right Panel */}
            <div className="flex-1 p-6 overflow-auto">
              {editingMode ? (
                <div className="max-w-3xl space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Input 
                        value={editingName} 
                        onChange={e => setEditingName(e.target.value)} 
                        className="max-w-xs text-lg font-semibold h-10" 
                        placeholder="Mode name" 
                      />
                      {editingName !== editingMode.name && editingMode.name && (
                        <Badge variant="default">Save as new</Badge>
                      )}
                      {editingMode.is_template && (
                        <Badge variant="secondary">template</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!editingMode.is_template && editingMode.name && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => { deleteMode(editingMode.name); setEditingMode(null) }}
                        >
                          <Trash2 className="size-4 mr-1" />
                          Delete
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditingMode(null)}>Cancel</Button>
                      <Button onClick={saveMode} disabled={!editingName.trim()}>
                        {editingName !== editingMode.name && editingMode.name ? "Save as New" : "Save"}
                      </Button>
                    </div>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">System Prompt</CardTitle>
                      <CardDescription>
                        Available variables:
                        <span className="flex gap-1 mt-2 flex-wrap">
                          {promptVariables.map(v => (
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
                        value={editingMode.prompt} 
                        onChange={e => setEditingMode({ ...editingMode, prompt: e.target.value })} 
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
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingMode.max_memories}</span>
                          </div>
                          <Slider 
                            value={[editingMode.max_memories]} 
                            min={1} 
                            max={20} 
                            onValueChange={([v]) => setEditingMode({ ...editingMode, max_memories: v })} 
                          />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">Max Tool Runs</Label>
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingMode.max_tool_runs}</span>
                          </div>
                          <Slider 
                            value={[editingMode.max_tool_runs]} 
                            min={1} 
                            max={50} 
                            onValueChange={([v]) => setEditingMode({ ...editingMode, max_tool_runs: v })} 
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
                          <CardDescription>{editingMode.enabled_tools.length} of {allTools.length} enabled</CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingMode({ ...editingMode, enabled_tools: allTools })}>Enable All</Button>
                          <Button variant="outline" size="sm" onClick={() => setEditingMode({ ...editingMode, enabled_tools: [] })}>Disable All</Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {Object.entries(toolsByCategory).map(([cat, data]) => {
                        const catTools = data.tools.map(t => t.name)
                        const enabledCount = catTools.filter(t => editingMode.enabled_tools.includes(t)).length
                        return (
                          <div key={cat} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{data.label} <span className="text-muted-foreground">({enabledCount}/{catTools.length})</span></span>
                              <div className="flex gap-1">
                                <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => toggleCategory(catTools, true)}>All</Button>
                                <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => toggleCategory(catTools, false)}>None</Button>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {data.tools.map(tool => (
                                <div 
                                  key={tool.name} 
                                  onClick={() => toggleTool(tool.name)}
                                  title={tool.description}
                                  className={`px-2.5 py-1 text-xs rounded-md cursor-pointer border transition-colors ${editingMode.enabled_tools.includes(tool.name) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-foreground hover:bg-accent border-border"}`}
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

                  {/* Knowledge Base Card */}
                  {editingMode.name && (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-sm">Knowledge Base</CardTitle>
                            <CardDescription>
                              Upload documents to give this mode specific knowledge. Use {"{mode_knowledge}"} in the prompt to inject relevant content.
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Min similarity</Label>
                              <Slider 
                                value={[editingMode.min_similarity ?? 0.7]} 
                                min={0.3} 
                                max={0.95} 
                                step={0.05}
                                onValueChange={([v]) => setEditingMode({ ...editingMode, min_similarity: v })} 
                                className="w-24" 
                              />
                              <span className="text-xs font-mono w-8">{(editingMode.min_similarity ?? 0.7).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs text-muted-foreground">LLM enrichment</Label>
                              <Switch 
                                checked={enrichWithLlm} 
                                onCheckedChange={setEnrichWithLlm}
                              />
                            </div>
                            {enrichWithLlm && (
                              <Select value={enrichmentModel} onValueChange={setEnrichmentModel}>
                                <SelectTrigger className="w-40 h-8 text-xs">
                                  <SelectValue placeholder="Model" />
                                </SelectTrigger>
                                <SelectContent>
                                  {models.map((m) => (
                                    <SelectItem key={m.name} value={m.name} className="text-xs">
                                      {m.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Upload Status */}
                        {uploadStatus && (
                          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${isUploading ? "bg-blue-500/10 text-blue-600" : uploadStatus.includes("failed") || uploadStatus.includes("error") ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-600"}`}>
                            {isUploading && <Loader2Icon className="size-4 animate-spin" />}
                            <span>{uploadStatus}</span>
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
                            accept=".pdf,.txt,.md,.json,.png,.jpg,.jpeg,.webp"
                            disabled={isUploading}
                          />
                          <label htmlFor="file-upload" className="cursor-pointer">
                            <UploadIcon className="size-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm font-medium">Drop files here or click to upload</p>
                            <p className="text-xs text-muted-foreground mt-1">PDF, images, text files</p>
                          </label>
                        </div>

                        {/* URL Input */}
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <Input 
                              value={urlInput}
                              onChange={(e) => setUrlInput(e.target.value)}
                              placeholder="https://example.com/page"
                              className="pl-9"
                              disabled={isUploading}
                              onKeyDown={(e) => e.key === "Enter" && uploadUrl()}
                            />
                          </div>
                          <Button 
                            onClick={uploadUrl} 
                            disabled={!urlInput.trim() || isUploading}
                            variant="outline"
                          >
                            Add URL
                          </Button>
                        </div>

                        {/* Documents List */}
                        {documents.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                              Documents ({documents.length})
                            </Label>
                            <div className="space-y-2 max-h-48 overflow-auto">
                              {documents.map((doc) => (
                                <div 
                                  key={doc.id}
                                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors cursor-pointer"
                                  onClick={() => fetchDocumentChunks(doc)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="text-muted-foreground">
                                      {getDocTypeIcon(doc.doc_type)}
                                    </div>
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
                                      onClick={(e) => { e.stopPropagation(); fetchDocumentChunks(doc) }}
                                    >
                                      <EyeIcon className="size-4" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon"
                                      className="size-8 text-muted-foreground hover:text-destructive"
                                      onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id) }}
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
                            No documents uploaded yet. Add files or URLs to build this mode's knowledge base.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <SparklesIcon className="size-12 mb-4 opacity-30" />
                  <p className="text-lg font-medium">Select a mode to edit</p>
                  <p className="text-sm">Or create a new one to get started</p>
                  <Button variant="outline" className="mt-4 gap-2" onClick={startNewMode}>
                    <PlusIcon className="size-4" />
                    Create New Mode
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Document Chunks Dialog */}
      <Dialog open={selectedDocument !== null} onOpenChange={(open) => !open && setSelectedDocument(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDocument && getDocTypeIcon(selectedDocument.doc_type)}
              {selectedDocument?.filename}
            </DialogTitle>
            <DialogDescription>
              {selectedDocument?.chunk_count} chunks • {selectedDocument && new Date(selectedDocument.created_at).toLocaleDateString()}
              {selectedDocument?.source_url && (
                <span className="block text-xs mt-1 truncate">{selectedDocument.source_url}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            {isLoadingChunks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : documentChunks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No chunks found</p>
            ) : (
              <div className="space-y-4">
                {documentChunks.map((chunk) => (
                  <div key={chunk.index} className="p-4 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">
                        <HashIcon className="size-3 mr-1" />
                        {chunk.index}
                      </Badge>
                      {chunk.topics.length > 0 && chunk.topics.map((topic) => (
                        <Badge key={topic} variant="secondary" className="text-xs">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                    {chunk.summary && (
                      <p className="text-sm font-medium mb-2">{chunk.summary}</p>
                    )}
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{chunk.content}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </SidebarInset>
  )
}
