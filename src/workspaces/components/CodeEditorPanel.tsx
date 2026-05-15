import Editor from '@monaco-editor/react'

const initialCode = `import { createAgent } from '@nova/hermes-agent'

export const agent = createAgent({
  model: 'deepseek-chat',
  tools: [],
})
`

export const CodeEditorPanel = () => {
  return (
    <section className="min-h-0 overflow-hidden rounded-md border border-border bg-card shadow-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Code Editor</h2>
      </div>
      <div className="h-[calc(100%-45px)] min-h-0">
        <Editor
          height="100%"
          defaultLanguage="typescript"
          defaultValue={initialCode}
          theme="vs-dark"
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            padding: { top: 16 },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </section>
  )
}
