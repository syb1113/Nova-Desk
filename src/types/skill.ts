export type SkillSource = 'builtin' | 'custom'
export type SkillScope = 'global' | 'workspace'
export type SkillPackageSource = 'builtin' | 'quick' | 'file' | 'zip' | 'folder'

export type SkillManifest = {
  id?: string
  name: string
  description: string
  triggers: string[]
  version?: string
  author?: string
  tags?: string[]
  references?: string[]
  entryFile?: string
}

export type SkillPackageFile = {
  path: string
  content: string
}

export type SkillConfig = {
  id: string
  name: string
  description: string
  source: SkillSource
  scope: SkillScope
  enabled: boolean
  autoMatch: boolean
  triggers: string[]
  content: string
  packageSource: SkillPackageSource
  entryFile: string
  rootPath?: string
  files?: Record<string, string>
  references?: string[]
  version?: string
  author?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

/** Metadata attached to a chat message showing which skills were applied. */
export type AppliedSkill = {
  id: string
  name: string
}
