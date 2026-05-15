import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export const TerminalPanel = () => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#090C11',
        foreground: '#FFFFFF',
        cursor: '#00C2FF',
      },
    })

    terminal.open(containerRef.current)
    terminal.writeln('Nova Desk terminal ready')
    terminal.writeln('HermesAgent runtime adapter pending')

    return () => {
      terminal.dispose()
    }
  }, [])

  return (
    <section className="min-h-0 overflow-hidden rounded-md border border-border bg-card shadow-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Terminal</h2>
      </div>
      <div ref={containerRef} className="h-[calc(100%-45px)] bg-[#090C11] p-3" />
    </section>
  )
}
