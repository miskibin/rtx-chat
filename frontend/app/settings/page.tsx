"use client"

import { useEffect, useRef, useState } from "react"
import { BrainIcon, MessageSquareIcon, SlidersHorizontalIcon } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { SidebarInset } from "@/components/ui/sidebar"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { useChatStore } from "@/lib/store"

export default function SettingsPage() {
  const { titleGeneration, setTitleGeneration, autoSave, setAutoSave, globalSettings, fetchGlobalSettings, updateGlobalSettings } =
    useChatStore(
      useShallow((s) => ({
        titleGeneration: s.titleGeneration,
        setTitleGeneration: s.setTitleGeneration,
        autoSave: s.autoSave,
        setAutoSave: s.setAutoSave,
        globalSettings: s.globalSettings,
        fetchGlobalSettings: s.fetchGlobalSettings,
        updateGlobalSettings: s.updateGlobalSettings,
      }))
    )

  // Keep General tab fast: only fetch what it uses.
  useEffect(() => {
    fetchGlobalSettings()
  }, [fetchGlobalSettings])

  // Debounced slider updates to avoid spamming network/store writes.
  const [memoryPreview, setMemoryPreview] = useState<number | null>(null)
  const [knowledgePreview, setKnowledgePreview] = useState<number | null>(null)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const knowledgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (memoryTimerRef.current) clearTimeout(memoryTimerRef.current)
      if (knowledgeTimerRef.current) clearTimeout(knowledgeTimerRef.current)
    }
  }, [])

  const memoryValue = memoryPreview ?? globalSettings.memory_min_similarity
  const knowledgeValue = knowledgePreview ?? globalSettings.knowledge_min_similarity

  return (
    <SidebarInset className="flex flex-col h-screen bg-background">
      <PageHeader title="Settings" />

      <Tabs value="general" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6">
          <TabsList className="h-11 mt-2">
            <TabsTrigger value="general" className="gap-2">
              <SlidersHorizontalIcon className="size-4" />
              General
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="flex-1 overflow-auto mt-0 p-6">
          <div className="mx-auto max-w-2xl space-y-6">
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
                    <p className="text-xs text-muted-foreground">Automatically save conversations as you chat</p>
                  </div>
                  <Switch checked={autoSave} onCheckedChange={setAutoSave} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>AI-generated titles</Label>
                    <p className="text-xs text-muted-foreground">Use the LLM to generate conversation titles</p>
                  </div>
                  <Switch checked={titleGeneration} onCheckedChange={setTitleGeneration} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-violet-500/10">
                    <BrainIcon className="size-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Retrieval Thresholds</CardTitle>
                    <CardDescription>
                      Minimum similarity scores for memory and knowledge retrieval (applies to all agents)
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Memory similarity</Label>
                    <span className="text-sm font-mono text-muted-foreground">{memoryValue.toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[memoryValue]}
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    onValueChange={([v]) => {
                      setMemoryPreview(v)
                      if (memoryTimerRef.current) clearTimeout(memoryTimerRef.current)
                      memoryTimerRef.current = setTimeout(() => {
                        updateGlobalSettings({ memory_min_similarity: v }).finally(() => setMemoryPreview(null))
                      }, 300)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower values retrieve more memories but may include less relevant results
                  </p>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Knowledge similarity</Label>
                    <span className="text-sm font-mono text-muted-foreground">{knowledgeValue.toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[knowledgeValue]}
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    onValueChange={([v]) => {
                      setKnowledgePreview(v)
                      if (knowledgeTimerRef.current) clearTimeout(knowledgeTimerRef.current)
                      knowledgeTimerRef.current = setTimeout(() => {
                        updateGlobalSettings({ knowledge_min_similarity: v }).finally(() => setKnowledgePreview(null))
                      }, 300)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower values retrieve more knowledge chunks but may include less relevant content
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
    </SidebarInset>
  )
}
