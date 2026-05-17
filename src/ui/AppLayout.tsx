import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import { applyTheme } from '../config/theme'
import { useWorkspaceStore } from '../state/workspaceStore'
import { LeftIconMenu } from './LeftIconMenu'
import { SettingsModal } from './SettingsModal'

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
      <div className="flex h-screen overflow-hidden bg-background text-text">
        <LeftIconMenu />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
          <Outlet />
        </main>
        <SettingsModal />
      </div>
    </ConfigProvider>
  )
}
