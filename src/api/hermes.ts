import type { ModelRuntimeConfig } from '../config/modelProviders'
import type { AppliedSkill } from '../types/skill'
import { logger } from '../state/logStore'

export type ChatRole = 'user' | 'assistant' | 'system'

export type MessageAttachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType: string
  dataUrl?: string
  textContent?: string
  size: number
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  appliedSkills?: AppliedSkill[]
  attachments?: MessageAttachment[]
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

  logger.info('hermes', '请求发送', {
    provider: modelConfig?.provider,
    model: modelConfig?.activeModel,
    prompt,
    sessionId,
    attachmentCount: attachments?.length ?? 0,
    imageAttachmentCount: attachments?.filter((attachment) => attachment.type === 'image' && attachment.dataUrl).length ?? 0,
  })

  try {
    const result = await window.novaDesk.chatWithHermes(prompt, sessionId, modelConfig, attachments)
    logger.info('hermes', '请求成功', { response: result?.text })
    return result
  } catch (err) {
    logger.error('hermes', '请求失败', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export const streamHermesMessage = async (
  prompt: string,
  sessionId: string | null | undefined,
  onChunk: (chunk: string) => void,
  modelConfig?: ModelRuntimeConfig,
  attachments?: MessageAttachment[],
) => {
  if (!window.novaDesk?.chatWithHermesStream) {
    const err = 'Hermes Agent streaming is only available inside the Electron desktop app.'
    logger.error('hermes', err)
    throw new Error(err)
  }

  logger.info('hermes', '流式请求发送', {
    provider: modelConfig?.provider,
    model: modelConfig?.activeModel,
    prompt,
    sessionId,
    attachmentCount: attachments?.length ?? 0,
    imageAttachmentCount: attachments?.filter((attachment) => attachment.type === 'image' && attachment.dataUrl).length ?? 0,
  })

  try {
    const result = await window.novaDesk.chatWithHermesStream(prompt, sessionId, onChunk, modelConfig, attachments)
    logger.info('hermes', '流式请求完成', { response: result?.text })
    return result
  } catch (err) {
    logger.error('hermes', '流式请求失败', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
