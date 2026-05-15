import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { defaultModelConfigs, type ModelProviderConfig, type ModelProviderId, type ModelRuntimeConfig } from '../config/modelProviders'
import type { ChatMessage } from '../api/hermes'
import type { ThemeMode } from '../config/theme'

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  hermesSessionId: string | null
  messages: ChatMessage[]
}

type WorkspaceStore = {
  activeModel: string
  activeProvider: ModelProviderId
  activeTheme: ThemeMode
  activeChatId: string
  chatSessions: ChatSession[]
  isSettingsOpen: boolean
  modelConfigs: Record<ModelProviderId, ModelProviderConfig>
  activeChat: () => ChatSession
  getActiveModelConfig: () => ModelRuntimeConfig
  appendMessage: (chatId: string, message: ChatMessage) => void
  createChat: () => string
  renameChat: (chatId: string, title: string) => void
  setActiveChat: (chatId: string) => void
  setChatHermesSessionId: (chatId: string, sessionId: string | null) => void
  setActiveModel: (model: string) => void
  setActiveProvider: (provider: ModelProviderId) => void
  setActiveTheme: (theme: ThemeMode) => void
  setSettingsOpen: (open: boolean) => void
  updateModelConfig: (provider: ModelProviderId, config: Partial<ModelProviderConfig>) => void
  updateMessage: (chatId: string, messageId: string, updater: (message: ChatMessage) => ChatMessage) => void
}

const createEmptyChat = (): ChatSession => {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    hermesSessionId: null,
    messages: [],
  }
}

const initialChat = createEmptyChat()

const touchChat = (chat: ChatSession): ChatSession => ({
  ...chat,
  updatedAt: Date.now(),
})

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      activeModel: 'deepseek-chat',
      activeProvider: 'deepseek',
      activeTheme: 'light',
      activeChatId: initialChat.id,
      chatSessions: [initialChat],
      isSettingsOpen: false,
      modelConfigs: defaultModelConfigs,
      activeChat: () => {
        const state = get()
        return state.chatSessions.find((chat) => chat.id === state.activeChatId) ?? state.chatSessions[0] ?? initialChat
      },
      getActiveModelConfig: () => {
        const state = get()
        const config = state.modelConfigs[state.activeProvider]

        return {
          ...config,
          provider: state.activeProvider,
          activeModel: state.activeModel || config.activeModel,
        }
      },
      appendMessage: (chatId, message) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId
              ? touchChat({
                  ...chat,
                  messages: [...chat.messages, message],
                })
              : chat,
          ),
        })),
      createChat: () => {
        const chat = createEmptyChat()
        set((state) => ({
          activeChatId: chat.id,
          chatSessions: [chat, ...state.chatSessions],
        }))
        return chat.id
      },
      renameChat: (chatId, title) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) => (chat.id === chatId ? touchChat({ ...chat, title }) : chat)),
        })),
      setActiveChat: (activeChatId) => set({ activeChatId }),
      setChatHermesSessionId: (chatId, hermesSessionId) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId ? touchChat({ ...chat, hermesSessionId }) : chat,
          ),
        })),
      setActiveModel: (activeModel) => set({ activeModel }),
      setActiveProvider: (activeProvider) =>
        set((state) => ({
          activeProvider,
          activeModel: state.modelConfigs[activeProvider].activeModel,
        })),
      setActiveTheme: (activeTheme) => set({ activeTheme }),
      setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
      updateModelConfig: (provider, config) =>
        set((state) => ({
          modelConfigs: {
            ...state.modelConfigs,
            [provider]: {
              ...state.modelConfigs[provider],
              ...config,
            },
          },
        })),
      updateMessage: (chatId, messageId, updater) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId
              ? touchChat({
                  ...chat,
                  messages: chat.messages.map((message) => (message.id === messageId ? updater(message) : message)),
                })
              : chat,
          ),
        })),
    }),
    {
      name: 'nova-desk-workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeModel: state.activeModel,
        activeProvider: state.activeProvider,
        activeTheme: state.activeTheme,
        activeChatId: state.activeChatId,
        chatSessions: state.chatSessions,
        modelConfigs: state.modelConfigs,
      }),
    },
  ),
)
