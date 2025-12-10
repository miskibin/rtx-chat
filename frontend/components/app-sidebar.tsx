"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Trash2Icon, DatabaseIcon, MessageSquareIcon, SettingsIcon } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { ModeToggle } from "@/components/mode-toggle"

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
      <SidebarHeader className="p-4 flex flex-row items-center justify-between">
        <Image src="/logo.png" alt="Logo" width={32} height={32} className="w-8 h-8" />
        <ModeToggle />
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
