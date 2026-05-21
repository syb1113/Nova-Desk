import { contextBridge, ipcRenderer } from 'electron'
import { randomUUID } from 'node:crypto'

contextBridge.exposeInMainWorld('novaDesk', {
  getRuntimeInfo: () => ipcRenderer.invoke('nova:runtime-info'),
  getSkillsRoot: () => ipcRenderer.invoke('skills:get-root'),
  listSkillPackages: () => ipcRenderer.invoke('skills:list-packages'),
  readSkillPackage: (packageId: string) => ipcRenderer.invoke('skills:read-package', packageId),
  writeSkillPackage: (packageId: string, files: { path: string; content: string }[]) =>
    ipcRenderer.invoke('skills:write-package', { packageId, files }),
  deleteSkillPackage: (packageId: string) => ipcRenderer.invoke('skills:delete-package', packageId),
  selectSkillFolder: () => ipcRenderer.invoke('skills:select-folder'),
  revealSkillsRoot: () => ipcRenderer.invoke('skills:reveal-root'),
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
