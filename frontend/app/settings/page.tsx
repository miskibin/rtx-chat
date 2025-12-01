"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { SettingsIcon, WrenchIcon, SaveIcon } from "lucide-react"
import { useChatStore } from "@/lib/store"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolInfo = { name: string; description: string }

export default function SettingsPage() {
  const { settings, setSettings } = useChatStore()
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [localMaxRuns, setLocalMaxRuns] = useState(settings.maxToolRuns)
  const [localEnabledTools, setLocalEnabledTools] = useState<Set<string>>(new Set(settings.enabledTools))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/tools`).then(r => r.json()).then(d => {
      setTools(d.tools || [])
      if (settings.enabledTools.length === 0) {
        setLocalEnabledTools(new Set(d.tools.map((t: ToolInfo) => t.name)))
      }
    })
  }, [settings.enabledTools.length])

  const handleToggleTool = (name: string) => {
    setLocalEnabledTools(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSave = () => {
    setSettings({ maxToolRuns: localMaxRuns, enabledTools: Array.from(localEnabledTools) })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const allEnabled = tools.length > 0 && localEnabledTools.size === tools.length

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <SidebarTrigger />
        <SettingsIcon className="size-4" />
        <span className="text-sm font-medium">Settings</span>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-xl space-y-6">
          <div className="space-y-2">
            <Label htmlFor="max-runs">Max Tool Runs</Label>
            <p className="text-xs text-muted-foreground">Maximum number of tool executions per message (1-50)</p>
            <Input
              id="max-runs"
              type="number"
              min={1}
              max={50}
              value={localMaxRuns}
              onChange={e => setLocalMaxRuns(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              className="w-32"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Enabled Tools</Label>
                <p className="text-xs text-muted-foreground">Select which tools the agent can use</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLocalEnabledTools(allEnabled ? new Set() : new Set(tools.map(t => t.name)))}>
                {allEnabled ? "Disable All" : "Enable All"}
              </Button>
            </div>
            
            <div className="space-y-2 rounded-lg border p-3">
              {tools.map(tool => (
                <div key={tool.name} className="flex items-start gap-3 py-2 border-b last:border-0">
                  <Switch
                    checked={localEnabledTools.has(tool.name)}
                    onCheckedChange={() => handleToggleTool(tool.name)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <WrenchIcon className="size-3 text-muted-foreground" />
                      <span className="text-sm font-medium">{tool.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleSave} className="w-full">
            <SaveIcon className="size-4 mr-2" />
            {saved ? "Saved!" : "Save Settings"}
          </Button>
        </div>
      </div>
    </SidebarInset>
  )
}
