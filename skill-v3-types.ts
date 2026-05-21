/**
 * V3 Skill Package Type System
 *
 * 核心变化：从"技能内容"转向"技能包"
 * - 本地只存索引（PackageIndex），文件本体留在磁盘
 * - 匹配时只读 manifest，注入时才读 SKILL.md
 * - 支持 SKILL.md / 文件夹 / zip 三种导入
 */

/* ── 1. Skill Manifest（轻量元数据，用于匹配和列表展示）─────────────────── */

export interface SkillManifest {
  /** 唯一标识，自动生成（基于 rootPath 或内容哈希） */
  id: string
  /** 显示名称 */
  name: string
  /** 一句话描述 */
  description: string
  /** 触发关键词列表，用于 @ 匹配 */
  triggers: string[]
  /** 版本号（可选，来自 skill.json 或 frontmatter） */
  version?: string
  /** 作者（可选） */
  author?: string
  /** 标签，用于分类筛选 */
  tags?: string[]
  /** 此 skill 包含的引用文件路径列表（相对于 rootPath） */
  references?: string[]
  /** 入口文件名，默认 'SKILL.md' */
  entryFile?: string
}

/* ── 2. Skill Package（完整包，含 manifest + 可选内容）───────────────────── */

export type SkillPackageSource = 'folder' | 'file' | 'zip' | 'quick'

export interface SkillPackage {
  /** 从 manifest 读取的元数据 */
  manifest: SkillManifest
  /** 包在磁盘上的根路径 */
  rootPath: string
  /** 来源类型 */
  source: SkillPackageSource
}

/* ── 3. Package Index（持久化到 localStorage / Zustand 的索引条目）─────── */

export interface PackageIndex {
  /** 对应 manifest.id */
  id: string
  /** 包的根路径 */
  rootPath: string
  /** 来源类型 */
  source: SkillPackageSource
  /** 用户是否启用此 skill */
  enabled: boolean
  /** 用户覆盖项：可覆盖 manifest 中的 name / description / triggers */
  overrides: Partial<Pick<SkillManifest, 'name' | 'description' | 'triggers'>>
  /** scope 决定 skill 的作用范围（可选扩展用） */
  scope?: 'global' | 'project'
  /** 创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
}

/* ── 4. Applied Skill（已匹配并注入的 skill，附加到消息上）─────────────── */

export interface AppliedSkill {
  /** 对应 manifest.id */
  id: string
  /** 显示名称（已应用 overrides） */
  name: string
  /** 本次注入的 SKILL.md 内容 */
  injectedContent: string
  /** 本次注入的引用内容（可选） */
  injectedReferences?: Record<string, string>
}

/* ── 5. Import Source（三种导入方式）───────────────────────────────────── */

/** 导入 SKILL.md 单文件 → 生成一个只有 SKILL.md 的技能包 */
export interface SkillImportFile {
  type: 'file'
  /** SKILL.md 的原始内容 */
  content: string
  /** 原始文件名 */
  fileName: string
}

/** 导入文件夹 → 完整技能包 */
export interface SkillImportFolder {
  type: 'folder'
  /** 文件夹路径 */
  path: string
}

/** 导入 zip → 解压为技能包 */
export interface SkillImportZip {
  type: 'zip'
  /** zip 文件的 ArrayBuffer 或路径 */
  data: ArrayBuffer | string
  /** 目标解压目录（可选，默认自动生成） */
  targetPath?: string
}

export type SkillImportSource = SkillImportFile | SkillImportFolder | SkillImportZip

/* ── 6. Quick Skill（纯 Markdown 快捷技能）───────────────────────────── */

export interface QuickSkill {
  /** 技能名称 */
  name: string
  /** Markdown 内容 */
  content: string
  /** 触发关键词（可选，默认使用 name） */
  triggers?: string[]
}

/* ── 7. FileReference（引用文件，按需读取）────────────────────────────── */

export interface FileReference {
  /** 相对于 rootPath 的路径 */
  relativePath: string
  /** 文件描述（来自 manifest 中的 references 配置） */
  description?: string
}
