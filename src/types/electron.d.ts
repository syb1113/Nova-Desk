import type { MessageAttachment } from '../api/hermes'
import type { ModelRuntimeConfig } from '../config/modelProviders'

export type NovaRuntimeInfo = {
  appName: string
  version: string
  platform: string
}

export type HermesChatResponse = {
  text: string
  sessionId: string | null
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
      chatWithHermes: (
        prompt: string,
        sessionId?: string | null,
        modelConfig?: ModelRuntimeConfig,
        attachments?: MessageAttachment[],
      ) => Promise<HermesChatResponse>
      chatWithHermesStream: (
        prompt: string,
        sessionId: string | null | undefined,
        onChunk: (chunk: string) => void,
        modelConfig?: ModelRuntimeConfig,
        attachments?: MessageAttachment[],
      ) => Promise<HermesChatResponse>
    }
  }
}
