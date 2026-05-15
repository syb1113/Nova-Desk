import { Moon, Sun } from 'lucide-react'
import { useWorkspaceStore } from '../state/workspaceStore'

export const TopBar = () => {
  const activeModel = useWorkspaceStore((state) => state.activeModel)
  const activeTheme = useWorkspaceStore((state) => state.activeTheme)
  const setActiveTheme = useWorkspaceStore((state) => state.setActiveTheme)

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <div>
        <div className="text-sm font-semibold">Nova Desk</div>
        <div className="text-xs text-text/55">Hermes Agent via {activeModel}</div>
      </div>

      <button
        type="button"
        aria-label="Toggle theme"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-text transition hover:border-primary hover:text-primary"
        onClick={() => setActiveTheme(activeTheme === 'light' ? 'dark' : 'light')}
      >
        {activeTheme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
      </button>
    </header>
  )
}
