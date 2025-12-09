"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Trash2Icon, RefreshCwIcon, UsersIcon, CalendarIcon, LightbulbIcon, SettingsIcon, SearchIcon, PencilIcon } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type MemoryType = "Person" | "Event" | "Fact" | "Preference"
type Memory = { id: string; type: MemoryType; content: string }
type Person = { id: string; name: string; description: string; relation: string; sentiment: string }
type Event = { id: string; description: string; date: string; participants: string[] }

const typeConfig: Record<MemoryType, { icon: React.ReactNode; color: string }> = {
  Person: { icon: <UsersIcon className="size-3.5" />, color: "text-violet-500 bg-violet-500/10" },
  Event: { icon: <CalendarIcon className="size-3.5" />, color: "text-amber-500 bg-amber-500/10" },
  Fact: { icon: <LightbulbIcon className="size-3.5" />, color: "text-sky-500 bg-sky-500/10" },
  Preference: { icon: <SettingsIcon className="size-3.5" />, color: "text-emerald-500 bg-emerald-500/10" },
}

export default function MemoriesPage() {
  const [activeFilter, setActiveFilter] = useState<MemoryType | "all">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [memories, setMemories] = useState<Memory[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [editItem, setEditItem] = useState<Person | Event | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})

  const loadAll = async () => {
    setIsLoading(true)
    const [memRes, pplRes, evtRes] = await Promise.all([
      fetch(`${API_URL}/memories?limit=100`),
      fetch(`${API_URL}/memories/people`),
      fetch(`${API_URL}/memories/events`)
    ])
    setMemories((await memRes.json()).memories || [])
    setPeople((await pplRes.json()).people || [])
    setEvents((await evtRes.json()).events || [])
    setIsLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this memory?")) return
    await fetch(`${API_URL}/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
    loadAll()
  }

  const handleEditClick = (item: Person | Event) => {
    setEditItem(item)
    if ("name" in item) setEditForm({ description: item.description, relation_type: item.relation, sentiment: item.sentiment })
    else setEditForm({ description: item.description, date: item.date })
    setIsEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editItem) return
    if ("name" in editItem) {
      await fetch(`${API_URL}/memories/people/${editItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: editForm.description }) })
      if (editForm.relation_type || editForm.sentiment) await fetch(`${API_URL}/memories/people/${editItem.id}/relationship`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relation_type: editForm.relation_type, sentiment: editForm.sentiment }) })
    } else {
      await fetch(`${API_URL}/memories/events/${editItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) })
    }
    setIsEditDialogOpen(false)
    loadAll()
  }

  const allItems = [
    ...people.map(p => ({ id: p.id, type: "Person" as MemoryType, data: p })),
    ...events.map(e => ({ id: e.id, type: "Event" as MemoryType, data: e })),
    ...memories.filter(m => m.type === "Fact" || m.type === "Preference").map(m => ({ id: m.id, type: m.type, data: m })),
  ]

  const filteredItems = allItems.filter(item => {
    if (activeFilter !== "all" && item.type !== activeFilter) return false
    const searchLower = searchQuery.toLowerCase()
    if (item.type === "Person") {
      const p = item.data as Person
      return p.name.toLowerCase().includes(searchLower) || p.description?.toLowerCase().includes(searchLower)
    }
    if (item.type === "Event") return (item.data as Event).description.toLowerCase().includes(searchLower)
    return (item.data as Memory).content.toLowerCase().includes(searchLower)
  })

  const counts = { all: allItems.length, Person: people.length, Event: events.length, Fact: memories.filter(m => m.type === "Fact").length, Preference: memories.filter(m => m.type === "Preference").length }

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-3 border-b px-4 py-2 shrink-0">
        <SidebarTrigger />
        <span className="text-sm font-medium">Memories</span>
        <span className="text-xs text-muted-foreground">({counts.all})</span>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={loadAll} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative flex-1 max-w-xs">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <div className="flex gap-0.5">
          {(["all", "Person", "Event", "Fact", "Preference"] as const).map((f) => (
            <Button key={f} size="sm" variant={activeFilter === f ? "secondary" : "ghost"} onClick={() => setActiveFilter(f)} className="h-8 text-xs px-2.5">
              {f === "all" ? "All" : f} <span className="ml-1 text-muted-foreground">{counts[f]}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="divide-y">
          {filteredItems.map((item) => (
            <div key={item.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
              <div className={`p-1.5 rounded ${typeConfig[item.type].color} shrink-0 mt-0.5`}>
                {typeConfig[item.type].icon}
              </div>
              <div className="flex-1 min-w-0">
                {item.type === "Person" && (() => {
                  const p = item.data as Person
                  return (
                    <>
                      <p className="font-medium text-sm">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>}
                      {(p.relation || p.sentiment) && (
                        <div className="flex gap-1.5 mt-1.5">
                          {p.relation && <Badge variant="secondary" className="text-[10px] h-5">{p.relation}</Badge>}
                          {p.sentiment && <Badge variant="outline" className="text-[10px] h-5">{p.sentiment}</Badge>}
                        </div>
                      )}
                    </>
                  )
                })()}
                {item.type === "Event" && (() => {
                  const e = item.data as Event
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        {e.date && <span className="text-[10px] font-mono text-muted-foreground">{e.date}</span>}
                      </div>
                      <p className="text-sm mt-0.5 line-clamp-2">{e.description}</p>
                      {e.participants?.filter(Boolean).length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {e.participants.filter(Boolean).map((p, i) => <Badge key={i} variant="outline" className="text-[10px] h-5">{p}</Badge>)}
                        </div>
                      )}
                    </>
                  )
                })()}
                {(item.type === "Fact" || item.type === "Preference") && (
                  <p className="text-sm line-clamp-2">{(item.data as Memory).content}</p>
                )}
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {(item.type === "Person" || item.type === "Event") && (
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => handleEditClick(item.data as Person | Event)}>
                    <PencilIcon className="size-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(item.id)}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {filteredItems.length === 0 && <p className="text-center text-muted-foreground text-sm py-12">No memories found</p>}
        </div>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit {editItem && "name" in editItem ? "Person" : "Event"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {editItem && "name" in editItem ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input disabled value={editItem.name} className="h-8" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Relation</Label>
                    <Input placeholder="friend" value={editForm.relation_type} onChange={(e) => setEditForm({ ...editForm, relation_type: e.target.value })} className="h-8" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Sentiment</Label>
                    <Select value={editForm.sentiment} onValueChange={(val) => setEditForm({ ...editForm, sentiment: val })}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {["positive", "neutral", "negative", "complicated"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : editItem ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} className="h-8" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea rows={4} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="text-sm" />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarInset>
  )
}
