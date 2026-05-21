import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AppliedSkill,
  SkillConfig,
  SkillManifest,
  SkillPackageSource,
  SkillScope,
} from '../types/skill'

const MAX_INJECT = 3
const DEFAULT_ENTRY_FILE = 'SKILL.md'

type SkillDraft = {
  id?: string
  name: string
  description: string
  scope?: SkillScope
  enabled?: boolean
  autoMatch?: boolean
  triggers?: string[]
  content: string
  packageSource?: SkillPackageSource
  entryFile?: string
  rootPath?: string
  files?: Record<string, string>
  references?: string[]
  version?: string
  author?: string
  tags?: string[]
}

type MatchResult = {
  skills: SkillConfig[]
  applied: AppliedSkill[]
  injectedContext: string
}

type SkillStore = {
  builtinSkills: SkillConfig[]
  customSkills: SkillConfig[]
  autoMatchEnabled: boolean
  addCustomSkill: (skill: SkillDraft) => void
  updateSkill: (id: string, updates: Partial<SkillConfig>) => void
  deleteCustomSkill: (id: string) => void
  toggleSkillEnabled: (id: string) => void
  setAutoMatchEnabled: (enabled: boolean) => void
  importSkill: (skill: SkillDraft) => void
  importSkillPackage: (skill: SkillDraft) => void
  upsertSkillPackage: (skill: SkillDraft) => void
  getEnabledSkills: () => SkillConfig[]
  matchSkills: (input: string) => MatchResult
}

const createSkill = (skill: SkillDraft, source: SkillConfig['source'], id: string = crypto.randomUUID()): SkillConfig => {
  const entryFile = skill.entryFile || DEFAULT_ENTRY_FILE
  const files = skill.files ?? { [entryFile]: skill.content }

  return {
    id,
    name: skill.name,
    description: skill.description,
    source,
    scope: skill.scope ?? 'global',
    enabled: skill.enabled ?? true,
    autoMatch: skill.autoMatch ?? true,
    triggers: skill.triggers ?? [],
    content: skill.content,
    packageSource: skill.packageSource ?? (source === 'builtin' ? 'builtin' : 'quick'),
    entryFile,
    rootPath: skill.rootPath,
    files,
    references: skill.references ?? [],
    version: skill.version,
    author: skill.author,
    tags: skill.tags ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const normalizeSkill = (skill: SkillConfig): SkillConfig => {
  const entryFile = skill.entryFile || DEFAULT_ENTRY_FILE
  return {
    ...skill,
    packageSource: skill.packageSource ?? (skill.source === 'builtin' ? 'builtin' : 'quick'),
    entryFile,
    rootPath: skill.rootPath,
    files: skill.files ?? { [entryFile]: skill.content },
    references: skill.references ?? [],
    tags: skill.tags ?? [],
  }
}

const builtinSkills: SkillConfig[] = [
  createSkill(
    {
      name: 'Web UI 工程',
      description: '前端组件开发、CSS 布局、响应式设计和无障碍访问的实践规则。',
      triggers: ['前端', 'UI', '组件', 'CSS', '布局', '响应式', 'React', 'Vue'],
      content:
        '你是一名资深前端工程师。回答时优先考虑组件复用、无障碍访问、响应式设计和性能优化。使用语义化 HTML 和现代 CSS，给出可直接运行的代码片段。',
      packageSource: 'builtin',
    },
    'builtin',
    'builtin-web-ui',
  ),
  createSkill(
    {
      name: '代码审查',
      description: '结构化审查代码，关注正确性、安全性、性能和可维护性。',
      triggers: ['review', '代码审查', 'CR', 'code review', '审查'],
      content:
        '你是一名严格的代码审查者。优先列出 bug、风险、行为回归和缺失测试，并提供具体文件、行号和修改建议。',
      packageSource: 'builtin',
    },
    'builtin',
    'builtin-code-review',
  ),
  createSkill(
    {
      name: '调试排错',
      description: '系统性排查 Bug，从复现、定位根因到给出修复方案。',
      triggers: ['bug', '调试', '排错', 'error', '报错', '异常', 'debug', '崩溃'],
      content:
        '你是一名调试专家。收到错误信息后按复现条件、堆栈分析、根因假设、验证方法、修复方案的顺序推进。',
      packageSource: 'builtin',
    },
    'builtin',
    'builtin-debug',
  ),
  createSkill(
    {
      name: '文档生成',
      description: '生成结构清晰的技术文档，包括 README、API 文档、变更日志等。',
      enabled: false,
      triggers: ['文档', 'README', 'API 文档', 'changelog', '文档生成'],
      content:
        '你是一名技术写作专家。生成文档时保持结构清晰、示例可运行、术语一致，并优先使用 Markdown 格式。',
      packageSource: 'builtin',
    },
    'builtin',
    'builtin-docs',
  ),
  createSkill(
    {
      name: 'Git 工作流',
      description: '处理 Git 分支策略、冲突解决、提交规范和 CI/CD 流程问题。',
      enabled: false,
      triggers: ['git', '分支', 'merge', 'rebase', '冲突', 'commit', 'CI', 'CD'],
      content:
        '你是一名 Git 工作流专家。回答时考虑分支策略、提交规范、冲突解决策略和 CI/CD 集成，给出可直接执行的命令。',
      packageSource: 'builtin',
    },
    'builtin',
    'builtin-git',
  ),
]

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(/[,，]/)
      .map(stripQuotes)
      .filter(Boolean)
  }
  return trimmed.split(/[,，]/).map(stripQuotes).filter(Boolean)
}

function getFrontmatterValue(meta: string, key: string): string | undefined {
  const match = meta.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'))
  return match?.[1] ? stripQuotes(match[1]) : undefined
}

function getFrontmatterList(meta: string, key: string): string[] {
  const block = meta.match(new RegExp(`^${key}\\s*:\\s*\\n((?:\\s+-\\s+.+\\n?)*)`, 'm'))
  if (block?.[1]) {
    return block[1]
      .split('\n')
      .map((line) => stripQuotes(line.replace(/^\s*-\s*/, '')))
      .filter(Boolean)
  }

  const inline = getFrontmatterValue(meta, key)
  return inline ? parseInlineList(inline) : []
}

export function parseSkillMdFrontmatter(raw: string): Omit<SkillDraft, 'packageSource'> | null {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)

  if (fmMatch) {
    const meta = fmMatch[1]
    const body = fmMatch[2].trim()
    const name = getFrontmatterValue(meta, 'name')
    if (!name) return null

    return {
      name,
      description: getFrontmatterValue(meta, 'description') ?? name,
      scope: getFrontmatterValue(meta, 'scope') === 'workspace' ? 'workspace' : 'global',
      enabled: getFrontmatterValue(meta, 'enabled') !== 'false',
      autoMatch: getFrontmatterValue(meta, 'autoMatch') !== 'false',
      triggers: getFrontmatterList(meta, 'triggers'),
      content: body,
      entryFile: getFrontmatterValue(meta, 'entryFile') ?? DEFAULT_ENTRY_FILE,
      references: getFrontmatterList(meta, 'references'),
      version: getFrontmatterValue(meta, 'version'),
      author: getFrontmatterValue(meta, 'author'),
      tags: getFrontmatterList(meta, 'tags'),
    }
  }

  const name = raw.match(/^#\s+(.+)/m)?.[1]?.trim()
  if (!name) return null

  const description = raw.match(/>\s*(.+)/)?.[1]?.trim() ?? name
  const triggers = raw.match(/trigger[s]?\s*[:：]\s*(.+)/i)?.[1]

  return {
    name,
    description,
    scope: 'global',
    enabled: true,
    autoMatch: true,
    triggers: triggers ? parseInlineList(triggers) : [],
    content: raw.replace(/^#\s+.+\n?/, '').replace(/^>\s*.+\n?/, '').trim(),
    entryFile: DEFAULT_ENTRY_FILE,
    references: [],
  }
}

export function parseSkillManifestJson(raw: string): SkillManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SkillManifest>
    if (!parsed.name || !parsed.description) return null

    return {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.filter(Boolean) : [],
      version: parsed.version,
      author: parsed.author,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean) : [],
      references: Array.isArray(parsed.references) ? parsed.references.filter(Boolean) : [],
      entryFile: parsed.entryFile ?? DEFAULT_ENTRY_FILE,
    }
  } catch {
    return null
  }
}

export function createSkillPackageFromFiles(
  files: Record<string, string>,
  source: Extract<SkillPackageSource, 'file' | 'zip' | 'folder'>,
  fallbackName: string,
): SkillDraft | null {
  const normalizedFiles = Object.fromEntries(Object.entries(files).map(([path, content]) => [path.replace(/\\/g, '/'), content]))
  const manifestEntry = Object.entries(normalizedFiles).find(([path]) => path.endsWith('skill.json'))
  const skillMdEntry =
    Object.entries(normalizedFiles).find(([path]) => path.endsWith('/SKILL.md')) ??
    Object.entries(normalizedFiles).find(([path]) => path === 'SKILL.md') ??
    Object.entries(normalizedFiles).find(([path]) => path.toLowerCase().endsWith('.md'))

  const manifest = manifestEntry ? parseSkillManifestJson(manifestEntry[1]) : null
  const parsedMd = skillMdEntry ? parseSkillMdFrontmatter(skillMdEntry[1]) : null

  if (!manifest && !parsedMd) return null

  const entryFile = manifest?.entryFile ?? parsedMd?.entryFile ?? skillMdEntry?.[0] ?? DEFAULT_ENTRY_FILE
  const entryContent = normalizedFiles[entryFile] ?? skillMdEntry?.[1] ?? parsedMd?.content ?? ''

  return {
    name: manifest?.name ?? parsedMd?.name ?? fallbackName,
    description: manifest?.description ?? parsedMd?.description ?? fallbackName,
    scope: parsedMd?.scope ?? 'global',
    enabled: parsedMd?.enabled ?? true,
    autoMatch: parsedMd?.autoMatch ?? true,
    triggers: manifest?.triggers.length ? manifest.triggers : parsedMd?.triggers ?? [],
    content: entryContent,
    packageSource: source,
    id: manifest?.id,
    entryFile,
    files: normalizedFiles,
    references: manifest?.references ?? parsedMd?.references ?? [],
    version: manifest?.version ?? parsedMd?.version,
    author: manifest?.author ?? parsedMd?.author,
    tags: manifest?.tags ?? parsedMd?.tags ?? [],
  }
}

export function exportSkillAsMd(skill: SkillConfig): string {
  const normalized = normalizeSkill(skill)
  const triggersYaml = normalized.triggers.map((trigger) => `  - ${trigger}`).join('\n')
  const referencesYaml = normalized.references?.map((reference) => `  - ${reference}`).join('\n') ?? ''
  const tagsYaml = normalized.tags?.map((tag) => `  - ${tag}`).join('\n') ?? ''

  return `---
name: ${normalized.name}
description: ${normalized.description}
scope: ${normalized.scope}
autoMatch: ${normalized.autoMatch}
entryFile: ${normalized.entryFile}
triggers:
${triggersYaml || '  - '}
references:
${referencesYaml || '  - '}
tags:
${tagsYaml || '  - '}
---

${getSkillEntryContent(normalized)}
`
}

function extractExplicitSkills(input: string): { names: string[]; cleaned: string } {
  const names: string[] = []
  const withoutAtSkill = input.replace(/@skill[:：]([^\s@]+)/g, (_match, name: string) => {
    names.push(name.trim())
    return ''
  })
  const cleaned = withoutAtSkill.replace(/(^|\s)\/([^\s/]+)/g, (match, prefix: string, name: string) => {
    names.push(name.trim())
    return prefix || ''
  })
  return { names, cleaned }
}

function triggerMatch(input: string, triggers: string[]): boolean {
  const lower = input.toLowerCase()
  return triggers.some((trigger) => lower.includes(trigger.toLowerCase()))
}

function getSkillEntryContent(skill: SkillConfig): string {
  const normalized = normalizeSkill(skill)
  return normalized.files?.[normalized.entryFile] ?? normalized.content
}

export const useSkillStore = create<SkillStore>()(
  persist(
    (set, get) => ({
      builtinSkills,
      customSkills: [],
      autoMatchEnabled: true,

      addCustomSkill: (skill) => {
        set((state) => ({
          customSkills: [...state.customSkills.map(normalizeSkill), createSkill(skill, 'custom')],
        }))
      },

      updateSkill: (id, updates) => {
        const now = new Date().toISOString()
        set((state) => ({
          builtinSkills: state.builtinSkills.map((skill) =>
            skill.id === id ? normalizeSkill({ ...skill, ...updates, updatedAt: now }) : normalizeSkill(skill),
          ),
          customSkills: state.customSkills.map((skill) =>
            skill.id === id ? normalizeSkill({ ...skill, ...updates, updatedAt: now }) : normalizeSkill(skill),
          ),
        }))
      },

      deleteCustomSkill: (id) =>
        set((state) => ({
          customSkills: state.customSkills.filter((skill) => skill.id !== id).map(normalizeSkill),
        })),

      toggleSkillEnabled: (id) => {
        const now = new Date().toISOString()
        set((state) => ({
          builtinSkills: state.builtinSkills.map((skill) =>
            skill.id === id ? normalizeSkill({ ...skill, enabled: !skill.enabled, updatedAt: now }) : normalizeSkill(skill),
          ),
          customSkills: state.customSkills.map((skill) =>
            skill.id === id ? normalizeSkill({ ...skill, enabled: !skill.enabled, updatedAt: now }) : normalizeSkill(skill),
          ),
        }))
      },

      setAutoMatchEnabled: (autoMatchEnabled) => set({ autoMatchEnabled }),

      importSkill: (skill) => {
        set((state) => ({
          customSkills: [...state.customSkills.map(normalizeSkill), createSkill(skill, 'custom')],
        }))
      },

      importSkillPackage: (skill) => {
        set((state) => ({
          customSkills: [...state.customSkills.map(normalizeSkill), createSkill(skill, 'custom', skill.id)],
        }))
      },

      upsertSkillPackage: (skill) => {
        const nextSkill = createSkill(skill, 'custom', skill.id)
        set((state) => ({
          customSkills: [
            ...state.customSkills.map(normalizeSkill).filter((current) => current.id !== nextSkill.id),
            nextSkill,
          ],
        }))
      },

      getEnabledSkills: () => {
        const state = get()
        return [
          ...state.builtinSkills.map(normalizeSkill).filter((skill) => skill.enabled),
          ...state.customSkills.map(normalizeSkill).filter((skill) => skill.enabled),
        ]
      },

      matchSkills: (input) => {
        const state = get()
        const enabled = [
          ...state.builtinSkills.map(normalizeSkill).filter((skill) => skill.enabled),
          ...state.customSkills.map(normalizeSkill).filter((skill) => skill.enabled),
        ]

        const { names: explicitNames, cleaned } = extractExplicitSkills(input)
        const explicitMatches = enabled.filter((skill) =>
          explicitNames.some((name) => skill.name === name || skill.id === name || skill.name.includes(name)),
        )

        const autoMatches = state.autoMatchEnabled
          ? enabled.filter(
              (skill) =>
                skill.autoMatch &&
                triggerMatch(cleaned, skill.triggers) &&
                !explicitMatches.some((matched) => matched.id === skill.id),
            )
          : []

        const allMatches = [...explicitMatches, ...autoMatches].slice(0, MAX_INJECT)
        const applied: AppliedSkill[] = allMatches.map((skill) => ({ id: skill.id, name: skill.name }))
        const injectedContext = allMatches
          .map((skill) => `[技能：${skill.name}]\n${getSkillEntryContent(skill)}`)
          .join('\n\n')

        return { skills: allMatches, applied, injectedContext }
      },
    }),
    {
      name: 'nova-desk-skills',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        builtinSkills: state.builtinSkills.map(normalizeSkill),
        customSkills: state.customSkills.map(normalizeSkill),
        autoMatchEnabled: state.autoMatchEnabled,
      }),
    },
  ),
)
