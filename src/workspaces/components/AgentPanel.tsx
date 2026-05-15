import { Circle } from 'lucide-react'
import { useModelStatuses } from '../../hooks/useModelStatuses'

export const AgentPanel = () => {
  const { data = [], isLoading } = useModelStatuses()

  return (
    <section className="min-h-0 overflow-hidden rounded-md border border-border bg-card shadow-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Model Runtime</h2>
      </div>
      <div className="space-y-3 p-4">
        {isLoading ? (
          <div className="text-sm text-text/55">Loading models...</div>
        ) : (
          data.map((model) => (
            <div key={model.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{model.id}</div>
                  <div className="text-xs text-text/55">{model.provider}</div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs capitalize text-text/65">
                  <Circle className={model.status === 'ready' ? 'fill-accent text-accent' : 'fill-secondary text-secondary'} size={9} />
                  {model.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
