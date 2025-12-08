"use client";

import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/ai/conversation";
import { Message, MessageContent } from "@/components/ui/ai/message";
import { Response } from "@/components/ui/ai/response";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputModelSelect,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectValue,
} from "@/components/ui/ai/prompt-input";
import { Loader } from "@/components/ui/ai/loader";
import {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
} from "@/components/ui/ai/task";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ui/ai/reasoning";
import { Actions, Action } from "@/components/ui/ai/actions";
import {
  Branch,
  BranchSelector,
  BranchPrevious,
  BranchNext,
  BranchPage,
} from "@/components/ui/ai/branch";
import { SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/ui/code-block";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  WrenchIcon,
  CheckCircleIcon,
  ClockIcon,
  BrainIcon,
  DatabaseIcon,
  ImageIcon,
  CopyIcon,
  RefreshCwIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  PlusCircleIcon,
  RefreshCcwIcon,
} from "lucide-react";
import {
  useChatStore,
  type ToolCall,
  type MemoryOp,
  type ThinkingBlock,
  type MessageBranch,
} from "@/lib/store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type StreamItem =
  | { type: "memory"; data: MemoryOp }
  | { type: "thinking"; data: ThinkingBlock }
  | { type: "tool"; data: ToolCall };

export default function Home() {
  const {
    messages,
    setMessages,
    input,
    setInput,
    status,
    setStatus,
    models,
    setModels,
    selectedModel,
    setSelectedModel,
    currentThinkingId,
    setCurrentThinkingId,
    editingMessageId,
    setEditingMessageId,
    systemPrompt,
    setSystemPrompt,
    settings,
  } = useChatStore();
  const abortRef = useRef<AbortController | null>(null);
  const thinkingIdRef = useRef<string | null>(null);
  const toolIdCounterRef = useRef(0);
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/models`)
      .then((r) => r.json())
      .then((d) => {
        const allModels = d.models || [];
        setModels(allModels);
        const toolModels = allModels.filter(
          (m: { supports_tools: boolean }) => m.supports_tools
        );
        if (toolModels.length > 0 && !selectedModel) {
          setSelectedModel(toolModels[0].name);
        }
      });
  }, []);

  const sendMessage = async (message: string, existingAssistantId?: string) => {
    const assistantMsg = existingAssistantId
      ? {
          id: existingAssistantId,
          role: "assistant" as const,
          content: "",
          thinkingBlocks: [] as ThinkingBlock[],
          toolCalls: [] as ToolCall[],
          memoryOps: [] as MemoryOp[],
        }
      : {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: "",
          thinkingBlocks: [] as ThinkingBlock[],
          toolCalls: [] as ToolCall[],
          memoryOps: [] as MemoryOp[],
        };

    let historyMessages: any[] = [];

    if (!existingAssistantId) {
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: message,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      historyMessages = [...messages, userMsg];
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === existingAssistantId ? assistantMsg : m))
      );
      const index = messages.findIndex((m) => m.id === existingAssistantId);
      if (index !== -1) {
        historyMessages = messages.slice(0, index);
      } else {
        historyMessages = messages;
      }
    }

    setInput("");
    setStatus("streaming");
    setCurrentThinkingId(null);

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          messages: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          model: selectedModel,
          system_prompt: systemPrompt,
          max_tool_runs: settings.maxToolRuns,
          max_memories: settings.maxMemories,
          enabled_tools:
            settings.enabledTools.length > 0 ? settings.enabledTools : null,
        }),
        signal: abortRef.current.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      thinkingIdRef.current = null;
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.content)
            console.log("Raw content:", JSON.stringify(data.content));
          if (data.memory === "search") {
            const memKey = `${assistantMsg.id}-mem`;
            setOpenItems((prev) => new Set(prev).add(memKey));
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const memoryOps = [...(m.memoryOps || [])];
                if (data.status === "started")
                  memoryOps.push({
                    type: "search",
                    status: "started",
                    query: data.query,
                  });
                else {
                  const idx = memoryOps.findIndex(
                    (op) => op.type === "search" && op.status === "started"
                  );
                  if (idx >= 0)
                    memoryOps[idx] = {
                      type: "search",
                      status: "completed",
                      query: (memoryOps[idx] as { query?: string }).query,
                      memories: data.memories,
                    };
                }
                return { ...m, memoryOps };
              })
            );
          } else if (data.thinking) {
            if (!thinkingIdRef.current) {
              thinkingIdRef.current = crypto.randomUUID();
              setCurrentThinkingId(thinkingIdRef.current);
              setOpenItems((prev) => new Set(prev).add(thinkingIdRef.current!));
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  return {
                    ...m,
                    thinkingBlocks: [
                      ...(m.thinkingBlocks || []),
                      {
                        id: thinkingIdRef.current!,
                        content: data.thinking,
                        isStreaming: true,
                      },
                    ],
                  };
                })
              );
            } else {
              const currentId = thinkingIdRef.current;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const blocks = [...(m.thinkingBlocks || [])];
                  const idx = blocks.findIndex((b) => b.id === currentId);
                  if (idx >= 0)
                    blocks[idx] = {
                      ...blocks[idx],
                      content: blocks[idx].content + data.thinking,
                    };
                  return { ...m, thinkingBlocks: blocks };
                })
              );
            }
          } else if (data.content) {
            if (thinkingIdRef.current) {
              const currentId = thinkingIdRef.current;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const blocks = [...(m.thinkingBlocks || [])];
                  const idx = blocks.findIndex((b) => b.id === currentId);
                  if (idx >= 0)
                    blocks[idx] = { ...blocks[idx], isStreaming: false };
                  return { ...m, thinkingBlocks: blocks };
                })
              );
              thinkingIdRef.current = null;
              setCurrentThinkingId(null);
            }
            setOpenItems(new Set());
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + data.content }
                  : m
              )
            );
          } else if (data.tool_call) {
            console.log("Tool event:", data);
            if (thinkingIdRef.current) {
              const currentId = thinkingIdRef.current;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const blocks = [...(m.thinkingBlocks || [])];
                  const idx = blocks.findIndex((b) => b.id === currentId);
                  if (idx >= 0)
                    blocks[idx] = { ...blocks[idx], isStreaming: false };
                  return { ...m, thinkingBlocks: blocks };
                })
              );
              thinkingIdRef.current = null;
              setCurrentThinkingId(null);
            }
            const toolId =
              data.tool_id || `${data.tool_call}-${++toolIdCounterRef.current}`;
            const toolKey = `${assistantMsg.id}-tool-${toolId}`;
            if (data.status === "started") {
              setOpenItems((prev) => new Set(prev).add(toolKey));
            }
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const toolCalls = [...(m.toolCalls || [])];
                if (data.status === "started") {
                  toolCalls.push({
                    name: data.tool_call,
                    status: "started",
                    input: data.input,
                    id: toolId,
                  });
                } else {
                  const idx = toolCalls.findIndex((t) => t.id === toolId);
                  if (idx >= 0) {
                    toolCalls[idx] = {
                      ...toolCalls[idx],
                      status: "completed",
                      input: data.input || toolCalls[idx].input,
                      output: data.output,
                      artifacts: data.artifacts,
                    };
                  } else {
                    toolCalls.push({
                      name: data.tool_call,
                      status: "completed",
                      input: data.input,
                      output: data.output,
                      artifacts: data.artifacts,
                      id: toolId,
                    });
                  }
                }
                return { ...m, toolCalls };
              })
            );
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // User cancelled - that's fine
      } else {
        console.error("Stream error:", e);
      }
    }
    setOpenItems(new Set());
    setStatus("ready");
    setCurrentThinkingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== "ready") return;
    await sendMessage(input);
  };

  const handleRegenerate = async (msgIndex: number) => {
    if (status !== "ready") return;
    const userMsgIndex = msgIndex - 1;
    const userMsg = messages[userMsgIndex];
    if (!userMsg || userMsg.role !== "user") return;

    const assistantMsg = messages[msgIndex];
    const currentBranch: MessageBranch = {
      id: crypto.randomUUID(),
      content: assistantMsg.content,
      thinkingBlocks: assistantMsg.thinkingBlocks,
      toolCalls: assistantMsg.toolCalls,
      memoryOps: assistantMsg.memoryOps,
    };

    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const branches = [...(m.branches || []), currentBranch];
        return { ...m, branches, currentBranch: branches.length };
      })
    );

    await sendMessage(userMsg.content, assistantMsg.id);
  };

  const handleEditStart = (msgId: string, content: string) => {
    setEditingMessageId(msgId);
    setEditContent(content);
  };

  const handleEditCancel = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  const handleEditSubmit = async (msgIndex: number) => {
    if (status !== "ready" || !editContent.trim()) return;

    const userMsg = messages[msgIndex];
    const currentBranch: MessageBranch = {
      id: crypto.randomUUID(),
      content: userMsg.content,
    };
    const newAssistantId = crypto.randomUUID();

    setMessages((prev) => {
      const newMsgs = prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const branches = [...(m.branches || []), currentBranch];
        return {
          ...m,
          content: editContent,
          branches,
          currentBranch: branches.length,
        };
      });
      const truncated = newMsgs.slice(0, msgIndex + 1);
      truncated.push({
        id: newAssistantId,
        role: "assistant",
        content: "",
        thinkingBlocks: [],
        toolCalls: [],
        memoryOps: [],
      });
      return truncated;
    });

    setEditingMessageId(null);
    setEditContent("");
    await sendMessage(editContent, newAssistantId);
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleBranchChange = (msgIndex: number, branchIndex: number) => {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const branches = m.branches || [];
        if (branchIndex === branches.length) {
          return { ...m, currentBranch: branchIndex };
        }
        const branch = branches[branchIndex];
        return {
          ...m,
          currentBranch: branchIndex,
          content: branch.content,
          thinkingBlocks: branch.thinkingBlocks,
          toolCalls: branch.toolCalls,
          memoryOps: branch.memoryOps,
        };
      })
    );
  };

  const isOpen = (key: string) => openItems.has(key);
  const toggleOpen = (key: string) =>
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderCodeInput = (code: string) => (
    <CodeBlock
      data={[{ language: "python", filename: "code.py", code }]}
      defaultValue="python"
    >
      <CodeBlockHeader>
        <div className="flex-1" />
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem
            key={item.language}
            value={item.language}
            lineNumbers={false}
          >
            <CodeBlockContent language={item.language}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );

  const buildStreamOrder = (msg: {
    memoryOps?: MemoryOp[];
    thinkingBlocks?: ThinkingBlock[];
    toolCalls?: ToolCall[];
  }): StreamItem[] => {
    const items: StreamItem[] = [];
    msg.memoryOps?.forEach((m) => items.push({ type: "memory", data: m }));
    let thinkIdx = 0,
      toolIdx = 0;
    const thinks = msg.thinkingBlocks || [];
    const tools = msg.toolCalls || [];
    while (thinkIdx < thinks.length || toolIdx < tools.length) {
      if (thinkIdx < thinks.length) {
        items.push({ type: "thinking", data: thinks[thinkIdx++] });
      }
      if (toolIdx < tools.length) {
        items.push({ type: "tool", data: tools[toolIdx++] });
      }
    }
    return items;
  };

  return (
    <SidebarInset className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <SidebarTrigger />
        <span className="text-sm font-medium">Chat</span>
      </header>

      <Conversation className="flex-1 overflow-hidden">
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 ">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Start a conversation
            </div>
          )}
          {messages.map((msg, msgIndex) => {
            const hasBranches = msg.branches && msg.branches.length > 0;
            const currentBranchIdx =
              msg.currentBranch ?? (msg.branches?.length || 0);

            return (
              <div key={msg.id} className="group">
                <Message from={msg.role}>
                  <MessageContent>
                    {msg.role === "user" ? (
                      editingMessageId === msg.id ? (
                        <div className="space-y-2 w-full">
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="min-h-20"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleEditSubmit(msgIndex)}
                            >
                              <CheckIcon className="size-4 mr-1" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleEditCancel}
                            >
                              <XIcon className="size-4 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        msg.content
                      )
                    ) : (
                      <>
                        {buildStreamOrder(msg).map((item, i) => {
                          if (item.type === "memory") {
                            const op = item.data;
                            if (op.type === "search") {
                              const key = `${msg.id}-mem`;
                              return (
                                <Task
                                  key={`mem-${i}`}
                                  open={isOpen(key)}
                                  onOpenChange={() => toggleOpen(key)}
                                >
                                  <TaskTrigger>
                                    <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                      <DatabaseIcon className="size-4" />
                                      <span className="text-sm">
                                        Memory Search
                                      </span>
                                      {op.status === "started" ? (
                                        <ClockIcon className="size-3 animate-pulse" />
                                      ) : (
                                        <CheckCircleIcon className="size-3 text-green-600" />
                                      )}
                                    </div>
                                  </TaskTrigger>
                                  <TaskContent>
                                    {op.query && (
                                      <TaskItem>
                                        <code className="text-xs bg-muted px-1 rounded">
                                          {op.query}
                                        </code>
                                      </TaskItem>
                                    )}
                                    {op.memories?.map((m, j) => (
                                      <TaskItem key={j}>
                                        <code className="text-xs bg-muted px-1 rounded">
                                          {m}
                                        </code>
                                      </TaskItem>
                                    ))}
                                  </TaskContent>
                                </Task>
                              );
                            }
                          }
                          if (item.type === "thinking") {
                            const block = item.data;
                            return (
                              <Reasoning
                                key={block.id}
                                isStreaming={
                                  block.isStreaming &&
                                  currentThinkingId === block.id
                                }
                                open={isOpen(block.id)}
                                onOpenChange={() => toggleOpen(block.id)}
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>
                                  {block.content}
                                </ReasoningContent>
                              </Reasoning>
                            );
                          }
                          if (item.type === "tool") {
                            const tool = item.data;
                            const key = `${msg.id}-tool-${tool.name}-${i}`;
                            const memoryTools = ["add_or_update_person", "add_event", "add_fact", "add_preference", "add_or_update_relationship"];
                            const isMemoryTool = memoryTools.includes(tool.name);
                            const memoryText = tool.input ? JSON.stringify(tool.input, null, 2) : "";
                            const memoryType = tool.name.replace("add_", "").replace("or_update_", "");

                            if (isMemoryTool) {
                              return (
                                <Task
                                  key={`tool-${i}`}
                                  open={isOpen(key)}
                                  onOpenChange={() => toggleOpen(key)}
                                >
                                  <TaskTrigger>
                                    <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                      <PlusCircleIcon className="size-4 text-green-500" />
                                      <span className="text-sm">
                                        {tool.name.replace(/_/g, " ")}
                                      </span>
                                      {memoryType && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                                          {memoryType}
                                        </span>
                                      )}
                                      {tool.status === "started" ? (
                                        <ClockIcon className="size-3 animate-pulse" />
                                      ) : (
                                        <CheckCircleIcon className="size-3 text-green-600" />
                                      )}
                                    </div>
                                  </TaskTrigger>
                                  <TaskContent>
                                    <TaskItem>
                                      <p className="text-sm text-muted-foreground">
                                        {String(memoryText).slice(0, 300)}
                                      </p>
                                    </TaskItem>
                                    {tool.output && (
                                      <TaskItem>
                                        <code className="text-xs text-green-600">
                                          {tool.output}
                                        </code>
                                      </TaskItem>
                                    )}
                                  </TaskContent>
                                </Task>
                              );
                            }

                            return (
                              <Task
                                key={`tool-${i}`}
                                open={isOpen(key)}
                                onOpenChange={() => toggleOpen(key)}
                              >
                                <TaskTrigger>
                                  <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                    {tool.artifacts?.length ? (
                                      <ImageIcon className="size-4" />
                                    ) : (
                                      <WrenchIcon className="size-4" />
                                    )}
                                    <span className="text-sm">{tool.name}</span>
                                    {tool.status === "started" ? (
                                      <ClockIcon className="size-3 animate-pulse" />
                                    ) : (
                                      <CheckCircleIcon className="size-3 text-green-600" />
                                    )}
                                  </div>
                                </TaskTrigger>
                                <TaskContent>
                                  {(() => {
                                    const code = tool.input?.code;
                                    if (typeof code === "string")
                                      return (
                                        <TaskItem>
                                          {renderCodeInput(code)}
                                        </TaskItem>
                                      );
                                    if (tool.input)
                                      return (
                                        <TaskItem>
                                          <code className="text-xs bg-muted px-1 rounded whitespace-pre-wrap">
                                            {JSON.stringify(
                                              tool.input,
                                              null,
                                              2
                                            ).slice(0, 2000)}
                                          </code>
                                        </TaskItem>
                                      );
                                    return null;
                                  })()}
                                  {tool.output && (
                                    <TaskItem>
                                      <code className="text-xs bg-muted px-1 rounded block whitespace-pre-wrap">
                                        {tool.output.slice(0, 5000)}
                                      </code>
                                    </TaskItem>
                                  )}
                                  {tool.artifacts?.map((artifact, j) => (
                                    <TaskItem key={j} className="mt-2">
                                      <img
                                        src={artifact}
                                        alt="Generated chart"
                                        className="rounded-lg border max-w-[600px]"
                                      />
                                    </TaskItem>
                                  ))}
                                </TaskContent>
                              </Task>
                            );
                          }
                          return null;
                        })}
                        {msg.content ? (
                          <Response defaultOrigin="http://localhost:8000">
                            {msg.content}
                          </Response>
                        ) : (
                          !msg.toolCalls?.length &&
                          !msg.thinkingBlocks?.length &&
                          !msg.memoryOps?.some(
                            (op) =>
                              op.type === "search" && op.status === "started"
                          ) && <Loader />
                        )}
                      </>
                    )}
                  </MessageContent>
                </Message>

                {msg.role === "user" && editingMessageId !== msg.id && (
                  <div className="flex justify-end items-center gap-2 -mt-3 mb-2 mr-1">
                    {hasBranches && (
                      <Branch
                        defaultBranch={currentBranchIdx}
                        onBranchChange={(idx) =>
                          handleBranchChange(msgIndex, idx)
                        }
                      >
                        <BranchSelector from="user">
                          <BranchPrevious />
                          <BranchPage />
                          <BranchNext />
                        </BranchSelector>
                      </Branch>
                    )}
                    <Actions className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Action
                        tooltip="Edit"
                        onClick={() => handleEditStart(msg.id, msg.content)}
                      >
                        <PencilIcon className="size-4" />
                      </Action>
                      <Action
                        tooltip="Copy"
                        onClick={() => handleCopy(msg.content)}
                      >
                        <CopyIcon className="size-4" />
                      </Action>
                    </Actions>
                  </div>
                )}

                {msg.role === "assistant" && msg.content && (
                  <div className="flex justify-start items-center gap-2 -mt-3 mb-2">
                    <Actions>
                      <Action
                        tooltip="Regenerate"
                        onClick={() => handleRegenerate(msgIndex)}
                      >
                        <RefreshCwIcon className="size-4" />
                      </Action>
                      <Action
                        tooltip="Copy"
                        onClick={() => handleCopy(msg.content)}
                      >
                        <CopyIcon className="size-4" />
                      </Action>
                    </Actions>
                    {hasBranches && (
                      <Branch
                        defaultBranch={currentBranchIdx}
                        onBranchChange={(idx) =>
                          handleBranchChange(msgIndex, idx)
                        }
                      >
                        <BranchSelector from="assistant">
                          <BranchPrevious />
                          <BranchPage />
                          <BranchNext />
                        </BranchSelector>
                      </Branch>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className=" pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={status === "streaming"}
            />
            <PromptInputToolbar>
              <PromptInputTools>
                <PromptInputModelSelect
                  value={systemPrompt}
                  onValueChange={(v) =>
                    setSystemPrompt(v as "normal" | "psychological")
                  }
                >
                  <PromptInputModelSelectTrigger className="w-[140px]">
                    <PromptInputModelSelectValue placeholder="System" />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    <PromptInputModelSelectItem value="normal">
                      Normal
                    </PromptInputModelSelectItem>
                    <PromptInputModelSelectItem value="psychological">
                      Psychological
                    </PromptInputModelSelectItem>
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
                <PromptInputModelSelect
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                >
                  <PromptInputModelSelectTrigger className="w-[180px]">
                    <PromptInputModelSelectValue placeholder="Model" />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {models
                      .filter((m) => m.supports_tools)
                      .map((m) => (
                        <PromptInputModelSelectItem key={m.name} value={m.name}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{m.name}</span>
                            {m.supports_thinking && (
                              <BrainIcon className="size-3 text-muted-foreground" />
                            )}
                          </div>
                        </PromptInputModelSelectItem>
                      ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                onClick={
                  status === "streaming"
                    ? () => abortRef.current?.abort()
                    : undefined
                }
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </SidebarInset>
  );
}
