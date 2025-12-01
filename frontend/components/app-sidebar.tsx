"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Trash2Icon, DatabaseIcon, MessageSquareIcon, HeartIcon, SettingsIcon } from "lucide-react"
import { useChatStore } from "@/lib/store"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export function AppSidebar() {
  const pathname = usePathname()
  const { clearMessages } = useChatStore()

  const handleClear = async () => {
    await fetch(`${API_URL}/chat/clear`, { method: "POST" })
    clearMessages()
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
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/psych-memories"}>
                  <Link href="/psych-memories"><HeartIcon className="size-4" /> Psych Memories</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/settings"}>
                  <Link href="/settings"><SettingsIcon className="size-4" /> Settings</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
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
