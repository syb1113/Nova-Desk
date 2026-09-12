import type { ModelRuntimeConfig } from '../config/modelProviders'
import type { AppliedSkill } from '../types/skill'
import { logger } from '../state/logStore'

export type ChatRole = 'user' | 'assistant' | 'system'

export type AgentEvent = {
  type: 'tool_start' | 'tool_complete' | 'approval' | 'clarify' | 'status'
  id?: string
  name?: string
  args?: unknown
  result?: string
  command?: string
  description?: string
  question?: string
  choices?: string[]
  text?: string
  answered?: boolean
}

export type ChatOptions = {
  requestId?: string
  testMode?: boolean
  history?: { role: string; content: string }[]
}

export type MessageAttachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType: string
  dataUrl?: string
  textContent?: string
  filePath?: string
  size: number
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  appliedSkills?: AppliedSkill[]
  attachments?: MessageAttachment[]
  status?: 'running' | 'complete' | 'failed' | 'cancelled'
  error?: string
  events?: AgentEvent[]
}

type RemoteApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    param?: string
    type?: string
  }
}

const mutationVerifierMarker = 'File-mutation verifier:'

const stripDiagnosticPrelude = (text: string) =>
  text.trimEnd().replace(/(?:\r?\n\s*)*⚠(?:\uFE0F)?\s*$/u, '')

export const stripHermesDiagnostics = (text: string) => {
  const markerIndex = text.indexOf(mutationVerifierMarker)
  return stripDiagnosticPrelude(markerIndex >= 0 ? text.slice(0, markerIndex) : text).trimEnd()
}

const createHermesChunkFilter = (onChunk: (chunk: string) => void) => {
  let buffer = ''
  let blocked = false
  const tailLength = mutationVerifierMarker.length + 16

  return {
    push(chunk: string) {
      if (blocked || !chunk) {
        return
      }

      buffer += chunk
      const markerIndex = buffer.indexOf(mutationVerifierMarker)

      if (markerIndex >= 0) {
        const visible = stripDiagnosticPrelude(buffer.slice(0, markerIndex))
        if (visible) {
          onChunk(visible)
        }
        buffer = ''
        blocked = true
        return
      }

      if (buffer.length <= tailLength) {
        return
      }

      const visible = buffer.slice(0, -tailLength)
      buffer = buffer.slice(-tailLength)
      onChunk(visible)
    },
    flush() {
      if (!blocked && buffer) {
        onChunk(buffer)
      }
      buffer = ''
    },
  }
}

const parseRemoteApiError = (message: string) => {
  const jsonStart = message.indexOf('{')
  const jsonEnd = message.lastIndexOf('}')

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null
  }

  try {
    return JSON.parse(message.slice(jsonStart, jsonEnd + 1)) as RemoteApiErrorPayload
  } catch {
    return null
  }
}

const toHermesError = (err: unknown, hadImages: boolean) => {
  const rawMessage = err instanceof Error ? err.message : String(err)
  const remoteError = parseRemoteApiError(rawMessage)?.error
  const remoteMessage = remoteError?.message?.trim()

  if (hadImages && remoteMessage?.includes('No endpoints found that support image input')) {
    return new Error('当前模型不支持图片输入。请切换到支持视觉能力的模型，或移除图片后重试。')
  }

  if (remoteMessage) {
    const code = remoteError?.code ? `（${remoteError.code}）` : ''
    return new Error(`模型接口请求失败${code}：${remoteMessage}`)
  }

  return err instanceof Error ? err : new Error(rawMessage || 'Hermes Agent request failed.')
}

export const sendHermesMessage = async (
  prompt: string,
  sessionId?: string | null,
  modelConfig?: ModelRuntimeConfig,
  attachments?: MessageAttachment[],
) => {
  if (!window.novaDesk?.chatWithHermes) {
    const err = 'Hermes Agent is only available inside the Electron desktop app.'
    logger.error('hermes', err)
    throw new Error(err)
  }

  const imageAttachments = (attachments ?? []).filter((a) => a.type === 'image' && a.dataUrl)

  logger.info('hermes', '请求发送', {
    provider: modelConfig?.provider,
    model: modelConfig?.activeModel,
    prompt,
    sessionId,
    totalAttachments: attachments?.length ?? 0,
    imageCount: imageAttachments.length,
    imageDataUrls: imageAttachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      dataUrlLength: a.dataUrl?.length ?? 0,
      dataUrlPrefix: a.dataUrl?.slice(0, 50),
    })),
  })

  try {
    const result = await window.novaDesk.chatWithHermes(prompt, sessionId, modelConfig, attachments)
    const sanitizedResult = {
      ...result,
      text: stripHermesDiagnostics(result?.text ?? ''),
    }
    logger.info('hermes', '请求成功', { response: sanitizedResult.text })
    return sanitizedResult
  } catch (err) {
    logger.error('hermes', '请求失败', {
      error: err instanceof Error ? err.message : String(err),
      hadImages: imageAttachments.length > 0,
      model: modelConfig?.activeModel,
      provider: modelConfig?.provider,
    })
    throw toHermesError(err, imageAttachments.length > 0)
  }
}

export const streamHermesMessage = async (
  prompt: string,
  sessionId: string | null | undefined,
  onChunk: (chunk: string) => void,
  modelConfig?: ModelRuntimeConfig,
  attachments?: MessageAttachment[],
  options?: ChatOptions,
  onEvent?: (event: AgentEvent) => void,
) => {
  if (!window.novaDesk?.chatWithHermesStream) {
    const err = 'Hermes Agent streaming is only available inside the Electron desktop app.'
    logger.error('hermes', err)
    throw new Error(err)
  }

  const imageAttachments = (attachments ?? []).filter((a) => a.type === 'image' && a.dataUrl)

  logger.info('hermes', '流式请求发送', {
    provider: modelConfig?.provider,
    model: modelConfig?.activeModel,
    prompt,
    sessionId,
    totalAttachments: attachments?.length ?? 0,
    imageCount: imageAttachments.length,
    imageDataUrls: imageAttachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      dataUrlLength: a.dataUrl?.length ?? 0,
      dataUrlPrefix: a.dataUrl?.slice(0, 50),
    })),
  })

  try {
    const chunkFilter = createHermesChunkFilter(onChunk)
    const result = await window.novaDesk.chatWithHermesStream(
      prompt,
      sessionId,
      (chunk) => chunkFilter.push(chunk),
      modelConfig,
      attachments,
      options,
      onEvent,
    )
    chunkFilter.flush()
    const sanitizedResult = {
      ...result,
      text: stripHermesDiagnostics(result?.text ?? ''),
    }
    logger.info('hermes', '流式请求完成', { response: sanitizedResult.text })
    return sanitizedResult
  } catch (err) {
    logger.error('hermes', '流式请求失败', {
      error: err instanceof Error ? err.message : String(err),
      hadImages: imageAttachments.length > 0,
      model: modelConfig?.activeModel,
      provider: modelConfig?.provider,
    })
    throw toHermesError(err, imageAttachments.length > 0)
  }
}

export const cancelHermes = (requestId: string) => window.novaDesk?.cancelHermes(requestId)

export const replyToHermes = (requestId: string, id: string, value: string) =>
  window.novaDesk?.replyToHermes(requestId, id, value)
