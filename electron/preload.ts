import { contextBridge, ipcRenderer } from 'electron'
import { randomUUID } from 'node:crypto'

contextBridge.exposeInMainWorld('novaDesk', {
  getRuntimeInfo: () => ipcRenderer.invoke('nova:runtime-info'),
  chatWithHermes: (prompt: string, sessionId?: string | null, modelConfig?: unknown) =>
    ipcRenderer.invoke('hermes:chat', { prompt, sessionId, modelConfig }),
  chatWithHermesStream: (
    prompt: string,
    sessionId: string | null | undefined,
    onChunk: (chunk: string) => void,
    modelConfig?: unknown,
  ) => {
    const requestId = randomUUID()
    const channel = `hermes:chat-stream:${requestId}:chunk`
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => onChunk(chunk)

    ipcRenderer.on(channel, listener)

    return ipcRenderer
      .invoke('hermes:chat-stream', { prompt, requestId, sessionId, modelConfig })
      .finally(() => {
        ipcRenderer.removeListener(channel, listener)
      })
  },
})
