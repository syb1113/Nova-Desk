import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type CompleteAttachment,
  type ThreadUserMessagePart,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Mic,
  Package,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  FormEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocation } from "react-router-dom";
import {
  stripHermesDiagnostics,
  streamHermesMessage,
  type ChatRole,
  type ChatMessage,
  type MessageAttachment,
} from "../api/hermes";
import {
  getConfiguredModelOptions,
  type ConfiguredModelOption,
} from "../config/modelProviders";
import { useSkillStore } from "../state/skillStore";
import { useTokenUsageStore } from "../state/tokenUsageStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { logger } from "../state/logStore";
import { SkillsPage } from "../skills/SkillsPage";
import { ScheduledTasksPage } from "../scheduled-tasks/ScheduledTasksPage";
import { LogViewerPage } from "../logs/LogViewerPage";
import { TokenUsagePage } from "../token-usage/TokenUsagePage";
import type { AppliedSkill, SkillConfig } from "../types/skill";
import {
  getNovaAttachmentFilePath,
  NovaAttachmentAdapter,
  rememberNovaAttachmentFilePath,
} from "./adapters/novaAttachmentAdapter";

const createMessage = (
  role: ChatMessage["role"],
  content: string,
  appliedSkills?: AppliedSkill[],
  attachments?: MessageAttachment[],
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  ...(appliedSkills && appliedSkills.length > 0 ? { appliedSkills } : {}),
  ...(attachments && attachments.length > 0 ? { attachments } : {}),
});

type AssistantMessageContentPart = Exclude<
  NonNullable<ThreadMessageLike["content"]>,
  string
>[number];

const toAssistantThreadMessage = (
  message: ChatMessage,
  index: number,
): ThreadMessageLike => {
  const content: AssistantMessageContentPart[] = [
    { type: "text", text: message.content },
  ];

  for (const att of message.attachments ?? []) {
    if (att.type === "image" && att.dataUrl) {
      content.push({ type: "image", image: att.dataUrl, filename: att.name });
    } else {
      content.push({
        type: "file",
        filename: att.name,
        data: att.textContent ?? "",
        mimeType: att.mimeType || "application/octet-stream",
      });
    }
  }

  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(index),
    content,
    attachments: [],
    status:
      message.role === "assistant"
        ? { type: "complete", reason: "stop" }
        : undefined,
    metadata: {
      custom: {},
    },
  };
};

const buildPromptWithHistory = (messages: ChatMessage[], prompt: string) => {
  const history = messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .slice(-10)
    .map(
      (message) =>
        `${message.role === "user" ? "用户" : "助手"}：${message.content}`,
    )
    .join("\n\n");

  if (!history) {
    return prompt;
  }

  return `下面是当前本地对话上下文，请基于这些上下文回答最后一个问题。\n\n${history}\n\n用户：${prompt}`;
};

const nextTypewriterChunk = (text: string) => {
  if (text.length <= 4) {
    return text;
  }

  const punctuationIndex = text.slice(0, 18).search(/[，。！？；,.!?;\n]/);

  if (punctuationIndex >= 0) {
    return text.slice(0, punctuationIndex + 1);
  }

  return text.slice(0, Math.min(6, text.length));
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const buildAttachmentPrompt = (attachments?: MessageAttachment[]) => {
  if (!attachments?.length) return "";

  const nonImageAttachments = attachments.filter(
    (attachment) => attachment.type !== "image",
  );

  if (nonImageAttachments.length === 0) return "";

  const blocks = nonImageAttachments.map((attachment, index) => {
    const header = [
      `附件 ${index + 1}: ${attachment.name}`,
      `类型: ${attachment.type}`,
      `MIME: ${attachment.mimeType || "unknown"}`,
      `大小: ${formatBytes(attachment.size)}`,
    ].join("\n");

    if (attachment.textContent) {
      return `${header}\n文件内容:\n${attachment.textContent}`;
    }

    return `${header}\n文件内容未读取；请根据文件名、类型和用户问题说明限制。`;
  });

  return `用户随消息附加了以下文件，请把这些附件作为本轮问题的一部分处理。\n\n${blocks.join("\n\n---\n\n")}`;
};

const attachmentFromUserPart = (
  part: AppendMessage["content"][number] | ThreadUserMessagePart,
): MessageAttachment | null => {
  if (part.type === "image") {
    return {
      id: crypto.randomUUID(),
      name: part.filename ?? "image",
      type: "image",
      mimeType: "image/png",
      size: 0,
      dataUrl: part.image,
    };
  }

  if (part.type === "file") {
    return {
      id: crypto.randomUUID(),
      name: part.filename ?? "file",
      type: "file",
      mimeType: part.mimeType || "application/octet-stream",
      size: 0,
      textContent: part.data || undefined,
    };
  }

  return null;
};

const attachmentFromCompleteAttachment = (
  attachment: CompleteAttachment,
): MessageAttachment[] => {
  const size = attachment.file?.size ?? 0;
  const filePath =
    (attachment as CompleteAttachment & { filePath?: string }).filePath ??
    getNovaAttachmentFilePath({
      id: attachment.id,
      name: attachment.name,
      size,
    });
  const fromContent = attachment.content
    .map(attachmentFromUserPart)
    .filter((item): item is MessageAttachment => Boolean(item));

  if (fromContent.length > 0) {
    return fromContent.map((item) => ({
      ...item,
      id: attachment.id || item.id,
      name: attachment.name || item.name,
      mimeType: attachment.contentType || item.mimeType,
      filePath,
      size,
    }));
  }

  const textContent = attachment.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return [
    {
      id: attachment.id,
      name: attachment.name,
      type: attachment.type === "image" ? "image" : "file",
      mimeType: attachment.contentType || "application/octet-stream",
      size,
      textContent: textContent || undefined,
      filePath,
    },
  ];
};

const extractMessageAttachments = (message: AppendMessage) => {
  const byKey = new Map<string, MessageAttachment>();
  const add = (attachment: MessageAttachment | null) => {
    if (!attachment) return;
    const key = [
      attachment.name,
      attachment.type,
      attachment.mimeType,
      attachment.dataUrl ?? attachment.textContent ?? "",
    ].join("\u0000");
    byKey.set(key, attachment);
  };

  message.content.forEach((part) => add(attachmentFromUserPart(part)));
  message.attachments?.forEach((attachment) => {
    attachmentFromCompleteAttachment(attachment).forEach(add);
  });

  return Array.from(byKey.values());
};

const getComposerAttachmentPath = async (attachment: {
  id?: string;
  name: string;
  type: string;
  contentType?: string;
  file?: File;
  filePath?: string;
  content?: readonly (
    | AppendMessage["content"][number]
    | ThreadUserMessagePart
  )[];
}) => {
  const size = attachment.file?.size;
  const filePath =
    attachment.filePath ??
    getNovaAttachmentFilePath({
      id: attachment.id,
      name: attachment.name,
      size,
    }) ??
    (attachment.file
      ? window.novaDesk?.getFilePath?.(attachment.file)
      : undefined);

  rememberNovaAttachmentFilePath({
    id: attachment.id,
    name: attachment.name,
    size,
    filePath,
  });

  return filePath;
};

const openAttachmentPath = async (filePath?: string) => {
  if (!filePath) {
    logger.warn("attachment", "No local file path available for attachment.");
    return;
  }

  const error = await window.novaDesk?.openPath?.(filePath);
  if (error) {
    logger.error("attachment", "Failed to open attachment.", {
      filePath,
      error,
    });
  }
};

type SessionUsageStats = {
  totalTokens: number;
  userTokens: number;
  assistantTokens: number;
  systemTokens: number;
  nextContextTokens: number;
  contextLimit: number;
  contextPercent: number;
  messageCount: number;
};

type ThreadTokenUsageEstimate = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const estimateTextTokens = (value: string) => {
  const cjkMatches = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
  const cjkCount = cjkMatches?.length ?? 0;
  const nonCjkText = value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "");
  const nonCjkCount = Math.ceil(nonCjkText.length / 4);

  return Math.max(0, cjkCount + nonCjkCount);
};

const estimateAttachmentTokens = (attachment: MessageAttachment) => {
  if (attachment.textContent) {
    return estimateTextTokens(attachment.textContent);
  }

  if (attachment.type === "image") {
    return 85;
  }

  return estimateTextTokens(`${attachment.name} ${attachment.mimeType}`);
};

const estimateMessageTokens = (message: ChatMessage) =>
  4 +
  estimateTextTokens(message.content) +
  (message.attachments ?? []).reduce(
    (sum, attachment) => sum + estimateAttachmentTokens(attachment),
    0,
  );

const getContextLimitForModel = (model: string) => {
  const lower = model.toLowerCase();

  if (lower.includes("1m")) return 1_000_000;
  if (lower.includes("256k")) return 256_000;
  if (lower.includes("128k") || lower.includes("k2")) return 128_000;
  if (lower.includes("64k")) return 64_000;
  if (lower.includes("32k")) return 32_000;
  if (lower.includes("16k")) return 16_000;
  if (lower.includes("8k")) return 8_000;
  if (lower.includes("deepseek")) return 64_000;
  if (lower.includes("glm-5") || lower.includes("glm-4.5")) return 128_000;
  if (lower.includes("minimax")) return 128_000;
  if (lower.includes("mimo")) return 128_000;

  return 64_000;
};

const calculateSessionUsage = (
  messages: ChatMessage[],
  draft: string,
  model: string,
): SessionUsageStats => {
  const tokensByRole = messages.reduce(
    (result, message) => {
      result[message.role] += estimateMessageTokens(message);
      return result;
    },
    { assistant: 0, system: 0, user: 0 } satisfies Record<ChatRole, number>,
  );
  const contextMessages = messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .slice(-10);
  const nextContextTokens =
    contextMessages.reduce(
      (sum, message) => sum + estimateMessageTokens(message),
      0,
    ) + estimateTextTokens(draft);
  const totalTokens =
    tokensByRole.user + tokensByRole.assistant + tokensByRole.system;
  const contextLimit = getContextLimitForModel(model);

  return {
    totalTokens,
    userTokens: tokensByRole.user,
    assistantTokens: tokensByRole.assistant,
    systemTokens: tokensByRole.system,
    nextContextTokens,
    contextLimit,
    contextPercent: Math.min(100, (nextContextTokens / contextLimit) * 100),
    messageCount: messages.length,
  };
};

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
};

export const WorkspacePage = () => {
  const location = useLocation();
  const activePanel = new URLSearchParams(location.search).get("panel");
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const activeProvider = useWorkspaceStore((state) => state.activeProvider);
  const activeChatId = useWorkspaceStore((state) => state.activeChatId);
  const activeChat = useWorkspaceStore((state) => state.activeChat());
  const getActiveModelConfig = useWorkspaceStore(
    (state) => state.getActiveModelConfig,
  );
  const modelConfigs = useWorkspaceStore((state) => state.modelConfigs);
  const appendMessage = useWorkspaceStore((state) => state.appendMessage);
  const renameChat = useWorkspaceStore((state) => state.renameChat);
  const setActiveModelSelection = useWorkspaceStore(
    (state) => state.setActiveModelSelection,
  );
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen);
  const updateMessage = useWorkspaceStore((state) => state.updateMessage);
  const streamingChatIds = useWorkspaceStore((state) => state.streamingChatIds);
  const setChatStreaming = useWorkspaceStore((state) => state.setChatStreaming);
  const addTokenUsageRecord = useTokenUsageStore((state) => state.addRecord);
  const matchSkills = useSkillStore((state) => state.matchSkills);
  const builtinSkills = useSkillStore((state) => state.builtinSkills);
  const customSkills = useSkillStore((state) => state.customSkills);
  const [input, setInput] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeChatIdRef = useRef(activeChatId);
  const streamQueuesRef = useRef(new Map<string, string>());
  const typewriterRefs = useRef(new Map<string, number>());
  const receivedChunkRefs = useRef(new Map<string, boolean>());
  const hasMessages = activeChat.messages.length > 0;
  const activeChatIsStreaming = streamingChatIds.has(activeChat.id);
  const configuredModelOptions = useMemo(
    () => getConfiguredModelOptions(modelConfigs),
    [modelConfigs],
  );
  const skillOptions = useMemo(
    () => [...builtinSkills, ...customSkills].filter((skill) => skill.enabled),
    [builtinSkills, customSkills],
  );
  const selectedSkills = useMemo(
    () =>
      selectedSkillIds
        .map((id) => skillOptions.find((skill) => skill.id === id))
        .filter((skill): skill is SkillConfig => Boolean(skill)),
    [selectedSkillIds, skillOptions],
  );
  const activeModelOption = useMemo(
    () =>
      configuredModelOptions.find(
        (option) =>
          option.provider === activeProvider && option.model === activeModel,
      ) ?? configuredModelOptions[0],
    [activeModel, activeProvider, configuredModelOptions],
  );
  const sessionUsageStats = useMemo(
    () => calculateSessionUsage(activeChat.messages, "", activeModel),
    [activeChat.messages, activeModel],
  );
  const [displayedStats, setDisplayedStats] = useState(sessionUsageStats);

  useEffect(() => {
    if (!activeChatIsStreaming) {
      setDisplayedStats(sessionUsageStats);
    }
  }, [activeChatIsStreaming, sessionUsageStats]);

  const lastMessageContent = activeChat.messages.at(-1)?.content ?? "";

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [activeChat.id, activeChat.messages.length, lastMessageContent]);

  useEffect(() => {
    return () => {
      typewriterRefs.current.forEach((timer) => window.clearInterval(timer));
      typewriterRefs.current.clear();
    };
  }, []);

  const markChatStreaming = (chatId: string, streaming: boolean) => {
    setChatStreaming(chatId, streaming);
  };

  const appendToMessage = (
    chatId: string,
    messageId: string,
    chunk: string,
  ) => {
    updateMessage(chatId, messageId, (message) => ({
      ...message,
      content: `${message.content}${chunk}`,
    }));
  };

  const stopTypewriter = (chatId: string) => {
    const timer = typewriterRefs.current.get(chatId);

    if (timer) {
      window.clearInterval(timer);
      typewriterRefs.current.delete(chatId);
    }
  };

  const waitForTypewriterDrain = (chatId: string) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (
          !streamQueuesRef.current.get(chatId) &&
          !typewriterRefs.current.has(chatId)
        ) {
          resolve();
          return;
        }

        window.setTimeout(check, 24);
      };

      check();
    });

  const enqueueAssistantText = (
    chatId: string,
    messageId: string,
    chunk: string,
  ) => {
    if (!chunk) {
      return;
    }

    receivedChunkRefs.current.set(chatId, true);
    streamQueuesRef.current.set(
      chatId,
      `${streamQueuesRef.current.get(chatId) ?? ""}${chunk}`,
    );

    if (typewriterRefs.current.has(chatId)) {
      return;
    }

    const timer = window.setInterval(() => {
      const queued = streamQueuesRef.current.get(chatId) ?? "";

      if (!queued) {
        stopTypewriter(chatId);
        return;
      }

      const next = nextTypewriterChunk(queued);
      streamQueuesRef.current.set(chatId, queued.slice(next.length));
      appendToMessage(chatId, messageId, next);
    }, 18);

    typewriterRefs.current.set(chatId, timer);
  };

  const submitPrompt = async (
    rawPrompt: string,
    attachments?: MessageAttachment[],
  ) => {
    const prompt = rawPrompt.trim();
    const chat = activeChat;
    const chatId = chat.id;

    logger.info("submit", "submitPrompt 调用", {
      promptLength: prompt.length,
      attachmentCount: attachments?.length ?? 0,
      attachments: attachments?.map((a) => ({
        name: a.name,
        type: a.type,
        hasDataUrl: Boolean(a.dataUrl),
        hasTextContent: Boolean(a.textContent),
      })),
    });

    if ((!prompt && !attachments?.length) || streamingChatIds.has(chatId)) {
      return;
    }

    const explicitSkillPrompt = selectedSkills
      .map((skill) => `@skill:${skill.name}`)
      .join(" ");
    const promptForSkillMatch = explicitSkillPrompt
      ? `${explicitSkillPrompt} ${prompt}`
      : prompt;
    const { applied, injectedContext } = matchSkills(promptForSkillMatch);

    const attachmentPrompt = buildAttachmentPrompt(attachments);
    const promptWithAttachments = [prompt, attachmentPrompt]
      .filter((part) => part.trim().length > 0)
      .join("\n\n---\n\n");

    const enhancedPrompt = injectedContext
      ? `${injectedContext}\n\n---\n\n${promptWithAttachments}`
      : promptWithAttachments;

    const assistantMessage = createMessage("assistant", "");
    const hasImageAttachments = Boolean(
      attachments?.some(
        (attachment) => attachment.type === "image" && attachment.dataUrl,
      ),
    );
    const promptForModel = hasImageAttachments
      ? enhancedPrompt
      : buildPromptWithHistory(chat.messages, enhancedPrompt);

    setInput("");
    setSelectedSkillIds([]);
    markChatStreaming(chatId, true);
    streamQueuesRef.current.set(chatId, "");
    receivedChunkRefs.current.set(chatId, false);
    stopTypewriter(chatId);
    appendMessage(chatId, createMessage("user", prompt, applied, attachments));
    appendMessage(chatId, assistantMessage);

    if (chat.title === "新对话") {
      renameChat(chatId, prompt.slice(0, 28));
    }

    try {
      const result = await streamHermesMessage(
        promptForModel,
        null,
        (chunk) => enqueueAssistantText(chatId, assistantMessage.id, chunk),
        getActiveModelConfig(),
        attachments,
      );

      if (result.text && !receivedChunkRefs.current.get(chatId)) {
        enqueueAssistantText(chatId, assistantMessage.id, result.text);
      }

      await waitForTypewriterDrain(chatId);

      addTokenUsageRecord({
        provider: activeProvider,
        model: activeModel,
        inputTokens:
          estimateTextTokens(promptForModel) +
          (attachments ?? []).reduce(
            (sum, attachment) => sum + estimateAttachmentTokens(attachment),
            0,
          ),
        outputTokens: estimateTextTokens(
          result.text ||
            activeChat.messages.find((message) => message.id === assistantMessage.id)
              ?.content ||
            "",
        ),
      });

      updateMessage(chatId, assistantMessage.id, (message) =>
        message.content
          ? message
          : {
              ...message,
              content:
                result.text || "Hermes Agent returned an empty response.",
            },
      );
    } catch (error) {
      stopTypewriter(chatId);
      streamQueuesRef.current.set(chatId, "");
      receivedChunkRefs.current.set(chatId, false);

      const message =
        error instanceof Error ? error.message : "Hermes Agent request failed.";

      updateMessage(chatId, assistantMessage.id, (item) => ({
        ...item,
        role: "system",
        content: message,
      }));
    } finally {
      markChatStreaming(chatId, false);
      streamQueuesRef.current.delete(chatId);
      receivedChunkRefs.current.delete(chatId);

      if (activeChatIdRef.current === chatId) {
        inputRef.current?.focus();
      }
    }
  };

  const handleSubmit = () => {};

  const attachmentAdapter = useMemo(() => new NovaAttachmentAdapter(), []);

  const assistantRuntime = useExternalStoreRuntime<ChatMessage>({
    messages: activeChat.messages,
    isRunning: activeChatIsStreaming,
    isSendDisabled: activeChatIsStreaming,
    convertMessage: toAssistantThreadMessage,
    adapters: {
      attachments: attachmentAdapter,
    },
    onNew: async (message) => {
      logger.info("assistant-ui", "onNew 收到消息", {
        contentParts: message.content.map((p) => ({
          type: p.type,
          hasImage: p.type === "image" ? Boolean(p.image) : undefined,
          hasData: p.type === "file" ? Boolean(p.data) : undefined,
          filename:
            p.type === "image" || p.type === "file" ? p.filename : undefined,
        })),
        attachments: message.attachments?.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          contentType: attachment.contentType,
          contentParts: attachment.content.map((part) => ({
            type: part.type,
            hasImage: part.type === "image" ? Boolean(part.image) : undefined,
            hasData: part.type === "file" ? Boolean(part.data) : undefined,
            filename:
              part.type === "image" || part.type === "file"
                ? part.filename
                : undefined,
          })),
        })),
      });

      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();

      const extractedAttachments = extractMessageAttachments(message);

      await submitPrompt(
        text,
        extractedAttachments.length > 0 ? extractedAttachments : undefined,
      );
    },
  });

  if (activePanel === "skills") {
    return <SkillsPage />;
  }

  if (activePanel === "scheduled-tasks") {
    return <ScheduledTasksPage />;
  }

  if (activePanel === "logs") {
    return <LogViewerPage />;
  }

  if (activePanel === "token-usage") {
    return <TokenUsagePage />;
  }

  return (
    <AssistantRuntimeProvider runtime={assistantRuntime}>
      <ThreadPrimitive.Root className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
          <ThreadPrimitive.Viewport
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth ${
              hasMessages
                ? "px-1 pb-6 pt-10"
                : "flex items-center justify-center"
            }`}
          >
            {hasMessages ? (
              <div className="space-y-7">
                <ThreadPrimitive.Messages>
                  {({ message }) => {
                    const sourceMessage =
                      activeChat.messages.find(
                        (item) => item.id === message.id,
                      ) ??
                      ({
                        id: message.id,
                        role: message.role,
                        content: message.content
                          .filter((part) => part.type === "text")
                          .map((part) => part.text)
                          .join(""),
                      } satisfies ChatMessage);

                    return (
                      <MessageBlock
                        message={sourceMessage}
                        isStreaming={
                          activeChatIsStreaming &&
                          message.id ===
                            activeChat.messages[activeChat.messages.length - 1]
                              ?.id
                        }
                      />
                    );
                  }}
                </ThreadPrimitive.Messages>
                <div ref={bottomRef} />
              </div>
            ) : (
              <div className="w-full max-w-3xl">
                <div className="mb-7 text-center">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#7b8494]">
                    Nova Desk
                  </div>
                  <h1 className="text-3xl font-semibold tracking-normal text-[#14171f]">
                    要在本地工作区处理什么？
                  </h1>
                </div>
                <ChatComposer
                  activeModelOption={activeModelOption}
                  configuredModelOptions={configuredModelOptions}
                  input={input}
                  inputRef={inputRef}
                  isStreaming={activeChatIsStreaming}
                  onChange={setInput}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onSelectModel={(option) =>
                    setActiveModelSelection(option.provider, option.model)
                  }
                  onSubmit={handleSubmit}
                  sessionUsageStats={displayedStats}
                  selectedSkills={selectedSkills}
                  onSelectSkill={(skill) =>
                    setSelectedSkillIds((ids) =>
                      ids.includes(skill.id) ? ids : [...ids, skill.id],
                    )
                  }
                  onRemoveSkill={(skillId) =>
                    setSelectedSkillIds((ids) =>
                      ids.filter((id) => id !== skillId),
                    )
                  }
                  skillOptions={skillOptions}
                />
              </div>
            )}
          </ThreadPrimitive.Viewport>

          {hasMessages ? (
            <div className="shrink-0 bg-[#f8f9fb] pb-6 pt-3">
              <ChatComposer
                activeModelOption={activeModelOption}
                configuredModelOptions={configuredModelOptions}
                input={input}
                inputRef={inputRef}
                isStreaming={activeChatIsStreaming}
                onChange={setInput}
                onOpenSettings={() => setSettingsOpen(true)}
                onSelectModel={(option) =>
                  setActiveModelSelection(option.provider, option.model)
                }
                onSubmit={handleSubmit}
                sessionUsageStats={displayedStats}
                selectedSkills={selectedSkills}
                onSelectSkill={(skill) =>
                  setSelectedSkillIds((ids) =>
                    ids.includes(skill.id) ? ids : [...ids, skill.id],
                  )
                }
                onRemoveSkill={(skillId) =>
                  setSelectedSkillIds((ids) =>
                    ids.filter((id) => id !== skillId),
                  )
                }
                skillOptions={skillOptions}
              />
            </div>
          ) : null}
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};

const ContextDisplay = ({
  stats,
  usage,
}: {
  stats: SessionUsageStats;
  usage: ThreadTokenUsageEstimate;
}) => {
  const contextPercentLabel = `${stats.contextPercent.toFixed(
    stats.contextPercent >= 10 ? 0 : 1,
  )}%`;

  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex h-8 min-w-[126px] items-center gap-2 rounded-md px-1.5 text-xs text-[#667085] transition hover:bg-white/70 hover:text-[#1f2937]"
        aria-label="当前会话上下文使用量"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="whitespace-nowrap">
          {formatTokenCount(stats.nextContextTokens)} /{" "}
          {formatTokenCount(stats.contextLimit)}
        </span>
        <span className="ml-auto text-[#8a94a6]">{contextPercentLabel}</span>
      </button>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-40 w-72 translate-y-1 rounded-xl border border-[#e2e7ef] bg-white p-3 text-xs text-[#5f6877] opacity-0 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)] transition group-hover:translate-y-0 group-hover:opacity-100">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium text-[#1f2937]">Context</span>
          <span className="text-[#9aa3b2]">估算</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#edf1f6]">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: contextPercentLabel }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <UsageStat label="输入" value={formatTokenCount(usage.inputTokens)} />
          <UsageStat
            label="输出"
            value={formatTokenCount(usage.outputTokens)}
          />
          <UsageStat label="消息" value={`${stats.messageCount}`} />
          <UsageStat label="总量" value={formatTokenCount(usage.totalTokens)} />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#edf1f6] pt-2 text-[#7b8494]">
          <span>下次请求上下文</span>
          <span>
            {formatTokenCount(stats.nextContextTokens)} /{" "}
            {formatTokenCount(stats.contextLimit)}
          </span>
        </div>
      </div>
    </div>
  );
};

ContextDisplay.Bar = function ContextDisplayBar({
  stats,
}: {
  stats: SessionUsageStats;
}) {
  const usage: ThreadTokenUsageEstimate = {
    inputTokens: stats.userTokens + stats.systemTokens,
    outputTokens: stats.assistantTokens,
    totalTokens: stats.totalTokens,
  };

  return <ContextDisplay stats={stats} usage={usage} />;
};

const UsageStat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-lg bg-[#f6f8fb] px-3 py-2">
    <div className="text-[11px] leading-4 text-[#7b8494]">{label}</div>
    <div className="truncate text-sm font-semibold leading-5 text-[#1f2937]">
      {value}
    </div>
  </div>
);

const ContextOnlyDisplay = ({ stats }: { stats: SessionUsageStats }) => {
  const contextPercentLabel = `${stats.contextPercent.toFixed(
    stats.contextPercent >= 10 ? 0 : 1,
  )}%`;

  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex h-8 min-w-[126px] items-center gap-2 rounded-md px-1.5 text-xs text-[#667085] transition hover:bg-white/70 hover:text-[#1f2937]"
        aria-label="当前会话上下文使用量"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="whitespace-nowrap">
          {formatTokenCount(stats.nextContextTokens)} /{" "}
          {formatTokenCount(stats.contextLimit)}
        </span>
        <span className="ml-auto text-[#8a94a6]">{contextPercentLabel}</span>
      </button>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-40 w-72 translate-y-1 rounded-xl border border-[#e2e7ef] bg-white p-3 text-xs text-[#5f6877] opacity-0 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)] transition group-hover:translate-y-0 group-hover:opacity-100">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium text-[#1f2937]">Context</span>
          <span className="text-[#9aa3b2]">估算</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#edf1f6]">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: contextPercentLabel }}
          />
        </div>
        <div className="flex items-center justify-between text-[#7b8494]">
          <span>下次请求上下文</span>
          <span>
            {formatTokenCount(stats.nextContextTokens)} /{" "}
            {formatTokenCount(stats.contextLimit)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#edf1f6] pt-2 text-[#7b8494]">
          <span>消息数</span>
          <span>{stats.messageCount}</span>
        </div>
      </div>
    </div>
  );
};

const TokenUsageDisplay = ({ stats }: { stats: SessionUsageStats }) => (
  <div className="group relative">
    <button
      type="button"
      className="inline-flex h-8 items-center gap-2 rounded-md px-1.5 text-xs text-[#667085] transition hover:bg-white/70 hover:text-[#1f2937]"
      aria-label="当前会话 token 消耗"
    >
      <span className="whitespace-nowrap">
        Tokens {formatTokenCount(stats.totalTokens)}
      </span>
    </button>
    <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-40 w-60 translate-y-1 rounded-xl border border-[#e2e7ef] bg-white p-3 text-xs text-[#5f6877] opacity-0 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)] transition group-hover:translate-y-0 group-hover:opacity-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-[#1f2937]">Token 消耗</span>
        <span className="text-[#9aa3b2]">估算</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <UsageStat label="用户" value={formatTokenCount(stats.userTokens)} />
        <UsageStat
          label="助手"
          value={formatTokenCount(stats.assistantTokens)}
        />
        <UsageStat label="系统" value={formatTokenCount(stats.systemTokens)} />
        <UsageStat label="总量" value={formatTokenCount(stats.totalTokens)} />
      </div>
    </div>
  </div>
);

const AttachmentPreview = ({
  attachment,
}: {
  attachment: {
    content?: readonly { type: string; image?: string }[];
    name: string;
    type: string;
  };
}) => {
  const imagePart = attachment.content?.find(
    (part): part is { type: "image"; image: string } =>
      part.type === "image" && typeof part.image === "string",
  );

  if (imagePart) {
    return (
      <img
        src={imagePart.image}
        alt={attachment.name}
        className="h-8 w-8 shrink-0 rounded object-cover"
      />
    );
  }

  const extension = attachment.name.includes(".")
    ? attachment.name.split(".").pop()
    : attachment.type;

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold uppercase text-primary">
      {extension}
    </span>
  );
};

const ChatComposer = ({
  activeModelOption,
  configuredModelOptions,
  input,
  inputRef,
  isStreaming,
  onChange,
  onOpenSettings,
  onSelectModel,
  onSubmit,
  sessionUsageStats,
  selectedSkills,
  onSelectSkill,
  onRemoveSkill,
  skillOptions,
}: {
  activeModelOption?: ConfiguredModelOption;
  configuredModelOptions: ConfiguredModelOption[];
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onOpenSettings: () => void;
  onSelectModel: (option: ConfiguredModelOption) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  sessionUsageStats: SessionUsageStats;
  selectedSkills: SkillConfig[];
  onSelectSkill: (skill: SkillConfig) => void;
  onRemoveSkill: (skillId: string) => void;
  skillOptions: SkillConfig[];
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [slashCaret, setSlashCaret] = useState(input.length);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const hasMultipleModels = configuredModelOptions.length > 1;
  const currentModelLabel = activeModelOption?.model ?? "";
  const slashState = useMemo(() => {
    const beforeCaret = input.slice(0, slashCaret);
    const match = beforeCaret.match(/(^|\s)\/([^\s/]*)$/);
    if (!match) return null;
    return {
      start: beforeCaret.length - match[2].length - 1,
      query: match[2].toLowerCase(),
    };
  }, [input, slashCaret]);
  const filteredSkillOptions = useMemo(() => {
    if (!slashState) return [];
    return skillOptions
      .filter((skill) => {
        const haystack = [
          skill.name,
          skill.description,
          skill.id,
          ...skill.triggers,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(slashState.query);
      })
      .slice(0, 8);
  }, [skillOptions, slashState]);
  const isSkillMenuOpen = Boolean(
    slashState && filteredSkillOptions.length > 0,
  );

  const updateCaretFromTextarea = (textarea: HTMLTextAreaElement) => {
    setSlashCaret(textarea.selectionStart ?? textarea.value.length);
  };

  const selectSkill = (skill: SkillConfig) => {
    if (!slashState) return;
    const nextInput =
      `${input.slice(0, slashState.start)}${input.slice(slashCaret)}`.replace(
        /\s{2,}/g,
        " ",
      );
    const nextCaret = slashState.start;
    onSelectSkill(skill);
    onChange(nextInput);
    setSlashCaret(nextCaret);
    setActiveSkillIndex(0);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  useEffect(() => {
    if (!isModelMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node))
        setIsModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isModelMenuOpen]);

  useEffect(() => {
    setActiveSkillIndex(0);
  }, [slashState?.query]);

  const buildKeyDown =
    (
      showSkillBackspace: boolean,
    ): React.KeyboardEventHandler<HTMLTextAreaElement> =>
    (event) => {
      if (isSkillMenuOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSkillIndex((i) => (i + 1) % filteredSkillOptions.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveSkillIndex(
            (i) =>
              (i - 1 + filteredSkillOptions.length) %
              filteredSkillOptions.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          selectSkill(filteredSkillOptions[activeSkillIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashCaret(0);
          return;
        }
      }
      if (
        showSkillBackspace &&
        event.key === "Backspace" &&
        !input &&
        selectedSkills.length > 0
      ) {
        event.preventDefault();
        onRemoveSkill(selectedSkills[selectedSkills.length - 1].id);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    };

  const renderInput = (className: string, showSkillBackspace: boolean) => (
    <ComposerPrimitive.Input
      ref={inputRef}
      className={className}
      placeholder="向 Nova Desk 询问任何事情…"
      rows={3}
      value={input}
      onChange={(event) => {
        onChange(event.target.value);
        updateCaretFromTextarea(event.target);
      }}
      onClick={(event) => updateCaretFromTextarea(event.currentTarget)}
      onKeyUp={(event) => updateCaretFromTextarea(event.currentTarget)}
      onKeyDown={buildKeyDown(showSkillBackspace)}
    />
  );

  return (
    <ComposerPrimitive.Root
      className="relative overflow-visible rounded-2xl border border-[#dfe4ec] bg-white shadow-[0_10px_28px_rgb(17_24_39_/_0.06)]"
      onSubmit={onSubmit}
    >
      <ComposerPrimitive.AttachmentDropzone className="contents">
        {isSkillMenuOpen ? (
          <div
            role="listbox"
            className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-full overflow-hidden rounded-2xl border border-[#e2e6ee] bg-white py-1.5 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)]"
          >
            {filteredSkillOptions.map((skill, index) => {
              const active = index === activeSkillIndex;
              return (
                <button
                  key={skill.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left transition ${active ? "bg-[#f4f6f9]" : "hover:bg-[#f8fafc]"}`}
                  onMouseEnter={() => setActiveSkillIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSkill(skill);
                  }}
                >
                  <Package size={15} className="shrink-0 text-[#697386]" />
                  <span className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
                    <span className="text-sm font-medium text-[#1f2430]">
                      {skill.name}
                    </span>
                    <span className="truncate text-xs text-[#7b8494]">
                      {skill.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[#7b8494]">
                    {skill.source === "builtin" ? "内置" : "个人"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-center ml-5 mt-3 gap-2">
          <ComposerPrimitive.Attachments>
            {({ attachment }) => (
              <AttachmentPrimitive.Root className="group relative inline-flex max-w-[220px] items-center gap-2 rounded-lg bg-[#f6f8fb] py-1.5 pl-1.5 pr-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title="用系统默认程序打开"
                  onClick={() => {
                    void getComposerAttachmentPath(attachment).then(
                      openAttachmentPath,
                    );
                  }}
                >
                  <AttachmentPreview attachment={attachment} />
                  <span className="min-w-0 flex-1 truncate text-xs text-[#374151]">
                    {attachment.name}
                  </span>
                </button>
                <AttachmentPrimitive.Remove className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#9ca3af] opacity-0 transition hover:bg-[#e5e7eb] hover:text-[#374151] group-hover:opacity-100">
                  <X size={10} />
                </AttachmentPrimitive.Remove>
              </AttachmentPrimitive.Root>
            )}
          </ComposerPrimitive.Attachments>
        </div>

        {selectedSkills.length > 0 ? (
          <div className="min-h-20 px-5 py-4">
            {selectedSkills.map((skill) => (
              <span
                key={skill.id}
                className="mr-2 inline-flex h-6 items-center gap-1.5 rounded-md px-0 text-sm font-medium text-primary"
              >
                <Package size={14} />
                <span>{skill.name}</span>
              </span>
            ))}
            {renderInput(
              "mt-2 block min-h-[64px] max-h-44 w-full resize-none border-0 bg-transparent p-0 text-sm text-[#1f2430] outline-none placeholder:text-[#aeb5c1]",
              true,
            )}
          </div>
        ) : null}
        {selectedSkills.length === 0
          ? renderInput(
              "min-h-20 max-h-44 w-full resize-none rounded-t-2xl border-0 bg-white px-5 py-4 text-sm text-[#1f2430] outline-none placeholder:text-[#aeb5c1]",
              false,
            )
          : null}
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-b-2xl px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-[#717782]">
            <ComposerPrimitive.AddAttachment
              multiple
              aria-label="上传文件"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] transition hover:bg-white/70 hover:text-[#1f2937]"
            >
              <Plus size={16} />
            </ComposerPrimitive.AddAttachment>
            <span className="text-[#667085]">Nova Desk</span>
            <ContextOnlyDisplay stats={sessionUsageStats} />
            <TokenUsageDisplay stats={sessionUsageStats} />
          </div>
          <div className="flex items-center gap-2">
            <div ref={modelMenuRef} className="relative">
              {configuredModelOptions.length === 0 ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-sm text-[#4b5563] hover:text-primary"
                  onClick={onOpenSettings}
                >
                  配置模型
                </button>
              ) : (
                <button
                  type="button"
                  aria-haspopup={hasMultipleModels ? "listbox" : undefined}
                  aria-expanded={
                    hasMultipleModels ? isModelMenuOpen : undefined
                  }
                  className="inline-flex h-8 max-w-[180px] items-center gap-1 rounded-md px-2.5 text-xs text-[#1f2430] transition hover:bg-white/70"
                  onClick={() => {
                    if (hasMultipleModels) setIsModelMenuOpen((open) => !open);
                  }}
                >
                  <span className="truncate">{currentModelLabel}</span>
                  {hasMultipleModels ? <ChevronDown size={13} /> : null}
                </button>
              )}
              {hasMultipleModels && isModelMenuOpen ? (
                <div
                  role="listbox"
                  className="absolute bottom-9 left-0 z-20 w-56 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white py-1.5 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)]"
                >
                  {configuredModelOptions.map((option) => {
                    const selected =
                      activeModelOption?.provider === option.provider &&
                      activeModelOption.model === option.model;
                    return (
                      <button
                        key={`${option.provider}:${option.model}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition ${selected ? "bg-[#f8fafc]" : "hover:bg-[#f4f6f9]"}`}
                        onClick={() => {
                          onSelectModel(option);
                          setIsModelMenuOpen(false);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm leading-5 text-[#111827]">
                            {option.model}
                          </span>
                          <span className="block truncate text-xs leading-4 text-[#6b7280]">
                            {option.providerName}
                          </span>
                        </span>
                        {selected ? (
                          <Check
                            className="ml-2 shrink-0 text-primary"
                            size={15}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Voice input"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] transition hover:bg-white/70 hover:text-[#1f2937]"
            >
              <Mic size={15} />
            </button>
            <ComposerPrimitive.Send
              aria-label="Send message"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#69707b] text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-[#c9cdd3]"
            >
              {isStreaming ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <Send size={16} />
              )}
            </ComposerPrimitive.Send>
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const MessageBlock = ({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) => {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isThinking = isStreaming && !isUser && !isSystem && !message.content;
  const hasSkills =
    isUser && message.appliedSkills && message.appliedSkills.length > 0;
  const hasAttachments =
    isUser && message.attachments && message.attachments.length > 0;

  return (
    <MessagePrimitive.Root
      className={`group/message flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[78%] ${isUser ? "flex flex-col items-end gap-1.5" : ""}`}
      >
        {hasSkills ? (
          <div className="flex flex-wrap items-center gap-1">
            <Sparkles size={12} className="text-primary/60" />
            {message.appliedSkills!.map((skill) => (
              <span
                key={skill.id}
                className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              >
                {skill.name}
              </span>
            ))}
          </div>
        ) : null}
        {hasAttachments ? (
          <div className="flex flex-wrap gap-2">
            {message.attachments!.map((att) =>
              att.type === "image" && att.dataUrl ? (
                <button
                  key={att.id}
                  type="button"
                  className="group/attachment relative overflow-hidden rounded-xl border border-white/20"
                  title="用系统默认程序打开"
                  onClick={() =>
                    void openAttachmentPath(
                      att.filePath ??
                        getNovaAttachmentFilePath({
                          id: att.id,
                          name: att.name,
                          size: att.size,
                        }),
                    )
                  }
                >
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    className="max-h-40 object-cover transition group-hover/attachment:brightness-95"
                  />
                </button>
              ) : (
                <button
                  key={att.id}
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-[#dfe4ec] bg-white px-2.5 py-1.5 text-left text-xs text-[#374151] shadow-sm transition hover:border-primary/40 hover:text-primary"
                  title="用系统默认程序打开"
                  onClick={() =>
                    void openAttachmentPath(
                      att.filePath ??
                        getNovaAttachmentFilePath({
                          id: att.id,
                          name: att.name,
                          size: att.size,
                        }),
                    )
                  }
                >
                  <FileText size={12} className="text-primary" />
                  <span className="max-w-[100px] truncate">{att.name}</span>
                </button>
              ),
            )}
          </div>
        ) : null}
        {message.content || !isUser || !hasAttachments ? (
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
              isUser
                ? "whitespace-pre-wrap bg-primary text-white"
                : isSystem
                  ? "border border-secondary/20 bg-secondary/10 text-[#1f2430]"
                  : "bg-transparent text-[#1f2430]"
            }`}
          >
            {isThinking ? (
              <ThinkingBubble />
            ) : isUser ? (
              message.content
            ) : (
              <MarkdownMessage content={message.content} />
            )}
            {isStreaming && !isUser && !isThinking ? (
              <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-primary align-middle" />
            ) : null}
          </div>
        ) : null}
        <div
          className={`mt-1 flex items-center gap-1.5 text-[#8a94a6] ${
            isUser ? "justify-end" : "justify-start"
          }`}
        >
          <MessageActions />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const MessageActions = () => (
  <>
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#e1e6ef] bg-white px-1 opacity-0 shadow-sm transition group-hover/message:opacity-100"
    >
      <BranchPickerPrimitive.Previous
        aria-label="Previous response"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#6b7280] hover:bg-[#f3f5f8] hover:text-[#111827] disabled:opacity-40"
      >
        <ChevronLeft size={13} />
      </BranchPickerPrimitive.Previous>
      <span className="px-1 text-[11px] text-[#667085]">
        <BranchPickerPrimitive.Number />/
        <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next
        aria-label="Next response"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#6b7280] hover:bg-[#f3f5f8] hover:text-[#111827] disabled:opacity-40"
      >
        <ChevronRight size={13} />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
    <ActionBarPrimitive.Root
      autohide="never"
      hideWhenRunning
      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#e1e6ef] bg-white px-1 opacity-0 shadow-sm transition group-hover/message:opacity-100"
    >
      <ActionBarPrimitive.Copy
        copiedDuration={1600}
        aria-label="Copy message"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#6b7280] hover:bg-[#f3f5f8] hover:text-[#111827] disabled:opacity-40 data-[copied]:text-primary"
      >
        <Copy size={13} />
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  </>
);

/*
const AttachmentViewer = ({
  attachment,
  onClose,
}: {
  attachment: AttachmentViewerData | null;
  onClose: () => void;
}) => {
  if (!attachment) return null;

  const hasText = Boolean(attachment.textContent?.trim());
  const canPreviewImage = attachment.type === "image" && attachment.dataUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgb(15_23_42_/_0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[#edf0f4] px-5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#111827]">
              {attachment.name}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[#7b8494]">
              <span>{attachment.mimeType || "unknown"}</span>
              {typeof attachment.size === "number" && attachment.size > 0 ? (
                <span>{formatBytes(attachment.size)}</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#667085] transition hover:bg-[#f4f6f9] hover:text-[#111827]"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {canPreviewImage ? (
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="mx-auto max-h-[68vh] max-w-full rounded-xl object-contain"
            />
          ) : hasText ? (
            <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-xl border border-[#e5e9f0] bg-[#f8fafc] p-4 text-xs leading-5 text-[#1f2937]">
              {attachment.textContent}
            </pre>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[#d8dee8] bg-[#f8fafc] px-6 text-center">
              <FileText size={24} className="mb-3 text-[#9aa4b2]" />
              <div className="text-sm font-medium text-[#374151]">
                暂时无法预览文件正文
              </div>
              <div className="mt-1 text-xs text-[#7b8494]">
                已保存文件名、类型和大小，发送时会作为附件信息提供给 agent。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
*/

const MarkdownMessage = ({ content }: { content: string }) => (
  <div className="markdown-message">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripHermesDiagnostics(content)}</ReactMarkdown>
  </div>
);

const ThinkingBubble = () => (
  <span className="inline-flex items-center gap-2 text-[#6b7280]">
    <span>正在思考中</span>
    <span className="inline-flex h-4 items-end gap-0.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-[thinking-wave_0.9s_ease-in-out_infinite] rounded-full bg-primary"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  </span>
);
