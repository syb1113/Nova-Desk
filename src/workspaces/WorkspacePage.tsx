import { Check, ChevronDown, Loader2, Mic, Plus, Send } from 'lucide-react'
import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamHermesMessage, type ChatMessage } from '../api/hermes'
import { getConfiguredModelOptions, type ConfiguredModelOption } from '../config/modelProviders'
import { useWorkspaceStore } from '../state/workspaceStore'

const createMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
})

const buildPromptWithHistory = (messages: ChatMessage[], prompt: string) => {
  const history = messages
    .filter((message) => message.role !== 'system' && message.content.trim())
    .slice(-10)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n\n')

  if (!history) {
    return prompt
  }

  return `下面是当前本地对话上下文，请基于这些上下文回答最后一个问题。\n\n${history}\n\n用户：${prompt}`
}

const nextTypewriterChunk = (text: string) => {
  if (text.length <= 4) {
    return text
  }

  const punctuationIndex = text.slice(0, 18).search(/[，。！？；,.!?;\n]/)

  if (punctuationIndex >= 0) {
    return text.slice(0, punctuationIndex + 1)
  }

  return text.slice(0, Math.min(6, text.length))
}

export const WorkspacePage = () => {
  const activeModel = useWorkspaceStore((state) => state.activeModel)
  const activeProvider = useWorkspaceStore((state) => state.activeProvider)
  const activeChatId = useWorkspaceStore((state) => state.activeChatId)
  const activeChat = useWorkspaceStore((state) => state.activeChat())
  const getActiveModelConfig = useWorkspaceStore((state) => state.getActiveModelConfig)
  const modelConfigs = useWorkspaceStore((state) => state.modelConfigs)
  const appendMessage = useWorkspaceStore((state) => state.appendMessage)
  const renameChat = useWorkspaceStore((state) => state.renameChat)
  const setActiveModelSelection = useWorkspaceStore((state) => state.setActiveModelSelection)
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen)
  const updateMessage = useWorkspaceStore((state) => state.updateMessage)
  const [input, setInput] = useState('')
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const activeChatIdRef = useRef(activeChatId)
  const streamQueuesRef = useRef(new Map<string, string>())
  const typewriterRefs = useRef(new Map<string, number>())
  const receivedChunkRefs = useRef(new Map<string, boolean>())
  const hasMessages = activeChat.messages.length > 0
  const activeChatIsStreaming = streamingChatIds.has(activeChat.id)
  const configuredModelOptions = useMemo(() => getConfiguredModelOptions(modelConfigs), [modelConfigs])
  const activeModelOption = useMemo(
    () =>
      configuredModelOptions.find(
        (option) => option.provider === activeProvider && option.model === activeModel,
      ) ?? configuredModelOptions[0],
    [activeModel, activeProvider, configuredModelOptions],
  )

  const canSend = useMemo(() => input.trim().length > 0 && !activeChatIsStreaming, [activeChatIsStreaming, input])
  const lastMessageContent = activeChat.messages.at(-1)?.content ?? ''

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [activeChat.id, activeChat.messages.length, lastMessageContent])

  useEffect(() => {
    return () => {
      typewriterRefs.current.forEach((timer) => window.clearInterval(timer))
      typewriterRefs.current.clear()
    }
  }, [])

  const markChatStreaming = (chatId: string, streaming: boolean) => {
    setStreamingChatIds((current) => {
      const next = new Set(current)

      if (streaming) {
        next.add(chatId)
      } else {
        next.delete(chatId)
      }

      return next
    })
  }

  const appendToMessage = (chatId: string, messageId: string, chunk: string) => {
    updateMessage(chatId, messageId, (message) => ({
      ...message,
      content: `${message.content}${chunk}`,
    }))
  }

  const stopTypewriter = (chatId: string) => {
    const timer = typewriterRefs.current.get(chatId)

    if (timer) {
      window.clearInterval(timer)
      typewriterRefs.current.delete(chatId)
    }
  }

  const waitForTypewriterDrain = (chatId: string) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (!streamQueuesRef.current.get(chatId) && !typewriterRefs.current.has(chatId)) {
          resolve()
          return
        }

        window.setTimeout(check, 24)
      }

      check()
    })

  const enqueueAssistantText = (chatId: string, messageId: string, chunk: string) => {
    if (!chunk) {
      return
    }

    receivedChunkRefs.current.set(chatId, true)
    streamQueuesRef.current.set(chatId, `${streamQueuesRef.current.get(chatId) ?? ''}${chunk}`)

    if (typewriterRefs.current.has(chatId)) {
      return
    }

    const timer = window.setInterval(() => {
      const queued = streamQueuesRef.current.get(chatId) ?? ''

      if (!queued) {
        stopTypewriter(chatId)
        return
      }

      const next = nextTypewriterChunk(queued)
      streamQueuesRef.current.set(chatId, queued.slice(next.length))
      appendToMessage(chatId, messageId, next)
    }, 18)

    typewriterRefs.current.set(chatId, timer)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const prompt = input.trim()
    const chat = activeChat
    const chatId = chat.id

    if (!prompt || streamingChatIds.has(chatId)) {
      return
    }

    const assistantMessage = createMessage('assistant', '')
    const promptWithHistory = buildPromptWithHistory(chat.messages, prompt)

    setInput('')
    markChatStreaming(chatId, true)
    streamQueuesRef.current.set(chatId, '')
    receivedChunkRefs.current.set(chatId, false)
    stopTypewriter(chatId)
    appendMessage(chatId, createMessage('user', prompt))
    appendMessage(chatId, assistantMessage)

    if (chat.title === '新对话') {
      renameChat(chatId, prompt.slice(0, 28))
    }

    try {
      const result = await streamHermesMessage(
        promptWithHistory,
        null,
        (chunk) => enqueueAssistantText(chatId, assistantMessage.id, chunk),
        getActiveModelConfig(),
      )

      if (result.text && !receivedChunkRefs.current.get(chatId)) {
        enqueueAssistantText(chatId, assistantMessage.id, result.text)
      }

      await waitForTypewriterDrain(chatId)

      updateMessage(chatId, assistantMessage.id, (message) =>
        message.content
          ? message
          : {
              ...message,
              content: result.text || 'Hermes Agent returned an empty response.',
            },
      )
    } catch (error) {
      stopTypewriter(chatId)
      streamQueuesRef.current.set(chatId, '')
      receivedChunkRefs.current.set(chatId, false)

      const message = error instanceof Error ? error.message : 'Hermes Agent request failed.'

      updateMessage(chatId, assistantMessage.id, (item) => ({
        ...item,
        role: 'system',
        content: message,
      }))
    } finally {
      markChatStreaming(chatId, false)
      streamQueuesRef.current.delete(chatId)
      receivedChunkRefs.current.delete(chatId)

      if (activeChatIdRef.current === chatId) {
        inputRef.current?.focus()
      }
    }
  }

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#fbfbfa]">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6">
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth ${
            hasMessages ? 'px-1 pb-6 pt-24' : 'flex items-center justify-center pt-20'
          }`}
        >
          {hasMessages ? (
            <div className="space-y-7">
              {activeChat.messages.map((message) => (
                <MessageBlock
                  key={message.id}
                  message={message}
                  isStreaming={
                    activeChatIsStreaming && message.id === activeChat.messages[activeChat.messages.length - 1]?.id
                  }
                />
              ))}
              <div ref={bottomRef} />
            </div>
          ) : (
            <div className="w-full max-w-3xl">
              <h1 className="mb-8 text-center text-3xl font-semibold tracking-normal text-[#14171f]">
                要在 Nova Desk 中构建什么？
              </h1>
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
                onSelectModel={(option) => setActiveModelSelection(option.provider, option.model)}
                onSubmit={handleSubmit}
              />
            </div>
          )}
        </div>

        {hasMessages ? (
          <div className="shrink-0 bg-[#fbfbfa] pb-6 pt-3">
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
              onSelectModel={(option) => setActiveModelSelection(option.provider, option.model)}
              onSubmit={handleSubmit}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

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
}: {
  activeModel: string
  activeModelOption?: ConfiguredModelOption
  canSend: boolean
  configuredModelOptions: ConfiguredModelOption[]
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  isStreaming: boolean
  onChange: (value: string) => void
  onOpenSettings: () => void
  onSelectModel: (option: ConfiguredModelOption) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const hasMultipleModels = configuredModelOptions.length > 1
  const currentModelLabel = activeModelOption?.model ?? activeModel

  useEffect(() => {
    if (!isModelMenuOpen) {
      return
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)

    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isModelMenuOpen])

  return (
    <form
      className="relative overflow-visible rounded-2xl border border-[#e2e4e8] bg-white shadow-[0_16px_50px_rgb(17_24_39_/_0.08)]"
      onSubmit={onSubmit}
    >
      <textarea
        ref={inputRef}
        className="min-h-20 max-h-44 w-full resize-none rounded-t-2xl border-0 bg-white px-5 py-4 text-sm text-[#1f2430] outline-none placeholder:text-[#b5bac3]"
        placeholder="向 Nova Desk 询问任何事情。输入 @ 使用插件或提及文件"
        rows={3}
        value={input}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="flex h-12 items-center justify-between rounded-b-2xl border-t border-[#eef0f3] bg-[#f3f4f6] px-4">
        <div className="flex items-center gap-2 text-xs text-[#717782]">
          <button
            type="button"
            aria-label="Add context"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white"
          >
            <Plus size={16} />
          </button>
          <span>Nova Desk</span>
          <span>本地模式</span>
          <span>develop</span>
        </div>
        <div className="flex items-center gap-2">
          <div ref={modelMenuRef} className="relative">
            {configuredModelOptions.length === 0 ? (
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-full bg-white px-3 text-sm text-[#4b5563] hover:text-primary"
                onClick={onOpenSettings}
              >
                配置模型
              </button>
            ) : (
              <button
                type="button"
                aria-haspopup={hasMultipleModels ? 'listbox' : undefined}
                aria-expanded={hasMultipleModels ? isModelMenuOpen : undefined}
                className="inline-flex h-8 max-w-[220px] items-center gap-1 rounded-full bg-[#e8ebf0] px-4 text-sm text-[#1f2430] transition hover:bg-white"
                onClick={() => {
                  if (hasMultipleModels) {
                    setIsModelMenuOpen((open) => !open)
                  }
                }}
              >
                <span className="truncate">{currentModelLabel}</span>
                {hasMultipleModels ? <ChevronDown size={15} /> : null}
              </button>
            )}

            {hasMultipleModels && isModelMenuOpen ? (
              <div
                role="listbox"
                className="absolute bottom-10 left-0 z-20 w-64 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white py-2 shadow-[0_18px_45px_rgb(15_23_42_/_0.18)]"
              >
                {configuredModelOptions.map((option) => {
                  const selected =
                    activeModelOption?.provider === option.provider && activeModelOption.model === option.model

                  return (
                    <button
                      key={`${option.provider}:${option.model}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center justify-between px-5 py-3 text-left transition ${
                        selected ? 'bg-[#f8fafc]' : 'hover:bg-[#f4f6f9]'
                      }`}
                      onClick={() => {
                        onSelectModel(option)
                        setIsModelMenuOpen(false)
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base leading-5 text-[#111827]">{option.model}</span>
                        <span className="block truncate text-sm leading-5 text-[#6b7280]">{option.providerName}</span>
                      </span>
                      {selected ? <Check className="ml-3 shrink-0 text-primary" size={18} /> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Voice input"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#717782] hover:bg-white"
          >
            <Mic size={15} />
          </button>
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#7d828a] text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-[#c9cdd3]"
            disabled={!canSend}
          >
            {isStreaming ? <Loader2 className="animate-spin" size={17} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </form>
  )
}

const MessageBlock = ({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) => {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isThinking = isStreaming && !isUser && !isSystem && !message.content

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? 'whitespace-pre-wrap bg-primary text-white'
            : isSystem
              ? 'border border-secondary/20 bg-secondary/10 text-[#1f2430]'
              : 'bg-transparent text-[#1f2430]'
        }`}
      >
        {isThinking ? <ThinkingBubble /> : isUser ? message.content : <MarkdownMessage content={message.content} />}
        {isStreaming && !isUser && !isThinking ? (
          <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-primary align-middle" />
        ) : null}
      </div>
    </article>
  )
}

const MarkdownMessage = ({ content }: { content: string }) => (
  <div className="markdown-message">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
)

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
)
