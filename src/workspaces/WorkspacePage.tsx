import {
  Check,
  ChevronDown,
  FileText,
  Image,
  Loader2,
  Mic,
  Package,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Dropdown } from "antd";
import {
  FormEvent,
  KeyboardEvent,
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
  streamHermesMessage,
  type ChatMessage,
  type MessageAttachment,
} from "../api/hermes";
import {
  getConfiguredModelOptions,
  type ConfiguredModelOption,
} from "../config/modelProviders";
import { useSkillStore } from "../state/skillStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { SkillsPage } from "../skills/SkillsPage";
import { ScheduledTasksPage } from "../scheduled-tasks/ScheduledTasksPage";
import { LogViewerPage } from "../logs/LogViewerPage";
import type { AppliedSkill, SkillConfig } from "../types/skill";

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

const maxAttachmentTextLength = 20_000;

const imageAttachmentExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
]);

const getFileExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
};

const isImageAttachmentFile = (file: File) =>
  file.type.startsWith("image/") ||
  imageAttachmentExtensions.has(getFileExtension(file.name));

const isReadableTextAttachment = (file: File) => {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    [
      ".txt",
      ".md",
      ".json",
      ".csv",
      ".tsv",
      ".yaml",
      ".yml",
      ".xml",
      ".html",
      ".css",
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".py",
      ".java",
      ".go",
      ".rs",
    ].some((ext) => name.endsWith(ext))
  );
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const buildAttachmentPrompt = (attachments?: MessageAttachment[]) => {
  if (!attachments?.length) {
    return "";
  }

  const nonImageAttachments = attachments.filter((attachment) => attachment.type !== "image");
  if (nonImageAttachments.length === 0) {
    return "";
  }

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

  return `用户随消息附加了以下图片或文件，请把这些附件作为本轮问题的一部分处理。\n\n${blocks.join("\n\n---\n\n")}`;
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

  const canSend = useMemo(
    () => input.trim().length > 0 && !activeChatIsStreaming,
    [activeChatIsStreaming, input],
  );
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

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
    attachments?: MessageAttachment[],
  ) => {
    event.preventDefault();

    const prompt = input.trim();
    const chat = activeChat;
    const chatId = chat.id;

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
      attachments?.some((attachment) => attachment.type === "image" && attachment.dataUrl),
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

  if (activePanel === "skills") {
    return <SkillsPage />;
  }

  if (activePanel === "scheduled-tasks") {
    return <ScheduledTasksPage />;
  }

  if (activePanel === "logs") {
    return <LogViewerPage />;
  }

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth ${
            hasMessages ? "px-1 pb-6 pt-10" : "flex items-center justify-center"
          }`}
        >
          {hasMessages ? (
            <div className="space-y-7">
              {activeChat.messages.map((message) => (
                <MessageBlock
                  key={message.id}
                  message={message}
                  isStreaming={
                    activeChatIsStreaming &&
                    message.id ===
                      activeChat.messages[activeChat.messages.length - 1]?.id
                  }
                />
              ))}
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
                activeModel={activeModel}
                activeModelOption={activeModelOption}
                canSend={canSend}
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
        </div>

        {hasMessages ? (
          <div className="shrink-0 bg-[#f8f9fb] pb-6 pt-3">
            <ChatComposer
              activeModel={activeModel}
              activeModelOption={activeModelOption}
              canSend={canSend}
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
              selectedSkills={selectedSkills}
              onSelectSkill={(skill) =>
                setSelectedSkillIds((ids) =>
                  ids.includes(skill.id) ? ids : [...ids, skill.id],
                )
              }
              onRemoveSkill={(skillId) =>
                setSelectedSkillIds((ids) => ids.filter((id) => id !== skillId))
              }
              skillOptions={skillOptions}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
};

const ChatComposer = ({
  activeModel,
  activeModelOption,
  canSend,
  configuredModelOptions,
  input,
  inputRef,
  isStreaming,
  onChange,
  onOpenSettings,
  onSelectModel,
  onSubmit,
  selectedSkills,
  onSelectSkill,
  onRemoveSkill,
  skillOptions,
}: {
  activeModel: string;
  activeModelOption?: ConfiguredModelOption;
  canSend: boolean;
  configuredModelOptions: ConfiguredModelOption[];
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onOpenSettings: () => void;
  onSelectModel: (option: ConfiguredModelOption) => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    attachments?: MessageAttachment[],
  ) => void;
  selectedSkills: SkillConfig[];
  onSelectSkill: (skill: SkillConfig) => void;
  onRemoveSkill: (skillId: string) => void;
  skillOptions: SkillConfig[];
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [slashCaret, setSlashCaret] = useState(input.length);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<
    MessageAttachment[]
  >([]);
  const [attachmentAccessGranted, setAttachmentAccessGranted] =
    useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasMultipleModels = configuredModelOptions.length > 1;
  const currentModelLabel = activeModelOption?.model ?? activeModel;
  const slashState = useMemo(() => {
    const beforeCaret = input.slice(0, slashCaret);
    const match = beforeCaret.match(/(^|\s)\/([^\s/]*)$/);

    if (!match) {
      return null;
    }

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
    if (!isModelMenuOpen) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);

    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isModelMenuOpen]);

  useEffect(() => {
    setActiveSkillIndex(0);
  }, [slashState?.query]);

  const handleTextareaKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (isSkillMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSkillIndex(
          (index) => (index + 1) % filteredSkillOptions.length,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSkillIndex(
          (index) =>
            (index - 1 + filteredSkillOptions.length) %
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

    if (event.key === "Backspace" && !input && selectedSkills.length > 0) {
      event.preventDefault();
      onRemoveSkill(selectedSkills[selectedSkills.length - 1].id);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: MessageAttachment[] = [];

    for (const file of Array.from(files)) {
      const isImage = isImageAttachmentFile(file);
      const attachment: MessageAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: isImage ? "image" : "file",
        mimeType: file.type || (isImage ? "image/png" : "application/octet-stream"),
        size: file.size,
      };

      if (isImage) {
        const dataUrl = await fileToDataUrl(file);
        attachment.dataUrl = dataUrl;
      } else if (isReadableTextAttachment(file)) {
        const text = await file.text();
        attachment.textContent =
          text.length > maxAttachmentTextLength
            ? `${text.slice(0, maxAttachmentTextLength)}\n\n[文件内容已截断，仅发送前 ${maxAttachmentTextLength} 个字符]`
            : text;
      }

      newAttachments.push(attachment);
    }

    setPendingAttachments((prev) => [...prev, ...newAttachments]);
    setAttachmentAccessGranted(false);
    event.target.value = "";
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length === 0) {
        setAttachmentAccessGranted(false);
      }
      return next;
    });
  };

  const imageAttachmentCount = pendingAttachments.filter(
    (attachment) => attachment.type === "image",
  ).length;
  const readableAttachmentCount = pendingAttachments.filter(
    (attachment) => attachment.textContent,
  ).length;
  const otherAttachmentCount =
    pendingAttachments.length - imageAttachmentCount - readableAttachmentCount;
  const needsAttachmentAccess =
    pendingAttachments.length > 0 && !attachmentAccessGranted;

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    const attachments = pendingAttachments.length > 0
      ? pendingAttachments
      : undefined;

    if (needsAttachmentAccess) {
      event.preventDefault();
      return;
    }

    onSubmit(event, attachments);
    setPendingAttachments([]);
    setAttachmentAccessGranted(false);
  };

  const hasContent = input.trim().length > 0 || pendingAttachments.length > 0;

  return (
    <form
      className="relative overflow-visible rounded-2xl border border-[#dfe4ec] bg-white shadow-[0_10px_28px_rgb(17_24_39_/_0.06)]"
      onSubmit={handleFormSubmit}
    >
      {isSkillMenuOpen ? (
        <div
          role="listbox"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-full overflow-hidden rounded-2xl border border-[#e2e6ee] bg-white py-1.5 shadow-[0_18px_45px_rgb(15_23_42_/_0.14)]"
        >
          {filteredSkillOptions.map((skill, index) => {
            const active = index === activeSkillIndex;
            const sourceLabel = skill.source === "builtin" ? "内置" : "个人";

            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left transition ${
                  active ? "bg-[#f4f6f9]" : "hover:bg-[#f8fafc]"
                }`}
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
                  {sourceLabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFilesSelected}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.zip,.rar,.7z"
        className="hidden"
        onChange={handleFilesSelected}
      />
      {needsAttachmentAccess ? (
        <div className="border-b border-[#edf0f4] bg-primary/5 px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#1f2430]">
                智能体请求访问附件
              </div>
              <p className="mt-1 text-xs leading-5 text-[#6b7280]">
                需要读取你刚选择的图片或文件，并把可发送的内容交给当前模型。本次授权只用于这条消息。
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#6b7280]">
                {imageAttachmentCount > 0 ? (
                  <span>图片 {imageAttachmentCount} 个</span>
                ) : null}
                {readableAttachmentCount > 0 ? (
                  <span>文本文件 {readableAttachmentCount} 个</span>
                ) : null}
                {otherAttachmentCount > 0 ? (
                  <span>其他文件 {otherAttachmentCount} 个</span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-lg border border-[#dfe4ec] bg-white px-3 text-xs text-[#4b5563] transition hover:text-primary"
                onClick={() => {
                  setPendingAttachments([]);
                  setAttachmentAccessGranted(false);
                }}
              >
                拒绝
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-white transition hover:bg-primary/90"
                onClick={() => setAttachmentAccessGranted(true)}
              >
                授权
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingAttachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#edf0f4] px-5 py-2.5">
          {pendingAttachments.map((att) => (
            <div
              key={att.id}
              className="group relative flex items-center gap-2 rounded-lg border border-[#e5e9f0] bg-[#f8f9fb] py-1 pl-1.5 pr-2"
            >
              {att.type === "image" && att.dataUrl ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10">
                  <FileText size={14} className="text-primary" />
                </div>
              )}
              <span className="max-w-[120px] truncate text-xs text-[#374151]">
                {att.name}
              </span>
              <button
                type="button"
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[#9ca3af] opacity-0 transition hover:bg-[#e5e7eb] hover:text-[#374151] group-hover:opacity-100"
                onClick={() => removeAttachment(att.id)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
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
          <textarea
            ref={inputRef}
            className="mt-2 block min-h-[64px] max-h-44 w-full resize-none border-0 bg-transparent p-0 text-sm text-[#1f2430] outline-none placeholder:text-[#aeb5c1]"
            placeholder="向 Nova Desk 询问任何事情…"
            rows={3}
            value={input}
            onChange={(event) => {
              onChange(event.target.value);
              updateCaretFromTextarea(event.target);
            }}
            onClick={(event) => updateCaretFromTextarea(event.currentTarget)}
            onKeyUp={(event) => updateCaretFromTextarea(event.currentTarget)}
            onKeyDown={(event) => {
              if (isSkillMenuOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSkillIndex(
                    (index) => (index + 1) % filteredSkillOptions.length,
                  );
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSkillIndex(
                    (index) =>
                      (index - 1 + filteredSkillOptions.length) %
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
            }}
          />
        </div>
      ) : null}
      {selectedSkills.length === 0 ? (
        <textarea
          ref={inputRef}
          className="min-h-20 max-h-44 w-full resize-none rounded-t-2xl border-0 bg-white px-5 py-4 text-sm text-[#1f2430] outline-none placeholder:text-[#aeb5c1]"
          placeholder="向 Nova Desk 询问任何事情。输入 @ 使用插件或提及文件"
          rows={3}
          value={input}
          onChange={(event) => {
            onChange(event.target.value);
            updateCaretFromTextarea(event.target);
          }}
          onClick={(event) => updateCaretFromTextarea(event.currentTarget)}
          onKeyUp={(event) => updateCaretFromTextarea(event.currentTarget)}
          onKeyDown={(event) => {
            if (isSkillMenuOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSkillIndex(
                  (index) => (index + 1) % filteredSkillOptions.length,
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSkillIndex(
                  (index) =>
                    (index - 1 + filteredSkillOptions.length) %
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

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      ) : null}
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[#edf0f4] bg-[#f4f6f8] px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[#717782]">
          <Dropdown
            menu={{
              items: [
                {
                  key: "image",
                  icon: <Image size={13} />,
                  label: "上传图片",
                  onClick: () => imageInputRef.current?.click(),
                },
                {
                  key: "file",
                  icon: <FileText size={13} />,
                  label: "上传文件",
                  onClick: () => fileInputRef.current?.click(),
                },
              ],
            }}
          >
            <button
              type="button"
              aria-label="上传文件"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white"
            >
              <Plus size={16} />
            </button>
          </Dropdown>
          <span className="workspace-chip">Nova Desk</span>
          <span className="workspace-chip">本地模式</span>
          <span className="workspace-chip">develop</span>
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
                aria-expanded={hasMultipleModels ? isModelMenuOpen : undefined}
                className="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-md bg-[#e8ebf0] px-2.5 text-xs text-[#1f2430] transition hover:bg-white"
                onClick={() => {
                  if (hasMultipleModels) {
                    setIsModelMenuOpen((open) => !open);
                  }
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
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition ${
                        selected ? "bg-[#f8fafc]" : "hover:bg-[#f4f6f9]"
                      }`}
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#717782] hover:bg-white"
          >
            <Mic size={15} />
          </button>
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#69707b] text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-[#c9cdd3]"
            disabled={!hasContent || isStreaming || needsAttachmentAccess}
          >
            {isStreaming ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </form>
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
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
                <img
                  key={att.id}
                  src={att.dataUrl}
                  alt={att.name}
                  className="max-h-40 rounded-xl border border-white/20 object-cover"
                />
              ) : (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs text-white/90"
                >
                  <FileText size={12} />
                  <span className="max-w-[100px] truncate">{att.name}</span>
                </div>
              ),
            )}
          </div>
        ) : null}
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
      </div>
    </article>
  );
};

const MarkdownMessage = ({ content }: { content: string }) => (
  <div className="markdown-message">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
