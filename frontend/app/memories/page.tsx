"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Trash2Icon, DatabaseIcon, ArrowUpDown, PencilIcon, UsersIcon, CalendarIcon, ActivityIcon } from "lucide-react"
import { ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, SortingState, useReactTable, ColumnFiltersState } from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// --- Types ---

type MemoryType = "Person" | "Event" | "Fact" | "Preference"

type Memory = { 
  id: string
  type: MemoryType
  content: string
}

type Person = {
  id: string
  name: string
  description: string
  relation: string
  sentiment: string
}

type Event = {
  id: string
  description: string
  date: string
  participants: string[]
}

// --- Helpers ---

const getTypeColor = (type: MemoryType) => {
  const colors: Record<MemoryType, string> = {
    Person: "bg-amber-100 text-amber-800 border-amber-300",
    Event: "bg-orange-100 text-orange-800 border-orange-300",
    Fact: "bg-blue-100 text-blue-800 border-blue-300",
    Preference: "bg-green-100 text-green-800 border-green-300",
  }
  return colors[type] || "bg-gray-100 text-gray-800 border-gray-300"
}

const getSentimentColor = (sentiment: string) => {
    if (!sentiment) return "bg-gray-100 text-gray-600"
    const s = sentiment.toLowerCase()
    if (s.includes("positive")) return "bg-green-100 text-green-700 border-green-200"
    if (s.includes("negative")) return "bg-red-100 text-red-700 border-red-200"
    if (s.includes("neutral")) return "bg-slate-100 text-slate-700 border-slate-200"
    return "bg-purple-100 text-purple-700 border-purple-200" // complicated/mixed
}

// --- Main Component ---

export default function MemoriesPage() {
  const [activeTab, setActiveTab] = useState("all")
  
  // Data States
  const [memories, setMemories] = useState<Memory[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Edit Dialog States
  const [editItem, setEditItem] = useState<Person | Event | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})

  // --- Fetching ---

  const loadAll = async () => {
    setIsLoading(true)
    try {
        const [memRes, pplRes, evtRes] = await Promise.all([
            fetch(`${API_URL}/memories?limit=100`),
            fetch(`${API_URL}/memories/people`),
            fetch(`${API_URL}/memories/events`)
        ])
        const memData = await memRes.json()
        const pplData = await pplRes.json()
        const evtData = await evtRes.json()

        setMemories(memData.memories || [])
        setPeople(pplData.people || [])
        setEvents(evtData.events || [])
    } catch (e) {
        console.error("Failed to load data", e)
    } finally {
        setIsLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  // --- Actions ---

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this memory?")) return
    await fetch(`${API_URL}/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
    loadAll()
  }

  const handleEditClick = (item: Person | Event) => {
    setEditItem(item)
    // Pre-fill form based on type
    if ("name" in item) { // It's a Person
        setEditForm({ 
            description: item.description, 
            relation_type: item.relation, 
            sentiment: item.sentiment 
        })
    } else { // It's an Event
        setEditForm({ 
            description: item.description, 
            date: item.date 
        })
    }
    setIsEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editItem) return

    try {
        if ("name" in editItem) { 
            // Update Person
            // 1. Update Bio
            await fetch(`${API_URL}/memories/people/${editItem.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: editForm.description })
            })
            // 2. Update Relationship
            if (editForm.relation_type || editForm.sentiment) {
                await fetch(`${API_URL}/memories/people/${editItem.id}/relationship`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        relation_type: editForm.relation_type, 
                        sentiment: editForm.sentiment 
                    })
                })
            }
        } else {
            // Update Event
            await fetch(`${API_URL}/memories/events/${editItem.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editForm)
            })
        }
        setIsEditDialogOpen(false)
        loadAll()
    } catch (e) {
        console.error("Failed to save", e)
        alert("Failed to save changes")
    }
  }

  // --- Table Configurations ---

  // 1. All Memories Table Columns
  const memoryColumns = useMemo<ColumnDef<Memory>[]>(() => [
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline" className={getTypeColor(row.getValue("type"))}>{row.getValue("type")}</Badge>,
    },
    {
      accessorKey: "content",
      header: "Content",
      cell: ({ row }) => <p className="text-sm whitespace-normal">{row.getValue("content")}</p>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => handleDelete(row.original.id)}>
          <Trash2Icon className="size-4 text-muted-foreground hover:text-red-500" />
        </Button>
      ),
    },
  ], [])

  // 2. People Table Columns
  const peopleColumns = useMemo<ColumnDef<Person>[]>(() => [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>
    },
    {
        accessorKey: "description",
        header: "Bio",
        cell: ({ row }) => <p className="text-sm text-muted-foreground truncate max-w-[300px]">{row.getValue("description")}</p>
    },
    {
        accessorKey: "relation",
        header: "Relation",
        cell: ({ row }) => row.original.relation ? (
            <div className="flex flex-col gap-1">
                <Badge variant="secondary" className="w-fit">{row.original.relation}</Badge>
                <Badge variant="outline" className={`w-fit text-[10px] ${getSentimentColor(row.original.sentiment)}`}>
                    {row.original.sentiment}
                </Badge>
            </div>
        ) : <span className="text-muted-foreground text-xs">-</span>
    },
    {
        id: "actions",
        cell: ({ row }) => (
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEditClick(row.original)}>
                    <PencilIcon className="size-4 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(row.original.id)}>
                    <Trash2Icon className="size-4 text-muted-foreground hover:text-red-500" />
                </Button>
            </div>
        )
    }
  ], [])

  // 3. Events Table Columns
  const eventColumns = useMemo<ColumnDef<Event>[]>(() => [
    {
        accessorKey: "date",
        header: ({ column }) => (
            <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                Date <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => <span className="text-sm font-mono whitespace-nowrap">{row.getValue("date")}</span>
    },
    {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => <p className="text-sm whitespace-normal">{row.getValue("description")}</p>
    },
    {
        accessorKey: "participants",
        header: "Participants",
        cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
                {(row.getValue("participants") as string[]).map(p => (
                    <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                ))}
            </div>
        )
    },
    {
        id: "actions",
        cell: ({ row }) => (
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEditClick(row.original)}>
                    <PencilIcon className="size-4 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(row.original.id)}>
                    <Trash2Icon className="size-4 text-muted-foreground hover:text-red-500" />
                </Button>
            </div>
        )
    }
  ], [])

  return (
    <SidebarInset className="flex flex-col h-screen bg-background">
      <header className="flex items-center gap-2 border-b px-4 py-3 bg-card">
        <SidebarTrigger />
        <DatabaseIcon className="size-4 text-primary" />
        <span className="text-sm font-semibold">Knowledge Graph</span>
        <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadAll} disabled={isLoading}>
                {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
        </div>
      </header>
      
      <div className="flex-1 overflow-hidden p-6">
        <div className="mx-auto max-w-6xl h-full flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                    <TabsList>
                        <TabsTrigger value="all" className="flex items-center gap-2">
                            <ActivityIcon className="size-4" /> Overview
                        </TabsTrigger>
                        <TabsTrigger value="people" className="flex items-center gap-2">
                            <UsersIcon className="size-4" /> People
                        </TabsTrigger>
                        <TabsTrigger value="events" className="flex items-center gap-2">
                            <CalendarIcon className="size-4" /> Events
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-auto rounded-md border bg-card relative">
                    <TabsContent value="all" className="m-0 h-full absolute inset-0">
                        <DataTable columns={memoryColumns} data={memories} filterCol="content" />
                    </TabsContent>
                    <TabsContent value="people" className="m-0 h-full absolute inset-0">
                        <DataTable columns={peopleColumns} data={people} filterCol="name" />
                    </TabsContent>
                    <TabsContent value="events" className="m-0 h-full absolute inset-0">
                        <DataTable columns={eventColumns} data={events} filterCol="description" />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
                <DialogTitle>Edit {editItem && "name" in editItem ? "Person" : "Event"}</DialogTitle>
                <DialogDescription>
                    Make changes to the memory here. Embedding will be regenerated automatically.
                </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
                {editItem && "name" in editItem ? (
                    // Person Edit Form
                    <>
                        <div className="grid gap-2">
                            <Label>Name</Label>
                            <Input disabled value={editItem.name} />
                        </div>
                        <div className="grid gap-2">
                            <Label>Bio / Description</Label>
                            <Textarea 
                                value={editForm.description} 
                                onChange={(e) => setEditForm({...editForm, description: e.target.value})} 
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Relation Type</Label>
                                <Input 
                                    placeholder="e.g. friend"
                                    value={editForm.relation_type} 
                                    onChange={(e) => setEditForm({...editForm, relation_type: e.target.value})} 
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Sentiment</Label>
                                <Select 
                                    value={editForm.sentiment} 
                                    onValueChange={(val) => setEditForm({...editForm, sentiment: val})}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select sentiment" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="positive">Positive</SelectItem>
                                        <SelectItem value="neutral">Neutral</SelectItem>
                                        <SelectItem value="negative">Negative</SelectItem>
                                        <SelectItem value="complicated">Complicated</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </>
                ) : editItem ? (
                    // Event Edit Form
                    <>
                         <div className="grid gap-2">
                            <Label>Date (ISO)</Label>
                            <Input 
                                type="date"
                                value={editForm.date} 
                                onChange={(e) => setEditForm({...editForm, date: e.target.value})} 
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Description</Label>
                            <Textarea 
                                rows={5}
                                value={editForm.description} 
                                onChange={(e) => setEditForm({...editForm, description: e.target.value})} 
                            />
                        </div>
                    </>
                ) : null}
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveEdit}>Save Changes</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarInset>
  )
}

// --- Reusable Data Table Component ---

function DataTable<TData, TValue>({
    columns,
    data,
    filterCol
}: {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    filterCol: string
}) {
    const [sorting, setSorting] = useState<SortingState>([])
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setSorting,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        state: { sorting, columnFilters },
        initialState: { pagination: { pageSize: 10 } }
    })

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center p-4 border-b">
                <Input
                    placeholder={`Filter...`}
                    value={(table.getColumn(filterCol)?.getFilterValue() as string) ?? ""}
                    onChange={(event) => table.getColumn(filterCol)?.setFilterValue(event.target.value)}
                    className="max-w-sm"
                />
            </div>
            <div className="flex-1 overflow-auto">
                <Table>
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
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
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 p-4 border-t">
                 <div className="flex-1 text-sm text-muted-foreground">
                    {table.getFilteredRowModel().rows.length} row(s)
                </div>
                <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                    Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                    Next
                </Button>
            </div>
        </div>
    )
}