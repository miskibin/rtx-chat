"use client"

import { useState, useEffect, useRef } from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ui/ai/conversation"
import { Message, MessageContent } from "@/components/ui/ai/message"
import { Response } from "@/components/ui/ai/response"
import { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputTools, PromptInputSubmit, PromptInputModelSelect, PromptInputModelSelectTrigger, PromptInputModelSelectContent, PromptInputModelSelectItem, PromptInputModelSelectValue } from "@/components/ui/ai/prompt-input"
import { Loader } from "@/components/ui/ai/loader"
import { Task, TaskTrigger, TaskContent, TaskItem } from "@/components/ui/ai/task"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/ai/reasoning"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { WrenchIcon, CheckCircleIcon, ClockIcon, BrainIcon, DatabaseIcon } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type ToolCall = { name: string; status: "started" | "completed"; input?: Record<string, unknown>; output?: string }
type MemoryOp = { type: "search"; status: "started" | "completed"; query?: string; memories?: string[] }
type MessageType = { id: string; role: "user" | "assistant"; content: string; thinking?: string; toolCalls?: ToolCall[]; memoryOps?: MemoryOp[] }
type Model = { name: string; supports_tools: boolean; supports_thinking: boolean }

export default function Home() {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<"ready" | "streaming">("ready")
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
        if (data.memory === "search") {
          setMessages(prev => prev.map(m => {
            if (m.id !== assistantMsg.id) return m
            const memoryOps = [...(m.memoryOps || [])]
            if (data.status === "started") memoryOps.push({ type: "search", status: "started", query: data.query })
            else {
              const idx = memoryOps.findIndex(op => op.status === "started")
              if (idx >= 0) memoryOps[idx] = { ...memoryOps[idx], status: "completed", memories: data.memories }
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
            if (data.status === "started") toolCalls.push({ name: data.tool_call, status: "started", input: data.input })
            else {
              const idx = toolCalls.findIndex(t => t.name === data.tool_call && t.status === "started")
              if (idx >= 0) toolCalls[idx] = { ...toolCalls[idx], status: "completed", output: data.output }
            }
            return { ...m, toolCalls }
          }))
        }
      }
    }
    setStatus("ready")
    setIsThinking(false)
  }

  return (
    <SidebarInset className="flex flex-col h-screen">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <SidebarTrigger />
        <span className="text-sm font-medium">Chat</span>
      </header>

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-3xl">
          {messages.length === 0 && <div className="flex h-full items-center justify-center text-muted-foreground">Start a conversation</div>}
          {messages.map(msg => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {msg.role === "assistant" ? (
                  <>
                    {msg.memoryOps?.map((op, i) => (
                      <Task key={i} defaultOpen={op.status === "started"}>
                        <TaskTrigger title="Memory Search">
                          <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                            <DatabaseIcon className="size-4" />
                            <span className="text-sm">Memory Search</span>
                            {op.status === "started" ? <ClockIcon className="size-3 animate-pulse" /> : <CheckCircleIcon className="size-3 text-green-600" />}
                          </div>
                        </TaskTrigger>
                        <TaskContent>
                          {op.query && <TaskItem><code className="text-xs bg-muted px-1 rounded">{op.query}</code></TaskItem>}
                          {op.memories?.map((m, j) => <TaskItem key={j}><code className="text-xs bg-muted px-1 rounded">{m}</code></TaskItem>)}
                        </TaskContent>
                      </Task>
                    ))}
                    {msg.thinking && (
                      <Reasoning isStreaming={isThinking && msg.id === messages[messages.length - 1]?.id}>
                        <ReasoningTrigger />
                        <ReasoningContent>{msg.thinking}</ReasoningContent>
                      </Reasoning>
                    )}
                    {msg.toolCalls?.map((tool, i) => (
                      <Task key={i} defaultOpen={tool.status === "started"}>
                        <TaskTrigger title={tool.name}>
                          <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                            <WrenchIcon className="size-4" />
                            <span className="text-sm">{tool.name}</span>
                            {tool.status === "started" ? <ClockIcon className="size-3 animate-pulse" /> : <CheckCircleIcon className="size-3 text-green-600" />}
                          </div>
                        </TaskTrigger>
                        <TaskContent>
                          {tool.input && <TaskItem>Input: <code className="text-xs bg-muted px-1 rounded">{JSON.stringify(tool.input)}</code></TaskItem>}
                          {tool.output && <TaskItem>Output: <code className="text-xs bg-muted px-1 rounded">{tool.output.slice(0, 200)}</code></TaskItem>}
                        </TaskContent>
                      </Task>
                    ))}
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
                  <PromptInputModelSelectTrigger className="w-[180px]">
                    <PromptInputModelSelectValue placeholder="Model" />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {models.map(m => (
                      <PromptInputModelSelectItem key={m.name} value={m.name}>
                        <div className="flex items-center gap-2">
                          <span className="truncate">{m.name}</span>
                          {m.supports_tools && <WrenchIcon className="size-3 text-muted-foreground" />}
                          {m.supports_thinking && <BrainIcon className="size-3 text-muted-foreground" />}
                        </div>
                      </PromptInputModelSelectItem>
                    ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              </PromptInputTools>
              <PromptInputSubmit status={status} onClick={status === "streaming" ? () => abortRef.current?.abort() : undefined} />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </SidebarInset>
  )
}
