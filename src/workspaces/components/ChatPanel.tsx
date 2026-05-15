import { Send } from 'lucide-react'

export const ChatPanel = () => {
  return (
    <section className="rounded-md border border-border bg-card shadow-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Assistant</h2>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-md bg-background p-3 text-sm text-text/70">
          DeepSeek is the primary model provider. HermesAgent desktop capabilities can be wired into this panel later.
        </div>
        <div className="flex items-center gap-2">
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            placeholder="Ask Nova Desk..."
          />
          <button
            type="button"
            aria-label="Send"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white hover:bg-primary/90"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
