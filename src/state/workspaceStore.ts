import { create } from 'zustand'
import type { ThemeMode } from '../config/theme'

type WorkspaceStore = {
  activeModel: string
  activeTheme: ThemeMode
  setActiveModel: (model: string) => void
  setActiveTheme: (theme: ThemeMode) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeModel: 'deepseek-chat',
  activeTheme: 'light',
  setActiveModel: (activeModel) => set({ activeModel }),
  setActiveTheme: (activeTheme) => set({ activeTheme }),
}))
