"use client"

import { useState, useEffect, useRef } from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ui/ai/conversation"
import { Message, MessageContent } from "@/components/ui/ai/message"
import { Response } from "@/components/ui/ai/response"
import { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputTools, PromptInputSubmit, PromptInputModelSelect, PromptInputModelSelectTrigger, PromptInputModelSelectContent, PromptInputModelSelectItem, PromptInputModelSelectValue } from "@/components/ui/ai/prompt-input"
import { Loader } from "@/components/ui/ai/loader"
import { Task, TaskTrigger, TaskContent, TaskItem } from "@/components/ui/ai/task"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/ai/reasoning"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Trash2Icon, WrenchIcon, CheckCircleIcon, ClockIcon, BrainIcon, DatabaseIcon, SaveIcon } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolCall = { name: string; status: "started" | "completed"; input?: Record<string, unknown>; output?: string }
type MemoryOp = { type: "search" | "save"; status: "started" | "completed"; query?: string; memories?: string[] }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinking?: string; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type Model = { name: string; context_length: number; supports_tools: boolean; supports_thinking: boolean; parameters: string; family: string }
type Status = "ready" | "streaming" | "thinking"

export default function Home() {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [models, setModels] = useState<Model[]>([])
  const [selectedModel, setSelectedModel] = useState("qwen3:4b")
  const [isThinking, setIsThinking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/models`).then(r => r.json()).then(d => setModels(d.models || []))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status !== "ready") return

    const userMsg: MessageType = { id: crypto.randomUUID(), role: "user", content: input }
    const assistantMsg: MessageType = { id: crypto.randomUUID(), role: "assistant", content: "", thinking: "", toolCalls: [], memoryOps: [] }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput("")
    setStatus("streaming")
    setIsThinking(false)

    abortRef.current = new AbortController()
    const res = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input, model: selectedModel }),
      signal: abortRef.current.signal,
    })

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()

    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split("\n")) {
        if (!line.startsWith("data: ")) continue
        const data = JSON.parse(line.slice(6))
        if (data.memory) {
          setMessages(prev => prev.map(m => {
            if (m.id !== assistantMsg.id) return m
            const memoryOps = [...(m.memoryOps || [])]
            const idx = memoryOps.findIndex(op => op.type === data.memory && op.status === "started")
            if (data.status === "started") {
              memoryOps.push({ type: data.memory, status: "started", query: data.query })
            } else if (data.status === "completed" && idx >= 0) {
              memoryOps[idx] = { ...memoryOps[idx], status: "completed", memories: data.memories }
            }
            return { ...m, memoryOps }
          }))
        } else if (data.thinking) {
          setIsThinking(true)
          setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, thinking: (m.thinking || "") + data.thinking } : m))
        } else if (data.content) {
          setIsThinking(false)
          setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: m.content + data.content } : m))
        } else if (data.tool_call) {
          setMessages(prev => prev.map(m => {
            if (m.id !== assistantMsg.id) return m
            const toolCalls = [...(m.toolCalls || [])]
            const idx = toolCalls.findIndex(t => t.name === data.tool_call)
            if (data.status === "started") {
              toolCalls.push({ name: data.tool_call, status: "started", input: data.input })
            } else if (data.status === "completed" && idx >= 0) {
              toolCalls[idx] = { ...toolCalls[idx], status: "completed", output: data.output }
            }
            return { ...m, toolCalls }
          }))
        }
      }
    }
    setStatus("ready")
    setIsThinking(false)
  }

  const handleClear = async () => {
    await fetch(`${API_URL}/chat/clear`, { method: "POST" })
    setMessages([])
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <h1 className="text-lg font-semibold">Ollama Chat</h1>
          <Button variant="ghost" size="icon" onClick={handleClear}><Trash2Icon className="size-4" /></Button>
        </header>

        <Conversation className="flex-1">
          <ConversationContent className="mx-auto max-w-3xl">
            {messages.length === 0 && <div className="flex h-full items-center justify-center text-muted-foreground">Start a conversation</div>}
            {messages.map(msg => (
              <Message key={msg.id} from={msg.role}>
                <MessageContent>
                  {msg.role === "assistant" ? (
                    <>
                      {msg.memoryOps && msg.memoryOps.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {msg.memoryOps.map((op, i) => (
                            <Task key={`mem-${i}`} defaultOpen={op.status === "started"}>
                              <TaskTrigger title={op.type === "search" ? "Memory Search" : "Memory Save"}>
                                <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                  {op.type === "search" ? <DatabaseIcon className="size-4" /> : <SaveIcon className="size-4" />}
                                  <span className="text-sm font-medium">{op.type === "search" ? "Memory Search" : "Memory Save"}</span>
                                  {op.status === "started" ? (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><ClockIcon className="size-3 animate-pulse" />Running</span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircleIcon className="size-3" />{op.memories?.length || 0} memories</span>
                                  )}
                                </div>
                              </TaskTrigger>
                              <TaskContent>
                                {op.query && <TaskItem>Query: <code className="text-xs bg-muted px-1 rounded">{op.query}</code></TaskItem>}
                                {op.memories && op.memories.length > 0 && op.memories.map((mem, j) => (
                                  <TaskItem key={j}><code className="text-xs bg-muted px-1 rounded">{mem}</code></TaskItem>
                                ))}
                                {op.status === "completed" && (!op.memories || op.memories.length === 0) && <TaskItem className="text-muted-foreground">No memories</TaskItem>}
                              </TaskContent>
                            </Task>
                          ))}
                        </div>
                      )}
                      {msg.thinking && (
                        <Reasoning isStreaming={isThinking && msg.id === messages[messages.length - 1]?.id}>
                          <ReasoningTrigger />
                          <ReasoningContent>{msg.thinking}</ReasoningContent>
                        </Reasoning>
                      )}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {msg.toolCalls.map((tool, i) => (
                            <Task key={i} defaultOpen={tool.status === "started"}>
                              <TaskTrigger title={tool.name}>
                                <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                  <WrenchIcon className="size-4" />
                                  <span className="text-sm font-medium">{tool.name}</span>
                                  {tool.status === "started" ? (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><ClockIcon className="size-3 animate-pulse" />Running</span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircleIcon className="size-3" />Done</span>
                                  )}
                                </div>
                              </TaskTrigger>
                              <TaskContent>
                                {tool.input && <TaskItem>Input: <code className="text-xs bg-muted px-1 rounded">{JSON.stringify(tool.input)}</code></TaskItem>}
                                {tool.output && <TaskItem>Output: <code className="text-xs bg-muted px-1 rounded">{tool.output.slice(0, 200)}{tool.output.length > 200 ? "..." : ""}</code></TaskItem>}
                              </TaskContent>
                            </Task>
                          ))}
                        </div>
                      )}
                      {msg.content ? <Response>{msg.content}</Response> : (!msg.toolCalls?.length && !msg.thinking && !msg.memoryOps?.some(op => op.status === "started") && <Loader />)}
                    </>
                  ) : msg.content}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-4">
          <div className="mx-auto max-w-3xl">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputTextarea value={input} onChange={e => setInput(e.target.value)} disabled={status === "streaming"} />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputModelSelect value={selectedModel} onValueChange={setSelectedModel}>
                    <PromptInputModelSelectTrigger className="w-[200px]">
                      <PromptInputModelSelectValue placeholder="Select model" />
                    </PromptInputModelSelectTrigger>
                    <PromptInputModelSelectContent>
                      {models.map(m => (
                        <PromptInputModelSelectItem key={m.name} value={m.name}>
                          <div className="flex items-center justify-between w-full gap-2">
                            <span className="truncate">{m.name}</span>
                            <div className="flex items-center gap-1">
                              {m.supports_tools && (
                                <Tooltip><TooltipTrigger asChild><WrenchIcon className="size-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Tools</TooltipContent></Tooltip>
                              )}
                              {m.supports_thinking && (
                                <Tooltip><TooltipTrigger asChild><BrainIcon className="size-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Thinking</TooltipContent></Tooltip>
                              )}
                            </div>
                          </div>
                        </PromptInputModelSelectItem>
                      ))}
                    </PromptInputModelSelectContent>
                  </PromptInputModelSelect>
                </PromptInputTools>
                <PromptInputSubmit status={status === "streaming" ? "streaming" : "ready"} onClick={status === "streaming" ? () => abortRef.current?.abort() : undefined} />
              </PromptInputToolbar>
            </PromptInput>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
