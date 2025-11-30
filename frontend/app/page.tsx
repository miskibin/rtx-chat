"use client"

import { useEffect, useRef, useState } from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ui/ai/conversation"
import { Message, MessageContent } from "@/components/ui/ai/message"
import { Response } from "@/components/ui/ai/response"
import { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputTools, PromptInputSubmit, PromptInputModelSelect, PromptInputModelSelectTrigger, PromptInputModelSelectContent, PromptInputModelSelectItem, PromptInputModelSelectValue } from "@/components/ui/ai/prompt-input"
import { Loader } from "@/components/ui/ai/loader"
import { Task, TaskTrigger, TaskContent, TaskItem } from "@/components/ui/ai/task"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/ai/reasoning"
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { CodeBlock, CodeBlockBody, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockItem } from "@/components/ui/code-block"
import { WrenchIcon, CheckCircleIcon, ClockIcon, BrainIcon, DatabaseIcon, ImageIcon } from "lucide-react"
import { useChatStore, type ToolCall, type MemoryOp, type ThinkingBlock } from "@/lib/store"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type StreamItem = { type: "memory"; data: MemoryOp } | { type: "thinking"; data: ThinkingBlock } | { type: "tool"; data: ToolCall }

export default function Home() {
  const { messages, setMessages, input, setInput, status, setStatus, models, setModels, selectedModel, setSelectedModel, currentThinkingId, setCurrentThinkingId } = useChatStore()
  const abortRef = useRef<AbortController | null>(null)
  const [openItems, setOpenItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`${API_URL}/models`).then(r => r.json()).then(d => setModels(d.models || []))
  }, [setModels])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status !== "ready") return

    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: input }
    const assistantMsg = { id: crypto.randomUUID(), role: "assistant" as const, content: "", thinkingBlocks: [] as ThinkingBlock[], toolCalls: [] as ToolCall[], memoryOps: [] as MemoryOp[] }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput("")
    setStatus("streaming")
    setCurrentThinkingId(null)

    abortRef.current = new AbortController()
    const res = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input, model: selectedModel }),
      signal: abortRef.current.signal,
    })

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    let thinkingId: string | null = null

    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split("\n")) {
        if (!line.startsWith("data: ")) continue
        const data = JSON.parse(line.slice(6))
        if (data.memory === "search") {
          const memKey = `${assistantMsg.id}-mem`
          setOpenItems(prev => new Set(prev).add(memKey))
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
          if (!thinkingId) {
            thinkingId = crypto.randomUUID()
            setCurrentThinkingId(thinkingId)
            setOpenItems(prev => new Set(prev).add(thinkingId!))
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantMsg.id) return m
              return { ...m, thinkingBlocks: [...(m.thinkingBlocks || []), { id: thinkingId!, content: data.thinking, isStreaming: true }] }
            }))
          } else {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantMsg.id) return m
              const blocks = [...(m.thinkingBlocks || [])]
              const idx = blocks.findIndex(b => b.id === thinkingId)
              if (idx >= 0) blocks[idx] = { ...blocks[idx], content: blocks[idx].content + data.thinking }
              return { ...m, thinkingBlocks: blocks }
            }))
          }
        } else if (data.content) {
          if (thinkingId) {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantMsg.id) return m
              const blocks = [...(m.thinkingBlocks || [])]
              const idx = blocks.findIndex(b => b.id === thinkingId)
              if (idx >= 0) blocks[idx] = { ...blocks[idx], isStreaming: false }
              return { ...m, thinkingBlocks: blocks }
            }))
            thinkingId = null
            setCurrentThinkingId(null)
          }
          setOpenItems(new Set())
          setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: m.content + data.content } : m))
        } else if (data.tool_call) {
          if (thinkingId) {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantMsg.id) return m
              const blocks = [...(m.thinkingBlocks || [])]
              const idx = blocks.findIndex(b => b.id === thinkingId)
              if (idx >= 0) blocks[idx] = { ...blocks[idx], isStreaming: false }
              return { ...m, thinkingBlocks: blocks }
            }))
            thinkingId = null
            setCurrentThinkingId(null)
          }
          const toolKey = `${assistantMsg.id}-tool-${data.tool_call}`
          if (data.status === "started") {
            setOpenItems(prev => new Set(prev).add(toolKey))
          }
          setMessages(prev => prev.map(m => {
            if (m.id !== assistantMsg.id) return m
            const toolCalls = [...(m.toolCalls || [])]
            if (data.status === "started") toolCalls.push({ name: data.tool_call, status: "started", input: data.input })
            else {
              const idx = toolCalls.findIndex(t => t.name === data.tool_call && t.status === "started")
              if (idx >= 0) toolCalls[idx] = { ...toolCalls[idx], status: "completed", output: data.output, artifacts: data.artifacts }
            }
            return { ...m, toolCalls }
          }))
        }
      }
    }
    setOpenItems(new Set())
    setStatus("ready")
    setCurrentThinkingId(null)
  }

  const isOpen = (key: string) => openItems.has(key)
  const toggleOpen = (key: string) => setOpenItems(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const renderCodeInput = (code: string) => (
    <CodeBlock data={[{ language: "python", filename: "code.py", code }]} defaultValue="python" className="max-h-48 overflow-y-auto">
      <CodeBlockHeader>
        <div className="flex-1" />
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.language} value={item.language} lineNumbers={false}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  )

  const buildStreamOrder = (msg: { memoryOps?: MemoryOp[]; thinkingBlocks?: ThinkingBlock[]; toolCalls?: ToolCall[] }): StreamItem[] => {
    const items: StreamItem[] = []
    msg.memoryOps?.forEach(m => items.push({ type: "memory", data: m }))
    let thinkIdx = 0, toolIdx = 0
    const thinks = msg.thinkingBlocks || []
    const tools = msg.toolCalls || []
    while (thinkIdx < thinks.length || toolIdx < tools.length) {
      if (thinkIdx < thinks.length) {
        items.push({ type: "thinking", data: thinks[thinkIdx++] })
      }
      if (toolIdx < tools.length) {
        items.push({ type: "tool", data: tools[toolIdx++] })
      }
    }
    return items
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
                    {buildStreamOrder(msg).map((item, i) => {
                      if (item.type === "memory") {
                        const op = item.data
                        const key = `${msg.id}-mem`
                        return (
                          <Task key={`mem-${i}`} open={isOpen(key)} onOpenChange={() => toggleOpen(key)}>
                            <TaskTrigger>
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
                        )
                      }
                      if (item.type === "thinking") {
                        const block = item.data
                        return (
                          <Reasoning key={block.id} isStreaming={block.isStreaming && currentThinkingId === block.id} open={isOpen(block.id)} onOpenChange={() => toggleOpen(block.id)}>
                            <ReasoningTrigger />
                            <ReasoningContent>{block.content}</ReasoningContent>
                          </Reasoning>
                        )
                      }
                      if (item.type === "tool") {
                        const tool = item.data
                        const key = `${msg.id}-tool-${tool.name}`
                        return (
                          <Task key={`tool-${i}`} open={isOpen(key)} onOpenChange={() => toggleOpen(key)}>
                            <TaskTrigger>
                              <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                {tool.artifacts?.length ? <ImageIcon className="size-4" /> : <WrenchIcon className="size-4" />}
                                <span className="text-sm">{tool.name}</span>
                                {tool.status === "started" ? <ClockIcon className="size-3 animate-pulse" /> : <CheckCircleIcon className="size-3 text-green-600" />}
                              </div>
                            </TaskTrigger>
                            <TaskContent>
                              {(() => {
                                const code = tool.input?.code
                                if (typeof code === "string") return <TaskItem>{renderCodeInput(code)}</TaskItem>
                                if (tool.input) return <TaskItem><code className="text-xs bg-muted px-1 rounded whitespace-pre-wrap">{JSON.stringify(tool.input, null, 2).slice(0, 500)}</code></TaskItem>
                                return null
                              })()}
                              {tool.output && <TaskItem><code className="text-xs bg-muted px-1 rounded block whitespace-pre-wrap">{tool.output.slice(0, 300)}</code></TaskItem>}
                              {tool.artifacts?.map((artifact, j) => (
                                <TaskItem key={j} className="mt-2">
                                  <img src={artifact} alt="Generated chart" className="rounded-lg border max-w-[600px]" />
                                </TaskItem>
                              ))}
                            </TaskContent>
                          </Task>
                        )
                      }
                      return null
                    })}
                    {msg.content ? <Response>{msg.content}</Response> : (!msg.toolCalls?.length && !msg.thinkingBlocks?.length && !msg.memoryOps?.some(op => op.status === "started") && <Loader />)}
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
