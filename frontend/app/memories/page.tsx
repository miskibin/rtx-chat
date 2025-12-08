"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Trash2Icon, DatabaseIcon, ArrowUpDown } from "lucide-react"
import { ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, SortingState, useReactTable, ColumnFiltersState } from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type MemoryType = "Person" | "Event" | "Fact" | "Preference"

type Memory = { 
  id: string
  type: MemoryType
  content: string
}

const getTypeColor = (type: MemoryType) => {
  const colors: Record<MemoryType, string> = {
    Person: "bg-amber-100 text-amber-800 border-amber-300",
    Event: "bg-orange-100 text-orange-800 border-orange-300",
    Fact: "bg-blue-100 text-blue-800 border-blue-300",
    Preference: "bg-green-100 text-green-800 border-green-300",
  }
  return colors[type] || "bg-gray-100 text-gray-800 border-gray-300"
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const loadMemories = async () => {
    const r = await fetch(`${API_URL}/memories`)
    const d = await r.json()
    setMemories(d.memories || [])
  }

  useEffect(() => { 
    loadMemories()
  }, [])

  const handleDelete = async (id: string) => {
    console.log("Deleting memory:", id)
    await fetch(`${API_URL}/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
    await loadMemories()
  }

  const columns = useMemo<ColumnDef<Memory>[]>(() => [
    {
      accessorKey: "type",
      header: ({ column }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Type
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className={`text-xs ${getTypeColor(row.getValue("type"))}`}>
          {row.getValue("type")}
        </Badge>
      ),
    },
    {
      accessorKey: "content",
      header: "Content",
      cell: ({ row }) => <p className="text-sm">{row.getValue("content")}</p>,
      meta: { cellClassName: "whitespace-normal" }
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => (
        <button
          className="inline-flex items-center justify-center rounded-md hover:bg-accent size-8"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDelete(row.original.id)
          }}
        >
          <Trash2Icon className="size-4" />
        </button>
      ),
    },
  ], [])

  const table = useReactTable({
    data: memories,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { pagination: { pageSize: 10 } },
    state: { sorting, columnFilters },
  })

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <SidebarTrigger />
        <DatabaseIcon className="size-4" />
        <span className="text-sm font-semibold">Memories</span>
        <span className="text-xs text-muted-foreground ml-auto">{memories.length} total</span>
      </header>
      
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex items-center py-4">
            <Input 
              placeholder="Filter memories..." 
              value={(table.getColumn("content")?.getFilterValue() as string) ?? ""}
              onChange={(e) => table.getColumn("content")?.setFilterValue(e.target.value)}
              className="max-w-sm" 
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
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
                        <TableCell 
                          key={cell.id}
                          className={(cell.column.columnDef.meta as any)?.cellClassName}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end space-x-2 py-4">
            <div className="flex-1 text-sm text-muted-foreground">
              {table.getFilteredRowModel().rows.length} of {memories.length} row(s).
            </div>
            <div className="space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}
