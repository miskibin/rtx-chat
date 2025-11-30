"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Trash2Icon, DatabaseIcon, MessageSquareIcon } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type Model = { name: string }

export function AppSidebar() {
  const pathname = usePathname()
  const [models, setModels] = useState<Model[]>([])
  const [memoryModel, setMemoryModel] = useState("qwen3:1.7b")

  useEffect(() => {
    fetch(`${API_URL}/models`).then(r => r.json()).then(d => setModels(d.models || []))
    fetch(`${API_URL}/chat/settings`).then(r => r.json()).then(d => setMemoryModel(d.memory_model))
  }, [])

  const handleMemoryModelChange = async (model: string) => {
    setMemoryModel(model)
    await fetch(`${API_URL}/chat/settings?memory_model=${model}`, { method: "POST" })
  }

  const handleClear = async () => {
    await fetch(`${API_URL}/chat/clear`, { method: "POST" })
    window.location.reload()
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <h1 className="text-lg font-semibold">Ollama Chat</h1>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"}>
                  <Link href="/"><MessageSquareIcon className="size-4" /> Chat</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/memories"}>
                  <Link href="/memories"><DatabaseIcon className="size-4" /> Memories</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Memory Model</label>
              <Select value={memoryModel} onValueChange={handleMemoryModelChange}>
                <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map(m => <SelectItem key={m.name} value={m.name} className="text-xs">{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleClear}>
          <Trash2Icon className="size-4 mr-2" /> Clear Chat
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
