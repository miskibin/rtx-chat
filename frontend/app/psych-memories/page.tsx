"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchIcon, Trash2Icon, HeartIcon, SparklesIcon } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type Memory = { id: string; memory: string }

const parseMemoryType = (mem: string): string => {
  const match = mem.match(/^\[(\w+)\]/)
  return match ? match[1] : "general"
}

const VALID_EMOTIONS = new Set([
  "anxiety", "fear", "sadness", "anger", "joy", "happiness", "frustration", "overwhelm", "overwhelmed",
  "stress", "stressed", "loneliness", "lonely", "hope", "hopeful", "excitement", "excited", "guilt", "guilty",
  "shame", "relief", "relieved", "love", "hate", "jealousy", "jealous", "envy", "pride", "proud",
  "disgust", "surprise", "confused", "confusion", "nervous", "worried", "worry", "panic", "despair",
  "grief", "sorrow", "resentment", "betrayed", "betrayal", "hurt", "pain", "emptiness", "empty",
  "numb", "depressed", "depression", "anxious", "scared", "terrified", "hopeless", "helpless",
  "insecure", "insecurity", "vulnerable", "ashamed", "regret", "disappointment", "disappointed",
  "irritated", "annoyed", "bitter", "content", "peaceful", "calm", "grateful", "thankful"
])

const extractEmotions = (mem: string): string[] => {
  const words = mem.toLowerCase().split(/[\s,.:;!?()[\]]+/)
  return words.filter(w => VALID_EMOTIONS.has(w))
}

const getTypeStyle = (type: string) => {
  const styles: Record<string, string> = {
    event: "border-l-blue-500 bg-blue-500/5",
    emotion: "border-l-pink-500 bg-pink-500/5",
    belief: "border-l-purple-500 bg-purple-500/5",
    preference: "border-l-green-500 bg-green-500/5",
    goal: "border-l-amber-500 bg-amber-500/5",
    challenge: "border-l-red-500 bg-red-500/5",
    general: "border-l-gray-500 bg-gray-500/5",
  }
  return styles[type] || styles.general
}

const getBadgeStyle = (type: string) => {
  const styles: Record<string, string> = {
    event: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    emotion: "bg-pink-500/10 text-pink-600 border-pink-500/20",
    belief: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    preference: "bg-green-500/10 text-green-600 border-green-500/20",
    goal: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    challenge: "bg-red-500/10 text-red-600 border-red-500/20",
    general: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  }
  return styles[type] || styles.general
}

const formatMemoryContent = (mem: string) => {
  const withoutType = mem.replace(/^\[\w+\]\s*/, "")
  
  const parts: { label: string; value: string }[] = []
  
  // Match dates at start like "2025-12-01:" or "2025-02:" or "Feb 2025:"
  const dateMatch = withoutType.match(/^(\d{4}-\d{2}(?:-\d{2})?)[:\s]|^([A-Z][a-z]{2}\s+\d{4})[:\s]/i)
  if (dateMatch) parts.push({ label: "Date", value: dateMatch[1] || dateMatch[2] })
  
  // Also match inline dates
  const inlineDateMatch = withoutType.match(/(?:Date|on|dated?)[:.]?\s*(\d{4}-\d{2}-\d{2})/i)
  if (inlineDateMatch && !dateMatch) parts.push({ label: "Date", value: inlineDateMatch[1] })
  
  const emotionsMatch = withoutType.match(/Emotions?[:.]?\s*([^.]+?)(?:\.|Triggered|Context|$)/i)
  if (emotionsMatch) parts.push({ label: "Emotions", value: emotionsMatch[1].trim() })
  
  const triggeredMatch = withoutType.match(/Triggered by[:.]?\s*([^.]+)/i)
  if (triggeredMatch) parts.push({ label: "Trigger", value: triggeredMatch[1].trim() })
  
  const contextMatch = withoutType.match(/Context[:.]?\s*([^.]+)/i)
  if (contextMatch) parts.push({ label: "Context", value: contextMatch[1].trim() })
  
  const mainText = withoutType
    .replace(/^\d{4}-\d{2}(?:-\d{2})?[:\s]/i, "")
    .replace(/^[A-Z][a-z]{2}\s+\d{4}[:\s]/i, "")
    .replace(/(?:Date|on|dated?)[:.]?\s*\d{4}-\d{2}-\d{2}/gi, "")
    .replace(/Emotions?[:.]?\s*[^.]+/i, "")
    .replace(/Triggered by[:.]?\s*[^.]+/i, "")
    .replace(/Context[:.]?\s*[^.]+/i, "")
    .replace(/\s+/g, " ")
    .trim()
  
  return { mainText, parts }
}

function MemoryCard({ mem, onDelete }: { mem: Memory; onDelete: () => void }) {
  const type = parseMemoryType(mem.memory)
  const { mainText, parts } = formatMemoryContent(mem.memory)
  
  return (
    <div className={`border-l-4 rounded-r-lg p-4 ${getTypeStyle(type)}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <Badge variant="outline" className={`text-xs ${getBadgeStyle(type)}`}>
          {type}
        </Badge>
        <Button size="icon" variant="ghost" className="size-6 opacity-50 hover:opacity-100" onClick={onDelete}>
          <Trash2Icon className="size-3" />
        </Button>
      </div>
      
      {mainText && <p className="text-sm mb-2">{mainText}</p>}
      
      {parts.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {parts.map((p, i) => (
            <span key={i}>
              <span className="font-medium">{p.label}:</span> {p.value}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PsychMemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState("all")

  const loadMemories = async (q?: string) => {
    const url = q ? `${API_URL}/memories/search?q=${encodeURIComponent(q)}` : `${API_URL}/memories`
    const r = await fetch(url)
    const d = await r.json()
    setMemories(d.memories || [])
  }

  useEffect(() => { 
    const load = async () => {
      const r = await fetch(`${API_URL}/memories`)
      const d = await r.json()
      setMemories(d.memories || [])
    }
    load()
  }, [])

  const handleDelete = async (id: string) => {
    await fetch(`${API_URL}/memories/${id}`, { method: "DELETE" })
    loadMemories(search)
  }

  const getMemoriesByType = (type: string) => {
    if (type === "all") return memories
    return memories.filter(m => parseMemoryType(m.memory) === type)
  }

  const types = ["all", "emotion", "event", "belief", "goal", "challenge", "preference", "general"]
  const counts = Object.fromEntries(types.map(t => [t, t === "all" ? memories.length : getMemoriesByType(t).length]))

  const allEmotions = memories.flatMap(m => extractEmotions(m.memory))
  const emotionCounts = allEmotions.reduce((acc, e) => ({ ...acc, [e]: (acc[e] || 0) + 1 }), {} as Record<string, number>)
  const topEmotions = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const emotionColors: Record<string, string> = {
    anxiety: "bg-orange-500", fear: "bg-purple-500", sadness: "bg-blue-500", anger: "bg-red-500",
    joy: "bg-yellow-400", happiness: "bg-green-400", frustration: "bg-orange-400", overwhelm: "bg-red-400",
    stress: "bg-amber-500", loneliness: "bg-indigo-400", hope: "bg-emerald-400", excitement: "bg-pink-400",
    guilt: "bg-gray-500", shame: "bg-stone-500", relief: "bg-teal-400"
  }

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <SidebarTrigger />
        <HeartIcon className="size-4 text-pink-500" />
        <span className="text-sm font-medium">Psychological Memories</span>
        <span className="text-xs text-muted-foreground ml-auto">{memories.length} memories</span>
      </header>
      
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {topEmotions.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <SparklesIcon className="size-3" />
                <span>Emotional landscape</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {topEmotions.map(([emotion, count]) => (
                  <div key={emotion} className="flex items-center gap-1.5">
                    <div className={`size-2 rounded-full ${emotionColors[emotion] || "bg-gray-400"}`} />
                    <span className="text-xs">{emotion}</span>
                    <span className="text-xs text-muted-foreground">({count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Input 
              placeholder="Search memories..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              onKeyDown={e => e.key === "Enter" && loadMemories(search)}
              className="flex-1" 
            />
            <Button variant="outline" size="icon" onClick={() => loadMemories(search)}>
              <SearchIcon className="size-4" />
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start overflow-x-auto">
              {types.map(t => (
                <TabsTrigger key={t} value={t} className="text-xs capitalize">
                  {t} {counts[t] > 0 && <span className="ml-1 opacity-50">({counts[t]})</span>}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={activeTab} className="mt-4 space-y-3">
              {getMemoriesByType(activeTab).length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">No memories</p>
              ) : (
                getMemoriesByType(activeTab).map(mem => (
                  <MemoryCard key={mem.id} mem={mem} onDelete={() => handleDelete(mem.id)} />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </SidebarInset>
  )
}
