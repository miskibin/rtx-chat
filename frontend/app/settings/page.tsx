"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { SettingsIcon, SaveIcon, RotateCcw } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolInfo = { name: string; description: string }

export default function SettingsPage() {
  const { settings, setSettings } = useChatStore()
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [localMaxRuns, setLocalMaxRuns] = useState(settings.maxToolRuns)
  const [localMaxMemories, setLocalMaxMemories] = useState(settings.maxMemories || 5)
  const [localEnabledTools, setLocalEnabledTools] = useState<Set<string>>(new Set(settings.enabledTools))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/tools`).then(r => r.json()).then(d => {
      setTools(d.tools || [])
      const toolNames = new Set(d.tools.map((t: ToolInfo) => t.name))
      const validEnabled = settings.enabledTools.filter(t => toolNames.has(t))
      if (validEnabled.length === 0) {
        setLocalEnabledTools(toolNames)
      } else {
        setLocalEnabledTools(new Set(validEnabled))
      }
    })
  }, [])

  const handleToggleTool = (name: string) => {
    setLocalEnabledTools(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSave = () => {
    setSettings({ maxToolRuns: localMaxRuns, maxMemories: localMaxMemories, enabledTools: Array.from(localEnabledTools) })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setLocalMaxRuns(10)
    setLocalMaxMemories(5)
    setLocalEnabledTools(new Set(tools.map(t => t.name)))
  }

  return (
    <SidebarInset className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          <SettingsIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground hover:text-foreground">
                <RotateCcw className="size-4 mr-2" />
                Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saved}>
            {saved ? <span className="flex items-center gap-2">Saved <SaveIcon className="size-4" /></span> : "Save Changes"}
            </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 md:p-10">
        <div className="mx-auto max-w-3xl space-y-8">
          
          <Card className="border-none shadow-none bg-transparent p-0">
            <CardHeader className="px-0 pt-0">
              <CardTitle>Agent Configuration</CardTitle>
              <CardDescription>Control how the AI agent behaves and manages resources.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 space-y-8">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <Label className="text-base">Max Tool Runs</Label>
                        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">{localMaxRuns}</span>
                    </div>
                    <Slider 
                        value={[localMaxRuns]} 
                        min={1} 
                        max={50} 
                        step={1} 
                        onValueChange={(vals) => setLocalMaxRuns(vals[0])} 
                    />
                    <p className="text-sm text-muted-foreground">Limits the number of steps the agent can take to solve a problem.</p>
                </div>

                <Separator />

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <Label className="text-base">Max Memories</Label>
                        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">{localMaxMemories}</span>
                    </div>
                    <Slider 
                        value={[localMaxMemories]} 
                        min={1} 
                        max={20} 
                        step={1} 
                        onValueChange={(vals) => setLocalMaxMemories(vals[0])} 
                    />
                    <p className="text-sm text-muted-foreground">Number of relevant memories to retrieve for each interaction.</p>
                </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-none bg-transparent p-0">
            <CardHeader className="px-0">
              <CardTitle>Tools & Capabilities</CardTitle>
              <CardDescription>Enable or disable specific tools available to the agent.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tools.map(tool => (
                        <div key={tool.name} className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                            <Switch
                                checked={localEnabledTools.has(tool.name)}
                                onCheckedChange={() => handleToggleTool(tool.name)}
                                className="mt-1"
                            />
                            <div className="space-y-1">
                                <Label className="text-base font-medium">{tool.name}</Label>
                                <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </SidebarInset>
  )
}
