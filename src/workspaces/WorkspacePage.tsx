import { Loader2, Mic, Plus, Send, SlidersHorizontal } from 'lucide-react'
import { FormEvent, RefObject, useMemo, useRef, useState } from 'react'
import { streamHermesMessage, type ChatMessage } from '../api/hermes'

const createMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
})

export const WorkspacePage = () => {
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasMessages = messages.length > 0

  const canSend = useMemo(() => input.trim().length > 0 && !isStreaming, [input, isStreaming])

  const appendToMessage = (messageId: string, chunk: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: `${message.content}${chunk}`,
            }
          : message,
      ),
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const prompt = input.trim()

    if (!prompt || isStreaming) {
      return
    }

    const assistantMessage = createMessage('assistant', '')

    setInput('')
    setIsStreaming(true)
    setMessages((current) => [...current, createMessage('user', prompt), assistantMessage])

    try {
      const result = await streamHermesMessage(prompt, sessionId, (chunk) => {
        appendToMessage(assistantMessage.id, chunk)
      })

      setSessionId(result.sessionId)
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id && !message.content
            ? { ...message, content: result.text || 'Hermes Agent returned an empty response.' }
            : message,
        ),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hermes Agent request failed.'

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessage.id
            ? {
                ...item,
                role: 'system',
                content: message,
              }
            : item,
        ),
      )
    } finally {
      setIsStreaming(false)
      inputRef.current?.focus()
    }
  }

  return (
    <section className="relative flex min-h-screen flex-col bg-[#fbfbfa]">
      <div className="absolute right-5 top-4 flex items-center gap-2">
        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white text-[#6f7580] hover:text-primary">
          <SlidersHorizontal size={15} />
        </button>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6">
        <div className={`min-h-0 flex-1 overflow-y-auto ${hasMessages ? 'py-12' : 'flex items-center justify-center'}`}>
          {hasMessages ? (
            <div className="space-y-7">
              {messages.map((message) => (
                <MessageBlock key={message.id} message={message} isStreaming={isStreaming && message === messages[messages.length - 1]} />
              ))}
            </div>
          ) : (
            <div className="w-full max-w-3xl">
              <h1 className="mb-8 text-center text-3xl font-semibold tracking-normal text-[#14171f]">
                要在 Nova Desk 中构建什么？
              </h1>
              <ChatComposer
                canSend={canSend}
                input={input}
                inputRef={inputRef}
                isStreaming={isStreaming}
                onChange={setInput}
                onSubmit={handleSubmit}
              />
              <PromptSuggestions />
            </div>
          )}
        </div>

        {hasMessages ? (
          <div className="sticky bottom-0 bg-[#fbfbfa] pb-6 pt-3">
            <ChatComposer
              canSend={canSend}
              input={input}
              inputRef={inputRef}
              isStreaming={isStreaming}
              onChange={setInput}
              onSubmit={handleSubmit}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

const ChatComposer = ({
  canSend,
  input,
  inputRef,
  isStreaming,
  onChange,
  onSubmit,
}: {
  canSend: boolean
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  isStreaming: boolean
  onChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) => (
  <form className="overflow-hidden rounded-2xl border border-[#e2e4e8] bg-white shadow-[0_16px_50px_rgb(17_24_39_/_0.08)]" onSubmit={onSubmit}>
    <textarea
      ref={inputRef}
      className="min-h-20 max-h-44 w-full resize-none border-0 bg-white px-5 py-4 text-sm text-[#1f2430] outline-none placeholder:text-[#b5bac3]"
      placeholder="可向 Nova Desk 询问任何事。输入 @ 使用插件或提及文件"
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
    <div className="flex h-12 items-center justify-between border-t border-[#eef0f3] bg-[#f3f4f6] px-4">
      <div className="flex items-center gap-2 text-xs text-[#717782]">
        <button type="button" aria-label="Add context" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white">
          <Plus size={16} />
        </button>
        <span>Nova Desk</span>
        <span>本地模式</span>
        <span>develop</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#717782]">5.5 中</span>
        <button type="button" aria-label="Voice input" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#717782] hover:bg-white">
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

const MessageBlock = ({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) => {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? 'bg-primary text-white'
            : isSystem
              ? 'border border-secondary/20 bg-secondary/10 text-[#1f2430]'
              : 'bg-transparent text-[#1f2430]'
        }`}
      >
        {message.content}
        {isStreaming && !isUser ? <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-primary align-middle" /> : null}
      </div>
    </article>
  )
}

const PromptSuggestions = () => {
  const suggestions = ['审查最近的提交记录是否存在风险', '帮我处理最近一个未合并 PR 卡住的问题', '将常用的应用连接到 Nova Desk']

  return (
    <div className="mt-5 divide-y divide-[#eceef1] text-sm text-[#68707d]">
      {suggestions.map((suggestion) => (
        <button key={suggestion} type="button" className="block w-full px-4 py-3 text-left hover:text-primary">
          {suggestion}
        </button>
      ))}
    </div>
  )
}
