"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Trash2Icon, RefreshCwIcon, UsersIcon, CalendarIcon, LightbulbIcon, SettingsIcon, PencilIcon, AlertTriangleIcon } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, SortingState } from "@tanstack/react-table"
import { useReactTable } from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type MemoryType = "Person" | "Event" | "Fact" | "Preference"
type Memory = { id: string; type: MemoryType; content: string }
type Person = { id: string; name: string; description: string; relation: string; sentiment: string }
type Event = { id: string; description: string; date: string; participants: string[] }
type Duplicate = { id1: string; id2: string; content1: string; content2: string; score: number; type: string }
type TableItem = { id: string; type: MemoryType; content: string; extra?: string; data: Person | Event | Memory }

const typeConfig: Record<MemoryType, { icon: React.ReactNode; color: string }> = {
  Person: { icon: <UsersIcon className="size-3.5" />, color: "text-violet-500 bg-violet-500/10" },
  Event: { icon: <CalendarIcon className="size-3.5" />, color: "text-amber-500 bg-amber-500/10" },
  Fact: { icon: <LightbulbIcon className="size-3.5" />, color: "text-sky-500 bg-sky-500/10" },
  Preference: { icon: <SettingsIcon className="size-3.5" />, color: "text-emerald-500 bg-emerald-500/10" },
}

export default function MemoriesPage() {
  const [globalFilter, setGlobalFilter] = useState("")
  const [activeFilter, setActiveFilter] = useState<MemoryType | "all">("all")
  const [sorting, setSorting] = useState<SortingState>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [editItem, setEditItem] = useState<Person | Event | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    const [memRes, pplRes, evtRes, dupRes] = await Promise.all([
      fetch(`${API_URL}/memories?limit=100`),
      fetch(`${API_URL}/memories/people`),
      fetch(`${API_URL}/memories/events`),
      fetch(`${API_URL}/memories/duplicates?threshold=0.90&limit=5`)
    ])
    setMemories((await memRes.json()).memories || [])
    setPeople((await pplRes.json()).people || [])
    setEvents((await evtRes.json()).events || [])
    setDuplicates((await dupRes.json()).duplicates || [])
    setIsLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

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

  const allItems: TableItem[] = useMemo(() => [
    ...people.map(p => ({ id: p.id, type: "Person" as MemoryType, content: p.name, extra: p.description, data: p })),
    ...events.map(e => ({ id: e.id, type: "Event" as MemoryType, content: e.description, extra: e.date, data: e })),
    ...memories.filter(m => m.type === "Fact" || m.type === "Preference").map(m => ({ id: m.id, type: m.type, content: m.content, data: m })),
  ], [people, events, memories])

  const filteredByType = useMemo(() => 
    activeFilter === "all" ? allItems : allItems.filter(item => item.type === activeFilter)
  , [allItems, activeFilter])

  const counts = useMemo(() => ({ 
    all: allItems.length, 
    Person: people.length, 
    Event: events.length, 
    Fact: memories.filter(m => m.type === "Fact").length, 
    Preference: memories.filter(m => m.type === "Preference").length 
  }), [allItems, people, events, memories])

  const columns: ColumnDef<TableItem>[] = [
    {
      accessorKey: "type",
      header: ({ column }) => (
        <Button variant="ghost" className="-ml-4 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Type
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${typeConfig[row.original.type].color}`}>
          {typeConfig[row.original.type].icon}
          {row.original.type}
        </div>
      ),
    },
    {
      accessorKey: "content",
      header: ({ column }) => (
        <Button variant="ghost" className="-ml-4 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Content
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const item = row.original
        if (item.type === "Person") {
          const p = item.data as Person
          return (
            <div className="max-w-md" style={{ whiteSpace: "normal" }}>
              <p className="font-medium">{p.name}</p>
              {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
            </div>
          )
        }
        if (item.type === "Event") {
          const e = item.data as Event
          return (
            <div className="max-w-md" style={{ whiteSpace: "normal" }}>
              <p>{e.description}</p>
              {e.date && <p className="text-xs text-muted-foreground font-mono">{e.date}</p>}
            </div>
          )
        }
        return <p className="max-w-md" style={{ whiteSpace: "normal" }}>{item.content}</p>
      },
    },
    {
      accessorKey: "extra",
      header: "Details",
      cell: ({ row }) => {
        const item = row.original
        if (item.type === "Person") {
          const p = item.data as Person
          return (
            <div className="flex gap-1 flex-wrap">
              {p.relation && <Badge variant="secondary" className="text-[10px]">{p.relation}</Badge>}
              {p.sentiment && <Badge variant="outline" className="text-[10px]">{p.sentiment}</Badge>}
            </div>
          )
        }
        if (item.type === "Event") {
          const e = item.data as Event
          return e.participants?.filter(Boolean).length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {e.participants.filter(Boolean).slice(0, 3).map((p, i) => <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>)}
              {e.participants.filter(Boolean).length > 3 && <Badge variant="outline" className="text-[10px]">+{e.participants.filter(Boolean).length - 3}</Badge>}
            </div>
          ) : null
        }
        return null
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-1 justify-end">
          {(row.original.type === "Person" || row.original.type === "Event") && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => handleEditClick(row.original.data as Person | Event)}>
              <PencilIcon className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(row.original.id)}>
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: filteredByType,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageSize: 20 } },
  })

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
        <Input placeholder="Search..." value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="h-8 text-sm max-w-xs" />
        <div className="flex gap-0.5">
          {(["all", "Person", "Event", "Fact", "Preference"] as const).map((f) => (
            <Button key={f} size="sm" variant={activeFilter === f ? "secondary" : "ghost"} onClick={() => setActiveFilter(f)} className="h-8 text-xs px-2.5">
              {f === "all" ? "All" : f} <span className="ml-1 text-muted-foreground">{counts[f]}</span>
            </Button>
          ))}
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="p-4 border-b bg-amber-500/5">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <AlertTriangleIcon className="size-4" />
            <span className="text-sm font-medium">Potential duplicates found ({duplicates.length})</span>
          </div>
          <div className="space-y-2">
            {duplicates.map((dup, i) => (
              <Alert key={i} className="bg-background">
                <AlertDescription className="flex items-center gap-2">
                  <div className="flex-1 grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-muted rounded flex items-start gap-2">
                      <div className="flex-1">
                        <Badge variant="outline" className="text-[10px] mb-1">{dup.type}</Badge>
                        <p className="line-clamp-2">{dup.content1}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDelete(dup.id1)}>
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                    <div className="p-2 bg-muted rounded flex items-start gap-2">
                      <div className="flex-1">
                        <Badge variant="outline" className="text-[10px] mb-1">{dup.type}</Badge>
                        <p className="line-clamp-2">{dup.content2}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDelete(dup.id2)}>
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 w-10 text-center">{Math.round(dup.score * 100)}%</span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">No memories found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between py-4">
          <span className="text-sm text-muted-foreground">
            {table.getFilteredRowModel().rows.length} memories
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
          </div>
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
