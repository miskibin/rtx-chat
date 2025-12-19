"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { useEffect } from "react"
import { Sidebar, SidebarContent, SidebarHeader, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2Icon, MessageSquareIcon, SettingsIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { useChatStore, ConversationMeta, MessageType } from "@/lib/store"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { 
    conversations, 
    currentConversationId, 
    loadConversation,
    startNewConversation,
    fetchConversationsIfStale,
    invalidateCache,
  } = useChatStore()

  useEffect(() => {
    fetchConversationsIfStale()
  }, [fetchConversationsIfStale])

  const handleNewChat = async () => {
    await fetch(`${API_URL}/chat/clear`, { method: "POST" })
    startNewConversation()
    router.push("/")
  }

  const handleSelectConversation = async (conv: ConversationMeta) => {
    if (conv.id === currentConversationId) return
    try {
      const res = await fetch(`${API_URL}/conversations/${conv.id}`)
      const data = await res.json()
      const messages: MessageType[] = JSON.parse(data.messages || "[]")
      loadConversation(conv.id, messages, data.agent, data.model)
      router.push("/")
    } catch (e) {
      console.error("Failed to load conversation:", e)
    }
  }

  const handleDeleteConversation = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation()
    try {
      await fetch(`${API_URL}/conversations/${convId}`, { method: "DELETE" })
      if (convId === currentConversationId) {
        startNewConversation()
      }
      invalidateCache("conversations")
      fetchConversationsIfStale()
    } catch (e) {
      console.error("Failed to delete conversation:", e)
    }
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Image src="/logo.png" alt="Logo" width={32} height={32} className="w-8 h-8" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={handleNewChat}>
                  <PlusIcon className="size-4" /> New Chat
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"}>
                  <Link href="/"><MessageSquareIcon className="size-4" /> Chat</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/agents" || pathname.startsWith("/agents/")}>
                  <Link href="/agents"><SparklesIcon className="size-4" /> Agents</Link>
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

        <SidebarGroup className="flex-1">
          <SidebarGroupLabel>History</SidebarGroupLabel>
          <SidebarGroupContent className="flex-1">
            <ScrollArea className="h-[calc(100vh-320px)]">
              <div className="space-y-1 pr-2">
                {conversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-4">No conversations yet</p>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv)}
                      className={`group/item flex items-center gap-1.5 px-2 py-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent ${
                        conv.id === currentConversationId ? "bg-accent" : ""
                      }`}
                    >
                      <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <p className="truncate font-medium text-xs">{conv.title || "Untitled"}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(conv.updated_at)}</p>
                      </div>
                      <button
                        className="size-7 flex items-center justify-center rounded opacity-0 group-hover/item:opacity-100 hover:bg-destructive/10 transition-all shrink-0"
                        onClick={(e) => handleDeleteConversation(e, conv.id)}
                      >
                        <Trash2Icon className="size-4 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
