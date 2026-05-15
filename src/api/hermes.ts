import type { ModelRuntimeConfig } from '../config/modelProviders'

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
}

export const sendHermesMessage = async (
  prompt: string,
  sessionId?: string | null,
  modelConfig?: ModelRuntimeConfig,
) => {
  if (!window.novaDesk?.chatWithHermes) {
    throw new Error('Hermes Agent is only available inside the Electron desktop app.')
  }

  return window.novaDesk.chatWithHermes(prompt, sessionId, modelConfig)
}

export const streamHermesMessage = async (
  prompt: string,
  sessionId: string | null | undefined,
  onChunk: (chunk: string) => void,
  modelConfig?: ModelRuntimeConfig,
) => {
  if (!window.novaDesk?.chatWithHermesStream) {
    throw new Error('Hermes Agent streaming is only available inside the Electron desktop app.')
  }

  return window.novaDesk.chatWithHermesStream(prompt, sessionId, onChunk, modelConfig)
}
