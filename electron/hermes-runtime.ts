import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

export type ChatRequest = {
  requestId: string
  prompt: string
  sessionId?: string | null
  history?: { role: string; content: string }[]
  testMode?: boolean
  attachments?: unknown[]
  modelConfig?: { provider: string; apiKey: string; baseUrl: string; protocol: string; activeModel: string }
}
type RuntimeEvent = { type: string; [key: string]: unknown }
type Turn = { owner: number; reply: (id: string, value: string) => boolean; cancel: () => void; finished: Promise<void> }
const turns = new Map<string, Turn>()
const sessions = new Set<string>()

export const controlTurn = (owner: number, requestId: string, id?: string, value?: string) => {
  const turn = turns.get(requestId)
  if (!turn || turn.owner !== owner) return false
  if (id) return turn.reply(id, value ?? '')
  turn.cancel()
  return true
}

export const cancelOwner = async (owner?: number) => {
  const running = [...turns.values()].filter((turn) => owner === undefined || turn.owner === owner)
  for (const turn of running) turn.cancel()
  await Promise.all(running.map((turn) => turn.finished))
}

export const runHermes = (
  request: ChatRequest, owner: number, emit: (event: RuntimeEvent) => void,
  paths: { vendor: string; bridge: string; data: string },
) => new Promise<{ text: string; sessionId: string | null; cancelled?: boolean }>((resolve, reject) => {
  const config = request.modelConfig
  if (!request.requestId || turns.has(request.requestId)) return reject(new Error('请求编号无效或重复。'))
  if (!request.prompt?.trim()) return reject(new Error('请输入消息。'))
  if (!config?.apiKey?.trim() || !config.baseUrl?.trim() || !config.activeModel?.trim()) {
    return reject(new Error('请先在设置中填写 API Key、Base URL 和模型。'))
  }
  try {
    const url = new URL(config.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch { return reject(new Error('Base URL 必须是有效的 HTTP 或 HTTPS 地址。')) }
  if (request.sessionId && !/^[0-9a-f-]{36}$/i.test(request.sessionId)) return reject(new Error('会话编号无效。'))
  if (request.sessionId && sessions.has(request.sessionId)) return reject(new Error('此会话仍在执行中。'))
  const root = path.join(paths.vendor, 'hermes-agent')
  const python = process.env.HERMES_PYTHON_PATH || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  if (!fs.existsSync(python) || !fs.existsSync(paths.bridge)) return reject(new Error('Hermes 运行环境缺失，请运行 pnpm setup:hermes 后重启。'))
  const providers: Record<string, string> = { kimi: 'moonshot', glm: 'zai', mimo: 'xiaomi' }
  const env = { ...process.env, HERMES_HOME: process.env.HERMES_HOME || path.join(paths.vendor, 'hermes-home'),
    PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' }
  const child = spawn(python, ['-u', paths.bridge, root], { cwd: process.cwd(), env, windowsHide: true, shell: false })
  let terminal: RuntimeEvent | undefined
  let failure: string | undefined
  let settled = false
  let stopping = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  const interactions = new Map<string, string>()
  const send = (value: unknown) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n') }
  const cancel = () => {
    if (stopping) return
    stopping = true
    send({ type: 'cancel' })
    forceTimer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.on('error', () => child.kill())
      } else child.kill('SIGKILL')
    }, 5000)
  }
  let markFinished!: () => void
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  turns.set(request.requestId, { owner, cancel, finished, reply: (id, value) => {
    const kind = interactions.get(id)
    if (!kind || stopping) return false
    if (kind === 'approval' && !['once', 'deny'].includes(value)) return false
    interactions.delete(id)
    send({ type: 'reply', id, value })
    return true
  } })
  if (request.sessionId) sessions.add(request.sessionId)
  const timer = setTimeout(() => { failure = '请求超过 5 分钟，已停止；可重试。'; cancel() }, 300_000)
  const cleanup = () => {
    clearTimeout(timer)
    if (forceTimer) clearTimeout(forceTimer)
    turns.delete(request.requestId)
    if (request.sessionId) sessions.delete(request.sessionId)
    markFinished()
  }
  const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); reject(error) } }
  child.once('error', () => fail(new Error('无法启动 Hermes 运行环境，请检查安装。')))
  child.stdin.on('error', () => { /* close/error determines the final outcome */ })
  child.stderr.resume() // Runtime diagnostics may contain credentials; never forward raw logs.
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line) as RuntimeEvent
      if (['done', 'error', 'cancelled'].includes(event.type)) terminal = event
      else if (!stopping) {
        if (event.type === 'approval' || event.type === 'clarify') interactions.set(String(event.id), event.type)
        emit(event)
      }
    } catch { failure = 'Hermes 返回了无效的协议数据。'; cancel() }
  })
  child.once('close', (code) => {
    if (settled) return
    settled = true
    cleanup()
    if (failure || terminal?.type === 'error') {
      const message = String(failure || terminal?.message || '执行失败。').split(config.apiKey.trim()).join('[已隐藏]')
      reject(new Error(message))
    } else if (terminal?.type === 'done' && code === 0) {
      resolve({ text: String(terminal.text || ''), sessionId: typeof terminal.sessionId === 'string' ? terminal.sessionId : null })
    } else if (stopping || terminal?.type === 'cancelled') resolve({ text: '', sessionId: request.sessionId ?? null, cancelled: true })
    else reject(new Error(`Hermes 意外退出（${code ?? '未知'}），请检查模型配置后重试。`))
  })
  send({ ...request, workspace: process.cwd(), sessionDir: path.join(paths.data, 'sessions'), modelConfig: {
    ...config, apiKey: config.apiKey.trim(), baseUrl: config.baseUrl.trim(), activeModel: config.activeModel.trim(),
    provider: providers[config.provider] ?? config.provider,
    apiMode: config.provider !== 'mimo' && config.protocol === 'anthropic' ? 'anthropic_messages' : 'chat_completions',
  } })
})
