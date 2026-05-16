import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import { applyTheme } from '../config/theme'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SettingsModal } from './SettingsModal'
import { TopIconMenu } from './TopIconMenu'

export const AppLayout = () => {
  const activeTheme = useWorkspaceStore((state) => state.activeTheme)

  useEffect(() => {
    applyTheme(activeTheme)
  }, [activeTheme])

  return (
    <ConfigProvider
      theme={{
        algorithm: activeTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          borderRadius: 8,
          colorPrimary: 'rgb(var(--color-primary))',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
      }}
    >
      <div className="min-h-screen bg-background text-text">
        <TopIconMenu />
        <main className="flex min-h-screen min-w-0 flex-col bg-card">
          <Outlet />
        </main>
        <SettingsModal />
      </div>
    </ConfigProvider>
  )
}
