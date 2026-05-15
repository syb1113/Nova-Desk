import { Brain, Hexagon, Moon, Sparkles, Waves } from 'lucide-react'

export type ModelProviderId = 'deepseek' | 'kimi' | 'glm' | 'minimax' | 'mimo'
export type ApiProtocol = 'anthropic' | 'openai'

export type ModelProviderConfig = {
  enabled: boolean
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  activeModel: string
  models: string[]
}

export type ModelRuntimeConfig = ModelProviderConfig & {
  provider: ModelProviderId
}

export const modelProviders = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: Waves,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultProtocol: 'openai',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: Moon,
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultProtocol: 'openai',
    defaultModel: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    id: 'glm',
    name: 'GLM',
    icon: Sparkles,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultProtocol: 'openai',
    defaultModel: 'glm-4.5',
    models: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    icon: Hexagon,
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultProtocol: 'openai',
    defaultModel: 'MiniMax-M1',
    models: ['MiniMax-M1', 'abab6.5s-chat', 'abab6.5g-chat'],
  },
  {
    id: 'mimo',
    name: 'Mimo',
    icon: Brain,
    defaultBaseUrl: 'https://api.mimo.ai/v1',
    defaultProtocol: 'openai',
    defaultModel: 'mimo-chat',
    models: ['mimo-chat', 'mimo-reasoner'],
  },
] as const satisfies ReadonlyArray<{
  id: ModelProviderId
  name: string
  icon: typeof Waves
  defaultBaseUrl: string
  defaultProtocol: ApiProtocol
  defaultModel: string
  models: string[]
}>

export const defaultModelConfigs = Object.fromEntries(
  modelProviders.map((provider) => [
    provider.id,
    {
      enabled: provider.id === 'deepseek',
      apiKey: '',
      baseUrl: provider.defaultBaseUrl,
      protocol: provider.defaultProtocol,
      activeModel: provider.defaultModel,
      models: [...provider.models],
    },
  ]),
) as Record<ModelProviderId, ModelProviderConfig>

export const getProviderMeta = (providerId: ModelProviderId) =>
  modelProviders.find((provider) => provider.id === providerId) ?? modelProviders[0]
