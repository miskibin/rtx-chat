"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { SearchIcon, PencilIcon, Trash2Icon, XIcon, SaveIcon } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type Memory = { id: string; memory: string }

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [search, setSearch] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")

  const loadMemories = async (q?: string) => {
    const url = q ? `${API_URL}/memories/search?q=${encodeURIComponent(q)}` : `${API_URL}/memories`
    const r = await fetch(url)
    const d = await r.json()
    setMemories(d.memories || [])
  }

  useEffect(() => {
    const url = `${API_URL}/memories`
    fetch(url).then(r => r.json()).then(d => setMemories(d.memories || []))
  }, [])

  const handleDelete = async (id: string) => {
    await fetch(`${API_URL}/memories/${id}`, { method: "DELETE" })
    loadMemories(search)
  }

  const handleUpdate = async (id: string) => {
    await fetch(`${API_URL}/memories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: editText }) })
    setEditingId(null)
    loadMemories(search)
  }

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <SidebarTrigger />
        <span className="text-sm font-medium">Memories</span>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Search memories..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />
            <Button variant="outline" size="icon" onClick={() => loadMemories(search)}><SearchIcon className="size-4" /></Button>
          </div>
          <div className="space-y-2">
            {memories.length === 0 && <p className="text-center text-muted-foreground py-8">No memories</p>}
            {memories.map(m => (
              <div key={m.id} className="flex items-start gap-2 rounded-lg border p-3">
                {editingId === m.id ? (
                  <div className="flex-1 flex gap-2">
                    <Input value={editText} onChange={e => setEditText(e.target.value)} className="flex-1" />
                    <Button size="icon" variant="ghost" onClick={() => handleUpdate(m.id)}><SaveIcon className="size-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><XIcon className="size-4" /></Button>
                  </div>
                ) : (
                  <>
                    <p className="flex-1 text-sm">{m.memory}</p>
                    <Button size="icon" variant="ghost" onClick={() => { setEditingId(m.id); setEditText(m.memory) }}><PencilIcon className="size-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(m.id)}><Trash2Icon className="size-4" /></Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}
