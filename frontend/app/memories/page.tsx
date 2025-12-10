"use client"

import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Trash2Icon,
  RefreshCwIcon,
  UsersIcon,
  CalendarIcon,
  LightbulbIcon,
  SettingsIcon,
  PencilIcon,
  AlertTriangleIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  Search,
  SlidersHorizontal,
  CopyIcon,
  ChevronRightIcon,
  Loader2Icon,
  LinkIcon,
  NetworkIcon,
} from "lucide-react"
import dynamic from "next/dynamic"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false })
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  Row,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type MemoryType = "Person" | "Event" | "Fact" | "Preference"
type Memory = { id: string; type: MemoryType; content: string }
type Person = { id: string; name: string; description: string; relation: string; sentiment: string }
type Event = { id: string; description: string; date: string; participants: string[] }
type Duplicate = { id1: string; id2: string; content1: string; content2: string; score: number; type: string }
type TableItem = { id: string; type: MemoryType; content: string; extra?: string; data: Person | Event | Memory }

type ConnectionPerson = { id: string; name: string; relation?: string; sentiment?: string; description?: string; role?: string; direction?: string; since?: string }
type ConnectionEvent = { id: string; description: string; date?: string; role?: string }
type Connections = { type: string; events: ConnectionEvent[]; people: ConnectionPerson[] }
type GraphNode = { id: string; type: string; name: string }
type GraphLink = { source: string; target: string; type: string }
type GraphData = { nodes: GraphNode[]; links: GraphLink[] }

const typeConfig: Record<MemoryType, { icon: React.ReactNode; color: string; bgColor: string }> = {
  Person: { icon: <UsersIcon className="size-4" />, color: "text-violet-600 dark:text-violet-400", bgColor: "bg-violet-100 dark:bg-violet-500/20" },
  Event: { icon: <CalendarIcon className="size-4" />, color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-500/20" },
  Fact: { icon: <LightbulbIcon className="size-4" />, color: "text-sky-600 dark:text-sky-400", bgColor: "bg-sky-100 dark:bg-sky-500/20" },
  Preference: { icon: <SettingsIcon className="size-4" />, color: "text-emerald-600 dark:text-emerald-400", bgColor: "bg-emerald-100 dark:bg-emerald-500/20" },
}

// Expandable row sub-component
function ConnectionsRow({ row, columnsLength }: { row: Row<TableItem>; columnsLength: number }) {
  const [connections, setConnections] = useState<Connections | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const fetchConnections = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`${API_URL}/memories/${encodeURIComponent(row.original.id)}/connections`)
        const data = await res.json()
        setConnections(data)
      } catch (error) {
        console.error("Failed to fetch connections:", error)
      }
      setIsLoading(false)
    }
    fetchConnections()
  }, [row.original.id])

  const hasConnections = connections && (connections.events.length > 0 || connections.people.length > 0)

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/40">
      <TableCell colSpan={columnsLength} className="py-3">
        <div className="pl-10">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2Icon className="size-4 animate-spin" />
              Loading connections...
            </div>
          ) : !hasConnections ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <LinkIcon className="size-4 opacity-50" />
              No connections found
            </div>
          ) : (
            <div className="space-y-3">
              {/* Events */}
              {connections.events.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                    <CalendarIcon className="size-3.5" />
                    Events ({connections.events.length})
                  </div>
                  <div className="space-y-1.5">
                    {connections.events.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-amber-100/50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm"
                      >
                        <CalendarIcon className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="flex-1">{event.description}</span>
                        {event.date && (
                          <span className="text-xs text-muted-foreground font-mono shrink-0">{event.date}</span>
                        )}
                        {event.role && (
                          <Badge variant="outline" className="text-[10px] shrink-0">{event.role}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* People */}
              {connections.people.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                    <UsersIcon className="size-3.5" />
                    People ({connections.people.length})
                  </div>
                  <div className="space-y-1.5">
                    {connections.people.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-violet-100/50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-sm"
                      >
                        <UsersIcon className="size-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                        <span className="font-medium">{person.name}</span>
                        {person.relation && (
                          <Badge variant="secondary" className="text-[10px]">{person.relation}</Badge>
                        )}
                        {person.sentiment && (
                          <Badge 
                            variant="outline" 
                            className={`text-[10px] ${
                              person.sentiment === "positive" ? "border-green-500 text-green-600 dark:text-green-400" :
                              person.sentiment === "negative" ? "border-red-500 text-red-600 dark:text-red-400" :
                              person.sentiment === "complicated" ? "border-amber-500 text-amber-600 dark:text-amber-400" :
                              ""
                            }`}
                          >
                            {person.sentiment}
                          </Badge>
                        )}
                        {person.role && (
                          <Badge variant="outline" className="text-[10px]">{person.role}</Badge>
                        )}
                        {person.since && (
                          <span className="text-xs text-muted-foreground font-mono">since {person.since}</span>
                        )}
                        {person.direction && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {person.direction === "incoming" ? "→ knows this person" : "← known by this person"}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const graphRef = useRef<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [editItem, setEditItem] = useState<Person | Event | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [activeTab, setActiveTab] = useState("memories")

  // Data table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all")
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    const [memRes, pplRes, evtRes, dupRes, graphRes] = await Promise.all([
      fetch(`${API_URL}/memories?limit=100`),
      fetch(`${API_URL}/memories/people`),
      fetch(`${API_URL}/memories/events`),
      fetch(`${API_URL}/memories/duplicates?threshold=0.90&limit=20`),
      fetch(`${API_URL}/memories/graph`)
    ])
    setMemories((await memRes.json()).memories || [])
    setPeople((await pplRes.json()).people || [])
    setEvents((await evtRes.json()).events || [])
    setDuplicates((await dupRes.json()).duplicates || [])
    const graph = await graphRes.json()
    setGraphData({ nodes: graph.nodes || [], links: graph.links || [] })
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
    typeFilter === "all" ? allItems : allItems.filter(item => item.type === typeFilter)
  , [allItems, typeFilter])

  const counts = useMemo(() => ({
    all: allItems.length,
    Person: people.length,
    Event: events.length,
    Fact: memories.filter(m => m.type === "Fact").length,
    Preference: memories.filter(m => m.type === "Preference").length
  }), [allItems, people, events, memories])

  const columns: ColumnDef<TableItem>[] = [
    {
      id: "expand",
      header: () => null,
      cell: ({ row }) => {
        // Only show expand for Person and Event types (they have relationships)
        if (row.original.type !== "Person" && row.original.type !== "Event") {
          return <div className="w-8" />
        }
        return (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => row.toggleExpanded()}
          >
            <ChevronRightIcon
              className={`size-4 transition-transform duration-200 ${
                row.getIsExpanded() ? "rotate-90" : ""
              }`}
            />
          </Button>
        )
      },
      enableHiding: false,
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="-ml-4 h-8 data-[state=open]:bg-accent"
        >
          Type
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div
          className={`inline-flex items-center justify-center size-8 rounded-md ${typeConfig[row.original.type].color} ${typeConfig[row.original.type].bgColor}`}
          title={row.original.type}
        >
          {typeConfig[row.original.type].icon}
        </div>
      ),
      filterFn: (row, id, value) => value === "all" || row.getValue(id) === value,
    },
    {
      accessorKey: "content",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="-ml-4 h-8 data-[state=open]:bg-accent"
        >
          Content
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const item = row.original
        if (item.type === "Person") {
          const p = item.data as Person
          return (
            <div className="min-w-0">
              <p className="font-medium text-sm">{p.name}</p>
              {p.description && <p className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words">{p.description}</p>}
            </div>
          )
        }
        if (item.type === "Event") {
          const e = item.data as Event
          return (
            <div className="min-w-0">
              <p className="text-sm whitespace-normal break-words">{e.description}</p>
              {e.date && <p className="text-xs text-muted-foreground mt-0.5 font-mono">{e.date}</p>}
            </div>
          )
        }
        return <p className="text-sm whitespace-normal break-words">{item.content}</p>
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
            <div className="flex gap-1.5 flex-wrap">
              {p.relation && <Badge variant="secondary" className="text-[10px] font-medium">{p.relation}</Badge>}
              {p.sentiment && <Badge variant="outline" className="text-[10px]">{p.sentiment}</Badge>}
            </div>
          )
        }
        if (item.type === "Event") {
          const e = item.data as Event
          return e.participants?.filter(Boolean).length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {e.participants.filter(Boolean).slice(0, 3).map((p, i) => <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>)}
              {e.participants.filter(Boolean).length > 3 && <Badge variant="secondary" className="text-[10px]">+{e.participants.filter(Boolean).length - 3}</Badge>}
            </div>
          ) : null
        }
        return null
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      enableHiding: false,
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => navigator.clipboard.writeText(item.id)}
              title="Copy ID"
            >
              <CopyIcon className="size-4" />
            </Button>
            {(item.type === "Person" || item.type === "Event") && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => handleEditClick(item.data as Person | Event)}
                title="Edit"
              >
                <PencilIcon className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(item.id)}
              title="Delete"
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filteredByType,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getRowCanExpand: (row) => row.original.type === "Person" || row.original.type === "Event",
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      expanded,
    },
    initialState: {
      pagination: { pageSize: 10 },
    },
  })

  return (
    <SidebarInset className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Memories" badge={counts.all}>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="h-10 mt-2">
            <TabsTrigger value="memories" className="gap-2">
              <LightbulbIcon className="size-4" />
              Memories
              <Badge variant="secondary" className="ml-1 rounded text-[10px] px-1.5">{counts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="graph" className="gap-2">
              <NetworkIcon className="size-4" />
              Graph
            </TabsTrigger>
            <TabsTrigger value="issues" className="gap-2">
              <AlertTriangleIcon className="size-4" />
              Issues
              {duplicates.length > 0 && (
                <Badge variant="destructive" className="ml-1 rounded text-[10px] px-1.5">{duplicates.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="memories" className="flex-1 flex flex-col overflow-hidden mt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search memories..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="size-4 mr-2" />
                  {typeFilter === "all" ? "All Types" : typeFilter}
                  <ChevronDown className="ml-2 size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={typeFilter === "all"}
                  onCheckedChange={() => setTypeFilter("all")}
                >
                  All Types
                </DropdownMenuCheckboxItem>
                {(["Person", "Event", "Fact", "Preference"] as const).map((type) => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={typeFilter === type}
                    onCheckedChange={() => setTypeFilter(type)}
                  >
                    <span className={`flex items-center gap-2 ${typeConfig[type].color}`}>
                      {typeConfig[type].icon}
                      {type}
                    </span>
                    <span className="ml-auto text-muted-foreground text-xs">{counts[type]}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto h-9">
                  Columns <ChevronDown className="ml-2 size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto px-4 py-4">
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="bg-muted/50">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                      <Fragment key={row.id}>
                        <TableRow className="hover:bg-muted/50">
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                        {row.getIsExpanded() && (
                          <ConnectionsRow row={row} columnsLength={columns.length} />
                        )}
                      </Fragment>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="h-24 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <LightbulbIcon className="size-8 opacity-50" />
                          <p>No memories found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-muted-foreground">
                {table.getFilteredRowModel().rows.length} memory(ies)
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Rows per page</p>
                  <Select
                    value={`${table.getState().pagination.pageSize}`}
                    onValueChange={(value) => table.setPageSize(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[70px]">
                      <SelectValue placeholder={table.getState().pagination.pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[10, 20, 30, 50, 100].map((pageSize) => (
                        <SelectItem key={pageSize} value={`${pageSize}`}>
                          {pageSize}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                  Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                  >
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="graph" className="flex-1 mt-0 p-0 overflow-hidden">
          {graphData.nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <NetworkIcon className="size-12 opacity-30 mb-4" />
              <p className="text-lg font-medium">No Graph Data</p>
              <p className="text-sm">Add some people and events to see the graph</p>
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel="name"
              nodeColor={(node: GraphNode) => {
                switch (node.type) {
                  case "User": return "#22c55e"
                  case "Person": return "#8b5cf6"
                  case "Event": return "#f59e0b"
                  case "Fact": return "#0ea5e9"
                  case "Preference": return "#10b981"
                  default: return "#64748b"
                }
              }}
              nodeRelSize={8}
              linkColor={() => "#64748b"}
              linkWidth={2}
              linkDirectionalArrowLength={5}
              linkDirectionalArrowRelPos={1}
              backgroundColor="transparent"
              cooldownTicks={100}
              onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
            />
          )}
        </TabsContent>

        <TabsContent value="issues" className="flex-1 overflow-auto mt-0">
          <div className="p-4">
            {duplicates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <AlertTriangleIcon className="size-12 opacity-30 mb-4" />
                <p className="text-lg font-medium">No Issues Found</p>
                <p className="text-sm">All your memories look unique!</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-4">
                  <AlertTriangleIcon className="size-5" />
                  <span className="font-semibold">Potential Duplicates ({duplicates.length})</span>
                </div>
                <div className="grid gap-3">
                  {duplicates.map((dup, i) => (
                    <div key={i} className="rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="outline" className={`${typeConfig[dup.type as MemoryType]?.color || ""} ${typeConfig[dup.type as MemoryType]?.bgColor || ""}`}>
                          {typeConfig[dup.type as MemoryType]?.icon}
                          <span className="ml-1">{dup.type}</span>
                        </Badge>
                        <span className="text-sm font-medium text-amber-600 dark:text-amber-400 ml-auto">
                          {Math.round(dup.score * 100)}% similar
                        </span>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="p-3 bg-muted/50 rounded-md">
                          <div className="flex items-start gap-2">
                            <p className="text-sm flex-1 whitespace-normal break-words">{dup.content1}</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(dup.id1)}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-md">
                          <div className="flex items-start gap-2">
                            <p className="text-sm flex-1 whitespace-normal break-words">{dup.content2}</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(dup.id2)}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editItem && "name" in editItem ? "Person" : "Event"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {editItem && "name" in editItem ? (
              <>
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input disabled value={editItem.name} />
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Relation</Label>
                    <Input
                      placeholder="friend, colleague..."
                      value={editForm.relation_type}
                      onChange={(e) => setEditForm({ ...editForm, relation_type: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Sentiment</Label>
                    <Select value={editForm.sentiment} onValueChange={(val) => setEditForm({ ...editForm, sentiment: val })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {["positive", "neutral", "negative", "complicated"].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : editItem ? (
              <>
                <div className="grid gap-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={4}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarInset>
  )
}
