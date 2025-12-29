"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/ai/conversation";
import {
  Message,
  MessageContent,
  MessageAttachments,
  MessageAttachment,
  MessageActions,
  MessageAction,
  MessageBranch as MessageBranchComponent,
  MessageBranchContent,
  MessageBranchSelector,
  MessageBranchPrevious,
  MessageBranchNext,
  MessageBranchPage,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputHeader,
} from "@/components/ai-elements/prompt-input";
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
import {
  Confirmation,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
  ConfirmationAccepted,
  ConfirmationRejected,
} from "@/components/ai-elements/confirmation";
import { SidebarInset } from "@/components/ui/sidebar";
import { PageHeader } from "@/components/page-header";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  WrenchIcon,
  CheckCircleIcon,
  ClockIcon,
  BrainIcon,
  DatabaseIcon,
  BookOpenIcon,
  ImageIcon,
  CopyIcon,
  RefreshCwIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  PlusCircleIcon,
  EyeIcon,
  InfoIcon,
  Minimize2Icon,
} from "lucide-react";
import {
  useChatStore,
  type ToolCall,
  type MemoryOp,
  type KnowledgeOp,
  type ContextCompressionOp,
  type ThinkingBlock,
  type MessageBranch,
  type MessageType,
} from "@/lib/store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type StreamItem =
  | { type: "memory"; data: MemoryOp }
  | { type: "knowledge"; data: KnowledgeOp }
  | { type: "thinking"; data: ThinkingBlock }
  | { type: "tool"; data: ToolCall }
  | { type: "compression"; data: ContextCompressionOp };

function formatToolInput(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const labels: Record<string, string> = {
    name: "Name",
    description: "Description",
    relation_type: "Relation",
    sentiment: "Sentiment",
    content: "Content",
    category: "Category",
    instruction: "Instruction",
    participants: "Participants",
    mentioned_people: "Mentioned",
    date: "Date",
    start_person: "From",
    end_person: "To",
    item_id: "Item ID",
    new_content: "New Content",
    new_instruction: "New Instruction",
  };
  return Object.entries(input)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const label = labels[k] || k.replace(/_/g, " ");
      const value = Array.isArray(v) ? v.join(", ") : String(v);
      return `${label}: ${value}`;
    })
    .join("\n");
}

export default function Home() {
  const {
    messages,
    setMessages,
    input,
    setInput,
    status,
    setStatus,
    models,
    selectedModel,
    setSelectedModel,
    currentThinkingId,
    setCurrentThinkingId,
    editingMessageId,
    setEditingMessageId,
    selectedAgent,
    setSelectedAgent,
    availableAgents,
    currentConversationId,
    setCurrentConversationId,
    setConversations,
    titleGeneration,
    autoSave,
    fetchInitData,
    fetchConversationsIfStale,
    invalidateCache,
    _hasHydrated,
  } = useChatStore();
  const abortRef = useRef<AbortController | null>(null);
  const thinkingIdRef = useRef<string | null>(null);
  const toolIdCounterRef = useRef(0);
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    useChatStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!_hasHydrated) return;
    
    const loadSettings = async () => {
      // Single API call fetches models, agents, and conversations
      const { models: allModels, agents } = await fetchInitData();
      
      const currentAgent = useChatStore.getState().selectedAgent;
      if (!currentAgent && agents.length > 0) {
        setSelectedAgent(agents[0].name);
      }
      
      const currentModel = useChatStore.getState().selectedModel;
      if (!currentModel && allModels.length > 0) {
        const toolModels = allModels.filter((m: { supports_tools: boolean }) => m.supports_tools);
        setSelectedModel(toolModels.length > 0 ? toolModels[0].name : allModels[0].name);
      }
    };
    loadSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  // Generate title using LLM based on first user + assistant exchange
  const generateTitle = async (userMsg: string, assistantMsg: string): Promise<string> => {
    if (!userMsg) return "New chat";
    
    // If title generation is disabled, use simple truncation
    if (!titleGeneration) {
      return userMsg.slice(0, 30) + (userMsg.length > 30 ? "..." : "");
    }
    
    try {
      const res = await fetch(`${API_URL}/conversations/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          user_message: userMsg, 
          assistant_message: assistantMsg,
          model: selectedModel 
        }),
      });
      const data = await res.json();
      return data.title || "New chat";
    } catch (e) {
      // Fallback to simple truncation
      return userMsg.slice(0, 30) + (userMsg.length > 30 ? "..." : "");
    }
  };

  // Save conversation to backend
  const saveConversation = useCallback(async (msgs: MessageType[], convId: string | null) => {
    if (msgs.length === 0) return;
    
    const messagesJson = JSON.stringify(msgs);

    try {
      if (convId) {
        await fetch(`${API_URL}/conversations/${convId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messagesJson }),
        });
      } else {
        const firstUserMsg = msgs.find(m => m.role === "user");
        const firstAssistantMsg = msgs.find(m => m.role === "assistant");
        const title = await generateTitle(
          firstUserMsg?.content || "", 
          firstAssistantMsg?.content || ""
        );
        
        const res = await fetch(`${API_URL}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            messages: messagesJson,
            agent: selectedAgent,
            model: selectedModel,
          }),
        });
        const data = await res.json();
        setCurrentConversationId(data.id);
        invalidateCache("conversations");
        fetchConversationsIfStale();
      }
    } catch (e) {
      console.error("Failed to save conversation:", e);
    }
  }, [selectedAgent, selectedModel, setCurrentConversationId, invalidateCache, fetchConversationsIfStale]);

  // Debounced auto-save when messages change
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Skip if auto-save is disabled
    if (!autoSave) return;
    
    // Only save if we have at least one assistant message with content
    const hasContent = messages.some(m => m.role === "assistant" && m.content);
    if (!hasContent) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveConversation(messages, currentConversationId);
    }, 1000); // Debounce 1 second

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, currentConversationId, saveConversation, autoSave]);

  const sendMessage = async (
    message: string,
    files: Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      data: string;
    }> = [],
    existingAssistantId?: string
  ) => {
    const assistantMsg = existingAssistantId
      ? {
          id: existingAssistantId,
          role: "assistant" as const,
          content: "",
          thinkingBlocks: [] as ThinkingBlock[],
          toolCalls: [] as ToolCall[],
          memoryOps: [] as MemoryOp[],
          knowledgeOps: [] as KnowledgeOp[],
        }
      : {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: "",
          thinkingBlocks: [] as ThinkingBlock[],
          toolCalls: [] as ToolCall[],
          memoryOps: [] as MemoryOp[],
          knowledgeOps: [] as KnowledgeOp[],
        };

    let historyMessages: any[] = [];
    const attachmentArray = Array.isArray(files) ? files : [];

    if (!existingAssistantId) {
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: message,
        experimental_attachments: attachmentArray,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      historyMessages = [...messages, userMsg];
    } else {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== existingAssistantId) return m;
          return {
            ...assistantMsg,
            branches: m.branches,
            currentBranch: m.currentBranch,
          };
        })
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
            experimental_attachments: m.experimental_attachments,
          })),
          model: selectedModel,
          agent: selectedAgent,
          conversation_id: currentConversationId,
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
          if (data.context_compression) {
            // Handle context compression event
            const compressionKey = `${assistantMsg.id}-compression`;
            setOpenItems((prev) => new Set(prev).add(compressionKey));
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                return {
                  ...m,
                  contextCompression: {
                    status: "completed",
                    summary: data.context_compression.summary,
                    messages_summarized: data.context_compression.messages_summarized,
                    tokens_before: data.context_compression.tokens_before,
                    tokens_after: data.context_compression.tokens_after,
                    tokens_saved: data.context_compression.tokens_saved,
                  },
                };
              })
            );
          } else if (data.memory === "search") {
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
          } else if (data.knowledge === "search") {
            const knowledgeKey = `${assistantMsg.id}-knowledge`;
            setOpenItems((prev) => new Set(prev).add(knowledgeKey));
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const knowledgeOps = [...(m.knowledgeOps || [])];
                if (data.status === "started")
                  knowledgeOps.push({
                    type: "search",
                    status: "started",
                    query: data.query,
                  });
                else {
                  const idx = knowledgeOps.findIndex(
                    (op) => op.type === "search" && op.status === "started"
                  );
                  if (idx >= 0)
                    knowledgeOps[idx] = {
                      type: "search",
                      status: "completed",
                      query: (knowledgeOps[idx] as { query?: string }).query,
                      chunks: data.chunks,
                    };
                }
                return { ...m, knowledgeOps };
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
          } else if (data.error) {
            toast.error("Error", { description: data.error });
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
            break;
          } else if (data.metadata) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, metadata: data.metadata }
                  : m
              )
            );
          } else if (data.done) {
            break;
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
            if (data.status === "started" || data.status === "pending_confirmation") {
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
                    category: data.category,
                  });
                } else if (data.status === "pending_confirmation") {
                  const idx = toolCalls.findIndex((t) => t.id === toolId);
                  if (idx >= 0) {
                    toolCalls[idx] = { ...toolCalls[idx], status: "pending_confirmation", input: data.input || toolCalls[idx].input, category: data.category || toolCalls[idx].category };
                  } else {
                    toolCalls.push({ name: data.tool_call, status: "pending_confirmation", input: data.input, id: toolId, category: data.category });
                  }
                } else if (data.status === "denied") {
                  const idx = toolCalls.findIndex((t) => t.id === toolId);
                  if (idx >= 0) {
                    toolCalls[idx] = { ...toolCalls[idx], status: "denied" };
                  }
                } else {
                  const idx = toolCalls.findIndex((t) => t.id === toolId);
                  if (idx >= 0) {
                    toolCalls[idx] = {
                      ...toolCalls[idx],
                      status: "completed",
                      input: data.input || toolCalls[idx].input,
                      output: data.output,
                      artifacts: data.artifacts,
                      category: data.category || toolCalls[idx].category,
                    };
                  } else {
                    toolCalls.push({
                      name: data.tool_call,
                      status: "completed",
                      input: data.input,
                      output: data.output,
                      artifacts: data.artifacts,
                      id: toolId,
                      category: data.category,
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
      if (e instanceof Error && e.name !== "AbortError") {
        toast.error("Connection error", { description: e.message });
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      }
    } finally {
      setOpenItems(new Set());
      setStatus("ready");
      setCurrentThinkingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== "ready") return;
    await sendMessage(input, []);
  };

  const handleRegenerate = async (msgIndex: number) => {
    if (status !== "ready") return;
    const userMsgIndex = msgIndex - 1;
    const userMsg = messages[userMsgIndex];
    if (!userMsg || userMsg.role !== "user") return;

    const assistantMsg = messages[msgIndex];
    const currentIdx = assistantMsg.currentBranch ?? (assistantMsg.branches?.length || 0);
    
    let contentToSave = assistantMsg.content;
    let thinkingToSave = assistantMsg.thinkingBlocks;
    let toolsToSave = assistantMsg.toolCalls;
    let memoryToSave = assistantMsg.memoryOps;
    let knowledgeToSave = assistantMsg.knowledgeOps;
    
    if (currentIdx === (assistantMsg.branches?.length || 0) && assistantMsg.liveContent) {
      contentToSave = assistantMsg.liveContent.content;
      thinkingToSave = assistantMsg.liveContent.thinkingBlocks;
      toolsToSave = assistantMsg.liveContent.toolCalls;
      memoryToSave = assistantMsg.liveContent.memoryOps;
      knowledgeToSave = assistantMsg.liveContent.knowledgeOps;
    }
    
    const newBranch: MessageBranch = {
      id: crypto.randomUUID(),
      content: contentToSave,
      thinkingBlocks: thinkingToSave,
      toolCalls: toolsToSave,
      memoryOps: memoryToSave,
      knowledgeOps: knowledgeToSave,
    };

    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const branches = [...(m.branches || []), newBranch];
        return { ...m, branches, currentBranch: branches.length, liveContent: undefined };
      })
    );

    await sendMessage(userMsg.content, [], assistantMsg.id);
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
        knowledgeOps: [],
      });
      return truncated;
    });

    setEditingMessageId(null);
    setEditContent("");
    await sendMessage(editContent, [], newAssistantId);
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleBranchChange = (msgIndex: number, branchIndex: number) => {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const branches = [...(m.branches || [])];
        const totalBranches = branches.length + 1;
        const currentIdx = m.currentBranch ?? branches.length;
        
        if (branchIndex === currentIdx || branchIndex >= totalBranches) return m;
        
        let liveContent = m.liveContent;
        
        if (currentIdx === branches.length) {
          liveContent = {
            content: m.content,
            thinkingBlocks: m.thinkingBlocks,
            toolCalls: m.toolCalls,
            memoryOps: m.memoryOps,
            knowledgeOps: m.knowledgeOps,
          };
        } else if (currentIdx < branches.length) {
          branches[currentIdx] = {
            ...branches[currentIdx],
            content: m.content,
            thinkingBlocks: m.thinkingBlocks,
            toolCalls: m.toolCalls,
            memoryOps: m.memoryOps,
            knowledgeOps: m.knowledgeOps,
          };
        }
        
        if (branchIndex === branches.length && liveContent) {
          return {
            ...m,
            currentBranch: branchIndex,
            branches,
            liveContent,
            content: liveContent.content,
            thinkingBlocks: liveContent.thinkingBlocks,
            toolCalls: liveContent.toolCalls,
            memoryOps: liveContent.memoryOps,
            knowledgeOps: liveContent.knowledgeOps,
          };
        }
        
        const branch = branches[branchIndex];
        return {
          ...m,
          currentBranch: branchIndex,
          branches,
          liveContent,
          content: branch.content,
          thinkingBlocks: branch.thinkingBlocks,
          toolCalls: branch.toolCalls,
          memoryOps: branch.memoryOps,
          knowledgeOps: branch.knowledgeOps,
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

  const handleToolConfirmation = async (toolId: string, approved: boolean) => {
    await fetch(`${API_URL}/chat/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_id: toolId, approved }),
    });
  };

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
    knowledgeOps?: KnowledgeOp[];
    thinkingBlocks?: ThinkingBlock[];
    toolCalls?: ToolCall[];
  }): StreamItem[] => {
    const items: StreamItem[] = [];
    // Context compression appears first (before any other operations)
    if (msg.contextCompression) {
      items.push({ type: "compression", data: msg.contextCompression });
    }
    msg.memoryOps?.forEach((m) => items.push({ type: "memory", data: m }));
    msg.knowledgeOps?.forEach((k) => items.push({ type: "knowledge", data: k }));
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
      <PageHeader title="Chat" />

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
                  {msg.role === "user" &&
                    Array.isArray(msg.experimental_attachments) &&
                    msg.experimental_attachments.length > 0 && (
                      <MessageAttachments>
                        {msg.experimental_attachments.map((attachment) => (
                          <MessageAttachment
                            key={attachment.id}
                            data={{
                              type: "file",
                              url: attachment.data,
                              mediaType: attachment.type,
                              filename: attachment.name,
                            }}
                          />
                        ))}
                      </MessageAttachments>
                    )}
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
                        <MessageResponse>{msg.content}</MessageResponse>
                      )
                    ) : (
                      <>
                        {buildStreamOrder(msg).map((item, i) => {
                          if (item.type === "compression") {
                            const comp = item.data;
                            const key = `${msg.id}-compression`;
                            return (
                              <Task
                                key={`compression-${i}`}
                                open={isOpen(key)}
                                onOpenChange={() => toggleOpen(key)}
                              >
                                <TaskTrigger>
                                  <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                    <Minimize2Icon className="size-4" />
                                    <span className="text-sm">
                                      Context Compressed
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      ({comp.messages_summarized} msgs, ~{comp.tokens_saved.toLocaleString()} tokens saved)
                                    </span>
                                    <CheckCircleIcon className="size-3 text-green-600" />
                                  </div>
                                </TaskTrigger>
                                <TaskContent>
                                  <TaskItem>
                                    <div className="space-y-2 text-sm">
                                      <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Before: {comp.tokens_before.toLocaleString()} tokens</span>
                                        <span>After: {comp.tokens_after.toLocaleString()} tokens</span>
                                      </div>
                                      <div className="font-medium text-xs">Summary:</div>
                                      <div className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-40 overflow-y-auto">
                                        {comp.summary}
                                      </div>
                                    </div>
                                  </TaskItem>
                                </TaskContent>
                              </Task>
                            );
                          }
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
                          if (item.type === "knowledge") {
                            const op = item.data;
                            if (op.type === "search") {
                              const key = `${msg.id}-knowledge`;
                              return (
                                <Task
                                  key={`knowledge-${i}`}
                                  open={isOpen(key)}
                                  onOpenChange={() => toggleOpen(key)}
                                >
                                  <TaskTrigger>
                                    <div className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                                      <BookOpenIcon className="size-4" />
                                      <span className="text-sm">
                                        Knowledge Search
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
                                    {op.chunks?.map((chunk, j) => (
                                      <TaskItem key={j}>
                                        <code className="text-xs bg-muted px-1 rounded whitespace-pre-wrap">
                                          {chunk}
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
                            const isMemoryTool = tool.category === "memory";
                            const memoryText = tool.input
                              ? JSON.stringify(tool.input, null, 2)
                              : "";
                            const memoryType = tool.name
                              .replace("add_", "")
                              .replace("or_update_", "");
                            const humanReadableInput = formatToolInput(tool.name, tool.input);

                            if (isMemoryTool) {
                              if (tool.status === "pending_confirmation") {
                                return (
                                  <Confirmation
                                    key={`tool-${i}`}
                                    approval={{ id: tool.id || "" }}
                                    state="approval-requested"
                                    className="w-full"
                                  >
                                    <ConfirmationRequest>
                                      <div className="flex flex-col gap-3 w-full">
                                        <div className="flex items-center gap-2">
                                          <PlusCircleIcon className="size-5 text-amber-500" />
                                          <span className="font-medium text-base">{tool.name.replace(/_/g, " ")}</span>
                                          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-600">{memoryType}</span>
                                        </div>
                                        <div className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                                          {humanReadableInput}
                                        </div>
                                      </div>
                                    </ConfirmationRequest>
                                    <ConfirmationActions>
                                      <ConfirmationAction
                                        variant="outline"
                                        onClick={() => handleToolConfirmation(tool.id || "", false)}
                                      >
                                        Deny
                                      </ConfirmationAction>
                                      <ConfirmationAction
                                        onClick={() => handleToolConfirmation(tool.id || "", true)}
                                      >
                                        Allow
                                      </ConfirmationAction>
                                    </ConfirmationActions>
                                  </Confirmation>
                                );
                              }

                              if (tool.status === "denied") {
                                return (
                                  <Confirmation
                                    key={`tool-${i}`}
                                    approval={{ id: tool.id || "", approved: false }}
                                    state="output-denied"
                                  >
                                    <ConfirmationRejected>
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <XIcon className="size-4 text-red-500" />
                                        <span className="text-sm">{tool.name.replace(/_/g, " ")} denied</span>
                                      </div>
                                    </ConfirmationRejected>
                                  </Confirmation>
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
                          <MessageResponse>
                            {msg.content}
                          </MessageResponse>
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
                  <MessageToolbar className="justify-end mt-1">
                    {hasBranches && (
                      <MessageBranchComponent
                        defaultBranch={currentBranchIdx}
                        onBranchChange={(idx) =>
                          handleBranchChange(msgIndex, idx)
                        }
                      >
                        <MessageBranchContent>
                          {[...(msg.branches || []), { id: "current", content: msg.content }].map((branch) => (
                            <div key={branch.id} />
                          ))}
                        </MessageBranchContent>
                        <MessageBranchSelector from="user">
                          <MessageBranchPrevious />
                          <MessageBranchPage />
                          <MessageBranchNext />
                        </MessageBranchSelector>
                      </MessageBranchComponent>
                    )}
                    <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <MessageAction
                        tooltip="Edit"
                        onClick={() => handleEditStart(msg.id, msg.content)}
                      >
                        <PencilIcon className="size-4" />
                      </MessageAction>
                      <MessageAction
                        tooltip="Copy"
                        onClick={() => handleCopy(msg.content)}
                      >
                        <CopyIcon className="size-4" />
                      </MessageAction>
                    </MessageActions>
                  </MessageToolbar>
                )}

                {msg.role === "assistant" && msg.content && (
                  <MessageToolbar className="justify-start mb-2">
                    <MessageActions>
                      <MessageAction
                        tooltip="Regenerate"
                        onClick={() => handleRegenerate(msgIndex)}
                      >
                        <RefreshCwIcon className="size-4" />
                      </MessageAction>
                      <MessageAction
                        tooltip="Copy"
                        onClick={() => handleCopy(msg.content)}
                      >
                        <CopyIcon className="size-4" />
                      </MessageAction>
                      {msg.metadata && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon-sm" className="size-7">
                              <InfoIcon className="size-4" />
                              <span className="sr-only">Metadata</span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3">
                            <div className="space-y-2 text-sm">
                              <div className="font-medium mb-2">Response Metadata</div>
                              {msg.metadata.model && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Model:</span>
                                  <span className="font-mono text-xs">{msg.metadata.model}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Time:</span>
                                <span>{msg.metadata.elapsed_time}s</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Input tokens:</span>
                                <span>{msg.metadata.input_tokens.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Output tokens:</span>
                                <span>{msg.metadata.output_tokens.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Speed:</span>
                                <span>{msg.metadata.tokens_per_second} tok/s</span>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </MessageActions>
                    {hasBranches && (
                      <MessageBranchComponent
                        defaultBranch={currentBranchIdx}
                        onBranchChange={(idx) =>
                          handleBranchChange(msgIndex, idx)
                        }
                      >
                        <MessageBranchContent>
                          {[...(msg.branches || []), { id: "current", content: msg.content }].map((branch) => (
                            <div key={branch.id} />
                          ))}
                        </MessageBranchContent>
                        <MessageBranchSelector from="assistant">
                          <MessageBranchPrevious />
                          <MessageBranchPage />
                          <MessageBranchNext />
                        </MessageBranchSelector>
                      </MessageBranchComponent>
                    )}
                  </MessageToolbar>
                )}
              </div>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className=" pb-4">
        <div className="mx-auto w-full  max-w-3xl">
          <PromptInput
            onSubmit={(message) => {
              const hasText = Boolean(message.text);
              const hasAttachments = Boolean(message.files?.length);
              if (!(hasText || hasAttachments)) {
                return;
              }
              sendMessage(
                message.text || "Sent with attachments",
                message.files?.map((f) => ({
                  id: f.url || "",
                  name: f.filename || "attachment",
                  type: f.mediaType || "application/octet-stream",
                  size: 0,
                  data: f.url || "",
                })) || []
              );
              setInput("");
            }}
            accept="image/*"
            multiple
            globalDrop
          >
            <PromptInputHeader
            className="p-0 m-0"
            >
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
            </PromptInputHeader>
            <PromptInputBody className="p-0">
              <PromptInputTextarea
                placeholder="What would you like to know?"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </PromptInputBody>

            <PromptInputFooter  className="p-1">
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger title="Add attachments" />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <PromptInputSelect
                  value={selectedAgent}
                  onValueChange={(v) => v && setSelectedAgent(v)}
                >
                  <PromptInputSelectTrigger className="w-[140px]">
                    <PromptInputSelectValue placeholder="Agent" />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {availableAgents.map((a) => (
                      <PromptInputSelectItem key={a.name} value={a.name}>
                        {a.name}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>

                <PromptInputSelect
                  value={selectedModel}
                  onValueChange={(v) => v && setSelectedModel(v)}
                >
                  <PromptInputSelectTrigger className="w-[180px]">
                    <PromptInputSelectValue placeholder="Model" />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {models
                      .filter((m) => m.supports_tools)
                      .map((m) => (
                        <PromptInputSelectItem key={m.name} value={m.name}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{m.name}</span>
                            {m.supports_vision && (
                              <EyeIcon className="size-3 text-muted-foreground" />
                            )}
                            {m.supports_thinking && (
                              <BrainIcon className="size-3 text-muted-foreground" />
                            )}
                          </div>
                        </PromptInputSelectItem>
                      ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              </PromptInputTools>

              <PromptInputSubmit 
                disabled={(!input && status !== "streaming") || !selectedModel} 
                status={status}
                onClick={(e) => {
                  if (status === "streaming" && abortRef.current) {
                    e.preventDefault();
                    abortRef.current.abort();
                    setStatus("ready");
                  }
                }}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </SidebarInset>
  );
}
