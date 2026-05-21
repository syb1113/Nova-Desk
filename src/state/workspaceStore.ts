import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatMessage } from '../api/hermes'
import {
  defaultModelConfigs,
  type ModelProviderConfig,
  type ModelProviderId,
  type ModelRuntimeConfig,
} from '../config/modelProviders'
import type { ThemeMode } from '../config/theme'

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number | null
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
  streamingChatIds: Set<string>
  activeChat: () => ChatSession
  appendMessage: (chatId: string, message: ChatMessage) => void
  createChat: () => string
  deleteChat: (chatId: string) => void
  getActiveModelConfig: () => ModelRuntimeConfig
  renameChat: (chatId: string, title: string) => void
  setActiveChat: (chatId: string) => void
  setActiveModel: (model: string) => void
  setActiveModelSelection: (provider: ModelProviderId, model: string) => void
  setActiveProvider: (provider: ModelProviderId) => void
  setActiveTheme: (theme: ThemeMode) => void
  setChatHermesSessionId: (chatId: string, sessionId: string | null) => void
  setChatStreaming: (chatId: string, streaming: boolean) => void
  setSettingsOpen: (open: boolean) => void
  toggleChatPinned: (chatId: string) => void
  updateMessage: (chatId: string, messageId: string, updater: (message: ChatMessage) => ChatMessage) => void
  updateModelConfig: (provider: ModelProviderId, config: Partial<ModelProviderConfig>) => void
}

const createEmptyChat = (): ChatSession => {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    pinnedAt: null,
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
      streamingChatIds: new Set(),
      activeChat: () => {
        const state = get()
        return state.chatSessions.find((chat) => chat.id === state.activeChatId) ?? state.chatSessions[0] ?? initialChat
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
      deleteChat: (chatId) =>
        set((state) => {
          const remainingChats = state.chatSessions.filter((chat) => chat.id !== chatId)
          const fallbackChat = remainingChats[0] ?? createEmptyChat()
          const nextChats = remainingChats.length > 0 ? remainingChats : [fallbackChat]

          return {
            activeChatId: state.activeChatId === chatId ? fallbackChat.id : state.activeChatId,
            chatSessions: nextChats,
          }
        }),
      getActiveModelConfig: () => {
        const state = get()
        const config = state.modelConfigs[state.activeProvider]

        return {
          ...config,
          provider: state.activeProvider,
          activeModel: state.activeModel || config.activeModel,
        }
      },
      renameChat: (chatId, title) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId ? touchChat({ ...chat, title: title.trim() || '新对话' }) : chat,
          ),
        })),
      setActiveChat: (activeChatId) => set({ activeChatId }),
      setActiveModel: (activeModel) => set({ activeModel }),
      setActiveModelSelection: (activeProvider, activeModel) =>
        set((state) => ({
          activeProvider,
          activeModel,
          modelConfigs: {
            ...state.modelConfigs,
            [activeProvider]: {
              ...state.modelConfigs[activeProvider],
              activeModel,
            },
          },
        })),
      setActiveProvider: (activeProvider) =>
        set((state) => ({
          activeProvider,
          activeModel: state.modelConfigs[activeProvider].activeModel,
        })),
      setActiveTheme: (activeTheme) => set({ activeTheme }),
      setChatHermesSessionId: (chatId, hermesSessionId) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId ? touchChat({ ...chat, hermesSessionId }) : chat,
          ),
        })),
      setChatStreaming: (chatId, streaming) =>
        set((state) => {
          const next = new Set(state.streamingChatIds)

          if (streaming) {
            next.add(chatId)
          } else {
            next.delete(chatId)
          }

          return { streamingChatIds: next }
        }),
      setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
      toggleChatPinned: (chatId) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  pinnedAt: chat.pinnedAt ? null : Date.now(),
                }
              : chat,
          ),
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
