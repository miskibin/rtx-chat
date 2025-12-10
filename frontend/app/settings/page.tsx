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
  MessageSquareIcon
} from "lucide-react"
import { useChatStore, ModeData, PromptVariable } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolsByCategory = Record<string, { label: string; tools: { name: string; description: string }[] }>

export default function SettingsPage() {
  const { 
    setAvailableModes, 
    setModels,
    titleGeneration,
    setTitleGeneration,
    autoSave,
    setAutoSave
  } = useChatStore()
  const [modes, setModes] = useState<ModeData[]>([])
  const [variables, setVariables] = useState<PromptVariable[]>([])
  const [allTools, setAllTools] = useState<string[]>([])
  const [toolsByCategory, setToolsByCategory] = useState<ToolsByCategory>({})
  const [editingMode, setEditingMode] = useState<ModeData | null>(null)
  const [editingName, setEditingName] = useState("")
  const [warning, setWarning] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("general")

  const fetchModes = () => {
    fetch(`${API_URL}/modes`).then(r => r.json()).then(d => {
      setModes(d.modes || [])
      setVariables(d.variables || [])
      setAllTools(d.all_tools || [])
      setToolsByCategory(d.tools_by_category || {})
      setAvailableModes(d.modes || [], d.variables || [], d.all_tools || [])
    })
  }

  const fetchModels = () => {
    fetch(`${API_URL}/models`).then(r => r.json()).then(d => {
      setModels(d.models || [])
    })
  }

  useEffect(() => { 
    fetchModes() 
    fetchModels()
  }, [])

  const saveMode = async () => {
    if (!editingMode) return
    const modeToSave = { ...editingMode, name: editingName }
    const exists = modes.find(m => m.name === editingName)
    const method = exists ? "PUT" : "POST"
    const url = method === "PUT" ? `${API_URL}/modes/${editingName}` : `${API_URL}/modes`
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(modeToSave) })
    const data = await res.json()
    setWarning(data.warning || null)
    fetchModes()
    setEditingMode(null)
  }

  const deleteMode = async (name: string) => {
    await fetch(`${API_URL}/modes/${name}`, { method: "DELETE" })
    fetchModes()
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
      is_template: false
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
              <Badge variant="secondary" className="ml-1 rounded text-[10px] px-1.5">{modes.length}</Badge>
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
                {modes.map(m => (
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
                          {variables.map(v => (
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
    </SidebarInset>
  )
}
