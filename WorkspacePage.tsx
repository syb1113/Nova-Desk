import { Check, ChevronDown, Loader2, Mic, Plus, Send, Sparkles } from 'lucide-react'
import { FormEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation } from 'react-router-dom'
import { streamHermesMessage, type ChatMessage } from '../api/hermes'
import { getConfiguredModelOptions, type ConfiguredModelOption } from '../config/modelProviders'
import { useSkillStore } from '../state/skillStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SkillsPage } from '../skills/SkillsPage'
import type { AppliedSkill } from '../types/skill'

/* ── @ mention fuzzy match helpers ──────────────────────────────────────── */

interface MentionableSkill {
  id: string
  name: string
  description?: string
}

interface FuzzyResult {
  score: number
  highlights: [number, number][]
}

function fuzzyScore(text: string, query: string): FuzzyResult | null {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  if (!lowerQuery) {
    return { score: 1, highlights: [] }
  }

  // Exact substring match — highest priority
  const subIdx = lowerText.indexOf(lowerQuery)
  if (subIdx !== -1) {
    return { score: 200 - subIdx, highlights: [[subIdx, subIdx + lowerQuery.length]] }
  }

  // Character-by-character fuzzy match
  let qi = 0
  let score = 0
  const highlights: [number, number][] = []
  let runStart = -1

  for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[qi]) {
      if (runStart === -1) runStart = i

      const isConsecutive = i === runStart || (highlights.length > 0 && i === highlights[highlights.length - 1][1])
      score += isConsecutive ? 10 : 5

      // Bonus for word-boundary matches
      if (i === 0 || /[-_/\s]/.test(text[i - 1])) {
        score += 15
      }

      qi++

      if (qi >= lowerQuery.length) {
        highlights.push([runStart, i + 1])
      }
    } else if (runStart !== -1 && qi > 0 && highlights.length === 0) {
      highlights.push([runStart, i])
      runStart = -1
    }
  }

  if (qi < lowerQuery.length) return null
  return { score, highlights }
}

function fuzzyFilterSkills(skills: MentionableSkill[], query: string): (MentionableSkill & { nameHighlights: [number, number][] })[] {
  const results: { skill: MentionableSkill; score: number; nameHighlights: [number, number][] }[] = []

  for (const skill of skills) {
    const nameResult = fuzzyScore(skill.name, query)
    const descResult = skill.description ? fuzzyScore(skill.description, query) : null

    const nameScore = nameResult?.score ?? 0
    const descScore = (descResult?.score ?? 0) * 0.4

    if (nameScore > 0 || descScore > 0) {
      results.push({
        skill,
        score: Math.max(nameScore, descScore),
        nameHighlights: nameResult?.highlights ?? [],
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).map((r) => ({ ...r.skill, nameHighlights: r.nameHighlights }))
}

/* ── Highlighted name rendering helper ──────────────────────────────────── */

function HighlightedName({ name, highlights }: { name: string; highlights: [number, number][] }) {
  if (highlights.length === 0) return <>{name}</>

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const [start, end] of highlights) {
    if (start > cursor) parts.push(name.slice(cursor, start))
    parts.push(<mark key={start} className="bg-transparent text-primary font-semibold underline underline-offset-2">{name.slice(start, end)}</mark>)
    cursor = end
  }

  if (cursor < name.length) parts.push(name.slice(cursor))
  return <>{parts}</>
}

/* ── Existing helpers ───────────────────────────────────────────────────── */

const createMessage = (
  role: ChatMessage['role'],
  content: string,
  appliedSkills?: AppliedSkill[],
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  ...(appliedSkills && appliedSkills.length > 0 ? { appliedSkills } : {}),
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

/* ── WorkspacePage ──────────────────────────────────────────────────────── */

export const WorkspacePage = () => {
  const location = useLocation()
  const activePanel = new URLSearchParams(location.search).get('panel')
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
  // V3: matchSkills 纯内存匹配，loadSkillContents 按需读文件
  const matchSkills = useSkillStore((state) => state.matchSkills)
  const loadSkillContents = useSkillStore((state) => state.loadSkillContents)
  const enabledPackages = useSkillStore((state) => state.enabledPackages)
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

    // V3: 两步匹配 — 先纯内存匹配 triggers，再按需读 SKILL.md
    const { matches } = matchSkills(prompt)
    const applied: AppliedSkill[] = matches.length > 0 ? await loadSkillContents(matches) : []

    const injectedContext = applied
      .map((s) => s.injectedContent)
      .filter(Boolean)
      .join('\n\n---\n\n')

    const enhancedPrompt = injectedContext
      ? `${injectedContext}\n\n---\n\n${prompt}`
      : prompt

    const assistantMessage = createMessage('assistant', '')
    const promptWithHistory = buildPromptWithHistory(chat.messages, enhancedPrompt)

    setInput('')
    markChatStreaming(chatId, true)
    streamQueuesRef.current.set(chatId, '')
    receivedChunkRefs.current.set(chatId, false)
    stopTypewriter(chatId)
    appendMessage(chatId, createMessage('user', prompt, applied))
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

  if (activePanel === 'skills') {
    return <SkillsPage />
  }

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth ${
            hasMessages ? 'px-1 pb-6 pt-10' : 'flex items-center justify-center'
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
              <div className="mb-7 text-center">
                <div className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#7b8494]">Nova Desk</div>
                <h1 className="text-3xl font-semibold tracking-normal text-[#14171f]">
                  要在本地工作区处理什么？
                </h1>
              </div>
              <ChatComposer
                activeModel={activeModel}
                activeModelOption={activeModelOption}
                mentionableSkills={enabledPackages().map((p) => ({
                  id: p.id,
                  name: p.overrides.name ?? p.id,
                  description: p.overrides.description,
                }))}
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
          <div className="shrink-0 bg-[#f8f9fb] pb-6 pt-3">
            <ChatComposer
              activeModel={activeModel}
              activeModelOption={activeModelOption}
              mentionableSkills={enabledPackages().map((p) => ({
                id: p.id,
                name: p.overrides.name ?? p.id,
                description: p.overrides.description,
              }))}
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

/* ── ChatComposer (with @ mention support) ──────────────────────────────── */

const ChatComposer = ({
  activeModel,
  activeModelOption,
  mentionableSkills,
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
  mentionableSkills: MentionableSkill[]
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

  // ── @ mention state ──
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionVisible, setMentionVisible] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionPanelRef = useRef<HTMLDivElement | null>(null)

  const filteredSkills = useMemo(
    () => (mentionVisible ? fuzzyFilterSkills(mentionableSkills, mentionQuery) : []),
    [mentionableSkills, mentionQuery, mentionVisible],
  )

  // ── Detect @ mention in textarea ──
  const detectMention = useCallback(
    (value: string, cursorPos: number) => {
      const before = value.slice(0, cursorPos)
      const atIdx = before.lastIndexOf('@')

      if (atIdx === -1) {
        setMentionVisible(false)
        return
      }

      // @ must be at start or preceded by whitespace
      if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) {
        setMentionVisible(false)
        return
      }

      const afterAt = before.slice(atIdx + 1)
      // Close mention if there's a space in the query
      if (afterAt.includes(' ')) {
        setMentionVisible(false)
        return
      }

      setMentionQuery(afterAt)
      setMentionVisible(true)
      setMentionIndex(0)
    },
    [],
  )

  // ── Apply a skill mention into the input ──
  const applyMention = useCallback(
    (skill: MentionableSkill) => {
      const textarea = inputRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart ?? input.length
      const before = input.slice(0, cursorPos)
      const atIdx = before.lastIndexOf('@')

      if (atIdx === -1) return

      const replacement = `${skill.name} `
      const nextValue = input.slice(0, atIdx) + replacement + input.slice(cursorPos)
      onChange(nextValue)

      setMentionVisible(false)
      setMentionQuery('')

      // Restore cursor after the inserted skill name
      requestAnimationFrame(() => {
        const pos = atIdx + replacement.length
        textarea.focus()
        textarea.setSelectionRange(pos, pos)
      })
    },
    [input, inputRef, onChange],
  )

  // ── Close mention panel on outside click ──
  useEffect(() => {
    if (!mentionVisible) return

    const handleOutside = (e: PointerEvent) => {
      if (mentionPanelRef.current && !mentionPanelRef.current.contains(e.target as Node)) {
        setMentionVisible(false)
      }
    }

    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [mentionVisible])

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

  // ── Keyboard handler for mention navigation ──
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionVisible && filteredSkills.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, filteredSkills.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applyMention(filteredSkills[mentionIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionVisible(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form
      className="relative overflow-visible rounded-2xl border border-[#dfe4ec] bg-white shadow-[0_10px_28px_rgb(17_24_39_/_0.06)]"
      onSubmit={onSubmit}
    >
      {/* ── @ mention popup (shown above textarea) ── */}
      {mentionVisible && filteredSkills.length > 0 ? (
        <div
          ref={mentionPanelRef}
          className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_12px_36px_rgb(15_23_42_/_0.12)]"
        >
          <div className="flex items-center justify-between border-b border-[#f0f1f3] px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
              {mentionQuery ? `匹配 "${mentionQuery}"` : '可用 Skills'}
            </span>
            <span className="text-[10px] text-[#bfc4cd]">
              {filteredSkills.length} 个结果
            </span>
          </div>

          <div className="max-h-[220px] overflow-y-auto py-1">
            {filteredSkills.map((skill, idx) => (
              <button
                key={skill.id}
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                  idx === mentionIndex ? 'bg-[#f0f4ff]' : 'hover:bg-[#f8f9fb]'
                }`}
                onClick={() => applyMention(skill)}
                onMouseEnter={() => setMentionIndex(idx)}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                  idx === mentionIndex ? 'bg-primary text-white' : 'bg-[#f0f1f3] text-[#9ca3af]'
                }`}>
                  /
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#1f2430]">
                    <HighlightedName name={skill.name} highlights={skill.nameHighlights} />
                  </span>
                  {skill.description ? (
                    <span className="block truncate text-xs text-[#9ca3af]">{skill.description}</span>
                  ) : null}
                </span>
                {idx === mentionIndex ? (
                  <span className="shrink-0 rounded bg-[#f0f1f3] px-1.5 py-0.5 text-[10px] text-[#9ca3af]">
                    Enter
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-[#f0f1f3] px-4 py-1.5 text-[10px] text-[#bfc4cd]">
            <span>
              <kbd className="rounded bg-[#f4f5f6] px-1 py-0.5 text-[#9ca3af]">&uarr;&darr;</kbd> 导航
            </span>
            <span>
              <kbd className="rounded bg-[#f4f5f6] px-1 py-0.5 text-[#9ca3af]">Tab</kbd> 选择
            </span>
            <span>
              <kbd className="rounded bg-[#f4f5f6] px-1 py-0.5 text-[#9ca3af]">Esc</kbd> 关闭
            </span>
          </div>
        </div>
      ) : mentionVisible && filteredSkills.length === 0 ? (
        <div
          ref={mentionPanelRef}
          className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white px-4 py-5 text-center shadow-[0_12px_36px_rgb(15_23_42_/_0.12)]"
        >
          <p className="text-sm text-[#9ca3af]">
            未找到匹配 "<span className="text-[#1f2430]">{mentionQuery}</span>" 的 Skill
          </p>
        </div>
      ) : null}

      <textarea
        ref={inputRef}
        className="min-h-20 max-h-44 w-full resize-none rounded-t-2xl border-0 bg-white px-5 py-4 text-sm text-[#1f2430] outline-none placeholder:text-[#aeb5c1]"
        placeholder="向 Nova Desk 询问任何事情。输入 @ 使用插件或提及文件"
        rows={3}
        value={input}
        onChange={(event) => {
          onChange(event.target.value)
          requestAnimationFrame(() => {
            detectMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
          })
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[#edf0f4] bg-[#f4f6f8] px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[#717782]">
          <button
            type="button"
            aria-label="Add context"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white"
          >
            <Plus size={16} />
          </button>
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
                aria-haspopup={hasMultipleModels ? 'listbox' : undefined}
                aria-expanded={hasMultipleModels ? isModelMenuOpen : undefined}
                className="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-md bg-[#e8ebf0] px-2.5 text-xs text-[#1f2430] transition hover:bg-white"
                onClick={() => {
                  if (hasMultipleModels) {
                    setIsModelMenuOpen((open) => !open)
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
                    activeModelOption?.provider === option.provider && activeModelOption.model === option.model

                  return (
                    <button
                      key={`${option.provider}:${option.model}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition ${
                        selected ? 'bg-[#f8fafc]' : 'hover:bg-[#f4f6f9]'
                      }`}
                      onClick={() => {
                        onSelectModel(option)
                        setIsModelMenuOpen(false)
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm leading-5 text-[#111827]">{option.model}</span>
                        <span className="block truncate text-xs leading-4 text-[#6b7280]">{option.providerName}</span>
                      </span>
                      {selected ? <Check className="ml-2 shrink-0 text-primary" size={15} /> : null}
                    </button>
                  )
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
            disabled={!canSend}
          >
            {isStreaming ? <Loader2 className="animate-spin" size={17} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </form>
  )
}

/* ── MessageBlock / MarkdownMessage / ThinkingBubble (unchanged) ────────── */

const MessageBlock = ({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) => {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isThinking = isStreaming && !isUser && !isSystem && !message.content
  const hasSkills = isUser && message.appliedSkills && message.appliedSkills.length > 0

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] ${isUser ? 'flex flex-col items-end gap-1.5' : ''}`}>
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
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
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
