import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { applyTheme, theme as appTheme } from '../config/theme'
import { useWorkspaceStore } from '../state/workspaceStore'
import { LeftIconMenu } from './LeftIconMenu'
import { SettingsModal } from './SettingsModal'

export const AppLayout = () => {
  const activeTheme = useWorkspaceStore((state) => state.activeTheme)
  const palette = appTheme.modes[activeTheme]

  useEffect(() => {
    applyTheme(activeTheme)
  }, [activeTheme])

  return (
    <ConfigProvider
      theme={{
        algorithm: activeTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          borderRadius: 12,
          colorBgBase: palette.card,
          colorBgContainer: palette.card,
          colorBgElevated: palette.card,
          colorBgLayout: palette.background,
          colorBorder: palette.border,
          colorBorderSecondary: palette.border,
          colorError: palette.danger,
          colorFillAlter: palette.surface,
          colorFillSecondary: palette.surface,
          colorPrimary: palette.primary,
          colorText: palette.text,
          colorTextSecondary: palette.textSecondary,
          colorTextTertiary: palette.textMuted,
          controlItemBgActive: palette.surfaceHover,
          controlItemBgHover: palette.surface,
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
