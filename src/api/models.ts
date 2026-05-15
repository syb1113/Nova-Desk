export type ModelStatus = {
  id: string
  provider: string
  status: 'ready' | 'pending' | 'offline'
}

export const listModelStatuses = async (): Promise<ModelStatus[]> => {
  return [
    { id: 'deepseek-chat', provider: 'DeepSeek', status: 'ready' },
    { id: 'deepseek-reasoner', provider: 'DeepSeek', status: 'ready' },
    { id: 'hermes-agent-local', provider: 'HermesAgent', status: 'pending' },
  ]
}
