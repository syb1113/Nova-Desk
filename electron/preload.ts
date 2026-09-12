import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  openPath: (filePath: string) => ipcRenderer.invoke('nova:open-path', filePath),
  chatWithHermes: (prompt: string, sessionId?: string | null, modelConfig?: unknown, attachments?: unknown) =>
    ipcRenderer.invoke('hermes:chat', { prompt, sessionId, modelConfig, attachments }),
  chatWithHermesStream: (
    prompt: string,
    sessionId: string | null | undefined,
    onChunk: (chunk: string) => void,
    modelConfig?: unknown,
    attachments?: unknown,
    options?: { requestId?: string; testMode?: boolean; history?: unknown[] },
    onEvent?: (event: { type: string; text?: string }) => void,
  ) => {
    const requestId = options?.requestId || randomUUID()
    const channel = `hermes:event:${requestId}`
    const listener = (_event: Electron.IpcRendererEvent, event: { type: string; text?: string }) => {
      if (event.type === 'delta') onChunk(event.text || '')
      else onEvent?.(event)
    }

    ipcRenderer.on(channel, listener)

    return ipcRenderer
      .invoke('hermes:chat-stream', { ...options, prompt, requestId, sessionId, modelConfig, attachments })
      .finally(() => {
        ipcRenderer.removeListener(channel, listener)
      })
  },
  cancelHermes: (requestId: string) => ipcRenderer.invoke('hermes:cancel', requestId),
  replyToHermes: (requestId: string, id: string, value: string) =>
    ipcRenderer.invoke('hermes:reply', requestId, id, value),
})
