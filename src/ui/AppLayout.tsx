import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { applyTheme } from '../config/theme'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SettingsModal } from './SettingsModal'
import { Sidebar } from './Sidebar'

export const AppLayout = () => {
  const activeTheme = useWorkspaceStore((state) => state.activeTheme)

  useEffect(() => {
    applyTheme(activeTheme)
  }, [activeTheme])

  return (
    <div className="min-h-screen bg-background text-text">
      <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)]">
        <Sidebar />
        <main className="flex min-h-screen min-w-0 flex-col bg-card">
          <Outlet />
        </main>
      </div>
      <SettingsModal />
    </div>
  )
}
