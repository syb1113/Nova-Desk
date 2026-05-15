import type { ModelRuntimeConfig } from '../config/modelProviders'

export type NovaRuntimeInfo = {
  appName: string
  version: string
  platform: string
}

export type HermesChatResponse = {
  text: string
  sessionId: string | null
}

declare global {
  interface Window {
    novaDesk?: {
      getRuntimeInfo: () => Promise<NovaRuntimeInfo>
      chatWithHermes: (
        prompt: string,
        sessionId?: string | null,
        modelConfig?: ModelRuntimeConfig,
      ) => Promise<HermesChatResponse>
      chatWithHermesStream: (
        prompt: string,
        sessionId: string | null | undefined,
        onChunk: (chunk: string) => void,
        modelConfig?: ModelRuntimeConfig,
      ) => Promise<HermesChatResponse>
    }
  }
}
