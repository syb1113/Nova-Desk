import type { AgentEvent, ChatOptions, MessageAttachment } from '../api/hermes'
import type { ModelRuntimeConfig } from '../config/modelProviders'

export type NovaRuntimeInfo = {
  appName: string
  version: string
  platform: string
}

export type HermesChatResponse = {
  text: string
  sessionId: string | null
  cancelled?: boolean
}

export type SkillFsFile = {
  path: string
  content: string
}

export type SkillPackageReadResult = {
  id: string
  rootPath: string
  files: SkillFsFile[]
}

export type SkillFolderSelection = {
  rootPath: string
  name: string
  files: SkillFsFile[]
}

declare global {
  interface Window {
    novaDesk?: {
      getRuntimeInfo: () => Promise<NovaRuntimeInfo>
      getSkillsRoot: () => Promise<string>
      listSkillPackages: () => Promise<string[]>
      readSkillPackage: (packageId: string) => Promise<SkillPackageReadResult>
      writeSkillPackage: (packageId: string, files: SkillFsFile[]) => Promise<{ id: string; rootPath: string }>
      deleteSkillPackage: (packageId: string) => Promise<void>
      selectSkillFolder: () => Promise<SkillFolderSelection | null>
      revealSkillsRoot: () => Promise<string>
      getFilePath: (file: File) => string
      openPath: (filePath: string) => Promise<string>
      chatWithHermes: (
        prompt: string,
        sessionId?: string | null,
        modelConfig?: ModelRuntimeConfig,
        attachments?: MessageAttachment[],
      ) => Promise<HermesChatResponse>
      cancelHermes: (requestId: string) => Promise<boolean>
      replyToHermes: (requestId: string, id: string, value: string) => Promise<boolean>
      chatWithHermesStream: (
        prompt: string,
        sessionId: string | null | undefined,
        onChunk: (chunk: string) => void,
        modelConfig?: ModelRuntimeConfig,
        attachments?: MessageAttachment[],
        options?: ChatOptions,
        onEvent?: (event: AgentEvent) => void,
      ) => Promise<HermesChatResponse>
    }
  }
}
