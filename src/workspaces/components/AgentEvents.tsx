import { useState } from 'react'
import type { AgentEvent } from '../../api/hermes'

export const AgentEvents = ({ events, running, onReply }: {
  events: AgentEvent[]; running: boolean; onReply: (id: string, value: string) => Promise<void>
}) => <div className="my-3 space-y-2">
  {events.map((event, index) => <AgentEventRow key={`${event.id ?? 'status'}:${index}`} event={event} running={running} onReply={onReply} />)}
</div>

const AgentEventRow = ({ event, running, onReply }: {
  event: AgentEvent; running: boolean; onReply: (id: string, value: string) => Promise<void>
}) => {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const respond = async (value: string) => {
    if (!event.id || busy) return
    setBusy(true)
    try { await onReply(event.id, value) } catch { setError('回复失败，请重试。') } finally { setBusy(false) }
  }
  if (event.type === 'status') return <p className="text-xs text-gray-500">{event.text}</p>
  if (event.type === 'tool_start' || event.type === 'tool_complete') return <details className="rounded-lg border bg-white p-2 text-xs">
    <summary className="cursor-pointer">{event.name} · {event.type === 'tool_complete' ? '已返回' : running ? '执行中' : '已结束，未收到结果'}</summary>
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(event.args, null, 2)}</pre>
    {event.result ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{event.result}</pre> : null}
  </details>
  return <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
    <strong>{event.type === 'approval' ? '执行前需要确认' : '需要你补充信息'}</strong>
    <p className="whitespace-pre-wrap">{event.description || event.question}</p>
    {event.command ? <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{event.command}</pre> : null}
    {event.answered ? <p className="text-xs">已回复</p> : !running ? <p className="text-xs">请求已结束</p> : <div className="mt-2 flex flex-wrap gap-2">
      {event.type === 'approval' ? <>
        <button disabled={busy} className="rounded bg-primary px-3 py-1 text-white" onClick={() => void respond('once')}>允许本次</button>
        <button disabled={busy} className="rounded border px-3 py-1" onClick={() => void respond('deny')}>拒绝</button>
      </> : <>
        {event.choices?.map((choice) => <button key={choice} disabled={busy} className="rounded border px-2 py-1" onClick={() => void respond(choice)}>{choice}</button>)}
        <input aria-label="补充信息" className="min-w-0 flex-1 rounded border px-2" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <button disabled={busy || !answer.trim()} className="rounded bg-primary px-3 py-1 text-white" onClick={() => void respond(answer)}>回复</button>
      </>}
    </div>}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
