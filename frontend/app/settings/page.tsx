"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { SettingsIcon, Trash2, AlertTriangle } from "lucide-react"
import { useChatStore, ModeData, PromptVariable } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolsByCategory = Record<string, { label: string; tools: { name: string; description: string }[] }>

export default function SettingsPage() {
  const { setAvailableModes } = useChatStore()
  const [modes, setModes] = useState<ModeData[]>([])
  const [variables, setVariables] = useState<PromptVariable[]>([])
  const [allTools, setAllTools] = useState<string[]>([])
  const [toolsByCategory, setToolsByCategory] = useState<ToolsByCategory>({})
  const [editingMode, setEditingMode] = useState<ModeData | null>(null)
  const [editingName, setEditingName] = useState("")
  const [warning, setWarning] = useState<string | null>(null)

  const fetchModes = () => {
    fetch(`${API_URL}/modes`).then(r => r.json()).then(d => {
      setModes(d.modes || [])
      setVariables(d.variables || [])
      setAllTools(d.all_tools || [])
      setToolsByCategory(d.tools_by_category || {})
      setAvailableModes(d.modes || [], d.variables || [], d.all_tools || [])
    })
  }

  useEffect(() => { fetchModes() }, [])

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
      <header className="flex items-center border-b px-6 py-4 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <SidebarTrigger />
        <SettingsIcon className="size-5 text-muted-foreground ml-2" />
        <h1 className="text-lg font-semibold ml-2">Modes</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          
          {warning && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 text-sm">
              <AlertTriangle className="size-4" />
              {warning}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {modes.map(m => (
              <div 
                key={m.name} 
                onClick={() => startEdit(m)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${editingMode?.name === m.name ? "ring-2 ring-primary bg-accent" : ""}`}
              >
                <span className="font-medium">{m.name}</span>
                {m.is_template && <Badge variant="secondary" className="text-xs">template</Badge>}
                <span className="text-xs text-muted-foreground">{m.max_memories}m · {m.max_tool_runs}t</span>
                {!m.is_template && (
                  <Button variant="ghost" size="icon" className="size-5" onClick={(e) => { e.stopPropagation(); deleteMode(m.name) }}>
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {editingMode && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <Label>Name</Label>
                  <Input value={editingName} onChange={e => setEditingName(e.target.value)} className="max-w-xs" placeholder="Mode name (change to save as new)" />
                  {editingName !== editingMode.name && <Badge>Save as new</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>System Prompt</Label>
                    <div className="flex gap-1 flex-wrap">
                      {variables.map(v => (
                        <Button key={v.name} variant="outline" size="sm" onClick={() => insertVariable(v.name)} title={v.desc} className="text-xs h-7">
                          {v.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea value={editingMode.prompt} onChange={e => setEditingMode({ ...editingMode, prompt: e.target.value })} rows={8} className="font-mono text-sm" />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Max Memories</Label>
                      <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingMode.max_memories}</span>
                    </div>
                    <Slider value={[editingMode.max_memories]} min={1} max={20} onValueChange={([v]) => setEditingMode({ ...editingMode, max_memories: v })} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Max Tool Runs</Label>
                      <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{editingMode.max_tool_runs}</span>
                    </div>
                    <Slider value={[editingMode.max_tool_runs]} min={1} max={50} onValueChange={([v]) => setEditingMode({ ...editingMode, max_tool_runs: v })} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Tools ({editingMode.enabled_tools.length}/{allTools.length})</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingMode({ ...editingMode, enabled_tools: allTools })}>All</Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingMode({ ...editingMode, enabled_tools: [] })}>None</Button>
                    </div>
                  </div>
                  
                  {Object.entries(toolsByCategory).map(([cat, data]) => {
                    const catTools = data.tools.map(t => t.name)
                    const enabledCount = catTools.filter(t => editingMode.enabled_tools.includes(t)).length
                    return (
                      <div key={cat} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">{data.label} ({enabledCount}/{catTools.length})</span>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleCategory(catTools, true)}>All</Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleCategory(catTools, false)}>None</Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {data.tools.map(tool => (
                            <div 
                              key={tool.name} 
                              onClick={() => toggleTool(tool.name)}
                              title={tool.description}
                              className={`px-2 py-1 text-xs rounded cursor-pointer border transition-colors ${editingMode.enabled_tools.includes(tool.name) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
                            >
                              {tool.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditingMode(null)}>Cancel</Button>
                  <Button onClick={saveMode}>{editingName !== editingMode.name ? "Save as New" : "Save"}</Button>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </SidebarInset>
  )
}
