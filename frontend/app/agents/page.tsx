"use client"

import dynamic from "next/dynamic"
import { SparklesIcon } from "lucide-react"

import { SidebarInset } from "@/components/ui/sidebar"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { useChatStore } from "@/lib/store"

const AgentsTab = dynamic(() => import("../settings/_components/AgentsTab").then((m) => m.AgentsTab), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-muted-foreground">Loading agents…</div>,
})

export default function AgentsPage() {
  const agentsCount = useChatStore((s) => s.availableAgents.length)

  return (
    <SidebarInset className="flex flex-col h-screen bg-background">
      <PageHeader title="Agents" badge={agentsCount} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="border-b px-6 py-2 flex items-center gap-2 text-sm text-muted-foreground">
          <SparklesIcon className="size-4" />
          <span>Configure how each agent behaves, which tools it can use, its knowledge base, and memories.</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {agentsCount} agents
          </Badge>
        </div>
        <div className="flex-1 overflow-hidden">
          <AgentsTab />
        </div>
      </div>
    </SidebarInset>
  )
}



