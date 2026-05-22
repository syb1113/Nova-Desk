import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ScheduleType = 'cron' | 'once' | 'interval'

export type ScheduledTask = {
  id: string
  name: string
  description: string
  scheduleType: ScheduleType
  cronExpression?: string
  fireAt?: string
  intervalMs?: number
  prompt: string
  enabled: boolean
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

type TaskDraft = Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt'>

type ScheduledTaskStore = {
  tasks: ScheduledTask[]
  addTask: (draft: TaskDraft) => void
  updateTask: (id: string, updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>>) => void
  deleteTask: (id: string) => void
  toggleTask: (id: string) => void
}

export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每周五 17:00', value: '0 17 * * 5' },
  { label: '每月1号 9:00', value: '0 9 1 * *' },
]

export const INTERVAL_PRESETS: { label: string; value: number }[] = [
  { label: '每 5 分钟', value: 5 * 60 * 1000 },
  { label: '每 15 分钟', value: 15 * 60 * 1000 },
  { label: '每 30 分钟', value: 30 * 60 * 1000 },
  { label: '每 1 小时', value: 60 * 60 * 1000 },
  { label: '每 6 小时', value: 6 * 60 * 60 * 1000 },
  { label: '每 12 小时', value: 12 * 60 * 60 * 1000 },
]

export const describeSchedule = (task: ScheduledTask): string => {
  if (task.scheduleType === 'once') {
    return task.fireAt ? `一次性 · ${new Date(task.fireAt).toLocaleString()}` : '一次性'
  }

  if (task.scheduleType === 'interval') {
    const preset = INTERVAL_PRESETS.find((p) => p.value === task.intervalMs)
    return preset ? preset.label : `每 ${(task.intervalMs ?? 0) / 60000} 分钟`
  }

  const preset = CRON_PRESETS.find((p) => p.value === task.cronExpression)
  return preset ? preset.label : task.cronExpression ?? ''
}

export const useScheduledTaskStore = create<ScheduledTaskStore>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (draft) =>
        set((state) => {
          const now = new Date().toISOString()
          const task: ScheduledTask = {
            ...draft,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          }
          return { tasks: [task, ...state.tasks] }
        }),

      updateTask: (id, updates) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? { ...task, ...updates, updatedAt: new Date().toISOString() }
              : task,
          ),
        })),

      deleteTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        })),

      toggleTask: (id) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? { ...task, enabled: !task.enabled, updatedAt: new Date().toISOString() }
              : task,
          ),
        })),
    }),
    {
      name: 'nova-desk-scheduled-tasks',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasks: state.tasks }),
    },
  ),
)
