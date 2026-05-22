import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type TokenUsageRecord = {
  id: string
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

type AddTokenUsageInput = Omit<TokenUsageRecord, 'id' | 'timestamp' | 'totalTokens'> & {
  id?: string
  timestamp?: number
}

type TokenUsageStore = {
  records: TokenUsageRecord[]
  addRecord: (record: AddTokenUsageInput) => void
  addRecords: (records: AddTokenUsageInput[]) => void
  clearRecords: () => void
}

const MAX_RECORDS = 10_000

export const useTokenUsageStore = create<TokenUsageStore>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (record) =>
        set((state) => {
          const next: TokenUsageRecord = {
            ...record,
            id: record.id ?? crypto.randomUUID(),
            timestamp: record.timestamp ?? Date.now(),
            totalTokens: record.inputTokens + record.outputTokens,
          }

          const records = [next, ...state.records]
          return {
            records: records.length > MAX_RECORDS ? records.slice(0, MAX_RECORDS) : records,
          }
        }),
      addRecords: (newRecords) =>
        set((state) => {
          const existingIds = new Set(state.records.map((record) => record.id))
          const recordsToAdd = newRecords
            .filter((record) => !record.id || !existingIds.has(record.id))
            .map<TokenUsageRecord>((record) => ({
              ...record,
              id: record.id ?? crypto.randomUUID(),
              timestamp: record.timestamp ?? Date.now(),
              totalTokens: record.inputTokens + record.outputTokens,
            }))

          if (recordsToAdd.length === 0) return state

          const records = [...recordsToAdd, ...state.records].sort(
            (a, b) => b.timestamp - a.timestamp,
          )
          return {
            records: records.length > MAX_RECORDS ? records.slice(0, MAX_RECORDS) : records,
          }
        }),
      clearRecords: () => set({ records: [] }),
    }),
    {
      name: 'nova-desk-token-usage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ records: state.records }),
    },
  ),
)
