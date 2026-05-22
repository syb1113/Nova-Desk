import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  id: string
  timestamp: string
  level: LogLevel
  category: string
  message: string
  data?: unknown
}

const MAX_LOGS = 500

type LogStore = {
  logs: LogEntry[]
  addLog: (level: LogLevel, category: string, message: string, data?: unknown) => void
  clearLogs: () => void
  clearOlderThan: (ms: number) => void
}

export const useLogStore = create<LogStore>()(
  persist(
    (set) => ({
      logs: [],

      addLog: (level, category, message, data) =>
        set((state) => {
          const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            category,
            message,
            data: data !== undefined ? safeSerialize(data) : undefined,
          }
          const next = [entry, ...state.logs]
          return { logs: next.length > MAX_LOGS ? next.slice(0, MAX_LOGS) : next }
        }),

      clearLogs: () => set({ logs: [] }),

      clearOlderThan: (ms) =>
        set((state) => {
          const cutoff = Date.now() - ms
          return { logs: state.logs.filter((l) => new Date(l.timestamp).getTime() > cutoff) }
        }),
    }),
    {
      name: 'nova-desk-logs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ logs: state.logs }),
    },
  ),
)

function safeSerialize(value: unknown): unknown {
  try {
    JSON.parse(JSON.stringify(value))
    return value
  } catch {
    return String(value)
  }
}

// ── Convenience logger ──────────────────────────────────────────────────────

const store = () => useLogStore.getState()

export const logger = {
  debug: (category: string, message: string, data?: unknown) =>
    store().addLog('debug', category, message, data),
  info: (category: string, message: string, data?: unknown) =>
    store().addLog('info', category, message, data),
  warn: (category: string, message: string, data?: unknown) =>
    store().addLog('warn', category, message, data),
  error: (category: string, message: string, data?: unknown) =>
    store().addLog('error', category, message, data),
}
