/**
 * V3 Skill Package Service
 *
 * 职责：
 * 1. 读取 skill.json / SKILL.md frontmatter → 生成 SkillManifest
 * 2. 读取 SKILL.md 入口内容（注入时调用）
 * 3. 按需读取 references 文件
 * 4. 三种导入流程：file / folder / zip
 * 5. Quick skill → 技能包转换
 *
 * 文件系统通过 FileSystemAdapter 抽象，不同运行环境提供不同实现
 */

import type {
  QuickSkill,
  SkillImportSource,
  SkillManifest,
  SkillPackage,
  SkillPackageSource,
} from '../types/skill'

/* ── 文件系统适配器接口 ─────────────────────────────────────────────────── */

export interface FileSystemAdapter {
  /** 读取文件文本内容 */
  readFile(path: string): Promise<string>
  /** 读取文件二进制内容 */
  readFileBuffer(path: string): Promise<ArrayBuffer>
  /** 写入文件 */
  writeFile(path: string, content: string): Promise<void>
  /** 判断文件/目录是否存在 */
  exists(path: string): Promise<boolean>
  /** 列出目录下的文件名 */
  readdir(path: string): Promise<string[]>
  /** 创建目录（递归） */
  mkdir(path: string): Promise<void>
  /** 路径拼接 */
  join(...segments: string[]): string
  /** 获取文件名（不含目录） */
  basename(path: string): string
  /** 生成临时目录路径 */
  tempDir(): string
}

/* ── YAML frontmatter 解析（轻量实现，不依赖第三方库）─────────────────── */

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlStr = match[1]
  const body = match[2]
  const frontmatter: Record<string, unknown> = {}

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    // 解析数组 [a, b, c] 或 YAML 列表 - a\n- b
    if (typeof value === 'string') {
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
    }

    frontmatter[key] = value
  }

  return { frontmatter, body }
}

/* ── manifest 读取 ───────────────────────────────────────────────────── */

async function readManifestFromDisk(fs: FileSystemAdapter, rootPath: string): Promise<SkillManifest> {
  const skillJsonPath = fs.join(rootPath, 'skill.json')
  const skillMdPath = fs.join(rootPath, 'SKILL.md')

  // 优先读 skill.json
  if (await fs.exists(skillJsonPath)) {
    const raw = await fs.readFile(skillJsonPath)
    const data = JSON.parse(raw)
    return normalizeManifest(data, rootPath)
  }

  // 其次从 SKILL.md frontmatter 读取
  if (await fs.exists(skillMdPath)) {
    const content = await fs.readFile(skillMdPath)
    const { frontmatter } = parseFrontmatter(content)
    return normalizeManifest(frontmatter, rootPath)
  }

  throw new Error(`No skill.json or SKILL.md found in ${rootPath}`)
}

function normalizeManifest(data: Record<string, unknown>, rootPath: string): SkillManifest {
  const name = String(data.name ?? data.title ?? 'Unnamed Skill')
  const id = String(data.id ?? slugify(name))

  return {
    id,
    name,
    description: String(data.description ?? ''),
    triggers: Array.isArray(data.triggers)
      ? (data.triggers as string[])
      : typeof data.triggers === 'string'
        ? [data.triggers]
        : [name.toLowerCase()],
    version: data.version ? String(data.version) : undefined,
    author: data.author ? String(data.author) : undefined,
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : undefined,
    references: Array.isArray(data.references) ? (data.references as string[]) : undefined,
    entryFile: data.entryFile ? String(data.entryFile) : 'SKILL.md',
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

/* ── SkillPackageService ─────────────────────────────────────────────── */

class SkillPackageService {
  private fs: FileSystemAdapter

  constructor(fs: FileSystemAdapter) {
    this.fs = fs
  }

  /** 替换文件系统适配器（用于测试或运行环境切换） */
  setAdapter(fs: FileSystemAdapter) {
    this.fs = fs
  }

  /* ── 读取操作 ── */

  /** 读取 manifest（轻量，用于匹配和列表展示） */
  async readManifest(rootPath: string): Promise<SkillManifest> {
    return readManifestFromDisk(this.fs, rootPath)
  }

  /** 读取 SKILL.md 入口内容（注入时调用） */
  async readEntry(rootPath: string, entryFile = 'SKILL.md'): Promise<string> {
    const path = this.fs.join(rootPath, entryFile)
    return this.fs.readFile(path)
  }

  /** 按需读取单个引用文件 */
  async readReference(rootPath: string, relativePath: string): Promise<string> {
    const path = this.fs.join(rootPath, relativePath)
    return this.fs.readFile(path)
  }

  /** 批量读取引用文件（仅在需要时调用） */
  async readReferences(rootPath: string, relativePaths: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {}

    for (const rel of relativePaths) {
      try {
        result[rel] = await this.readReference(rootPath, rel)
      } catch {
        result[rel] = `[Error reading ${rel}]`
      }
    }

    return result
  }

  /* ── 导入操作（三种方式） ── */

  /** 导入 skill（统一入口） */
  async import(source: SkillImportSource): Promise<SkillPackage> {
    switch (source.type) {
      case 'file':
        return this.importFile(source.content, source.fileName)
      case 'folder':
        return this.importFolder(source.path)
      case 'zip':
        return this.importZip(source.data, source.targetPath)
    }
  }

  /**
   * 方式一：导入 SKILL.md 单文件
   * → 生成一个只有 SKILL.md 的技能包
   */
  private async importFile(content: string, fileName: string): Promise<SkillPackage> {
    const id = slugify(fileName.replace(/\.md$/i, ''))
    const rootPath = this.fs.join(this.fs.tempDir(), 'skills', id)

    await this.fs.mkdir(rootPath)
    await this.fs.writeFile(this.fs.join(rootPath, 'SKILL.md'), content)

    const manifest = await this.readManifest(rootPath)

    return { manifest, rootPath, source: 'file' }
  }

  /**
   * 方式二：导入文件夹
   * → 完整技能包，读取 skill.json 或 SKILL.md frontmatter
   */
  private async importFolder(path: string): Promise<SkillPackage> {
    if (!(await this.fs.exists(path))) {
      throw new Error(`Folder not found: ${path}`)
    }

    const manifest = await this.readManifest(path)

    return { manifest, rootPath: path, source: 'folder' }
  }

  /**
   * 方式三：导入 zip
   * → 解压到临时目录，作为技能包
   */
  private async importZip(data: ArrayBuffer | string, targetPath?: string): Promise<SkillPackage> {
    // zip 解压逻辑依赖运行环境
    // Electron: 使用 node 的 adm-zip 或 archiver
    // Web: 使用 JSZip
    // 这里定义接口，具体实现由适配器提供
    const rootPath = targetPath ?? this.fs.join(this.fs.tempDir(), 'skills', `zip-${Date.now()}`)

    await this.fs.mkdir(rootPath)
    await this.extractZip(data, rootPath)

    const manifest = await this.readManifest(rootPath)

    return { manifest, rootPath, source: 'zip' }
  }

  /** zip 解压（由具体环境实现） */
  private async extractZip(data: ArrayBuffer | string, targetPath: string): Promise<void> {
    // 默认实现：抛出提示
    // 在 Electron 中可替换为 Node.js 实现
    if (typeof data === 'string') {
      // data 是文件路径，通过 adapter 处理
      throw new Error('Zip extraction not implemented for this environment. Provide a custom adapter.')
    }

    // Web 环境：尝试使用 JSZip（如果可用）
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(data)

      for (const [relativePath, file] of Object.entries(zip.files)) {
        if (file.dir) continue
        const fullPath = this.fs.join(targetPath, relativePath)
        const content = await file.async('string')
        // 确保目录存在
        const dir = fullPath.split('/').slice(0, -1).join('/')
        if (dir) await this.fs.mkdir(dir)
        await this.fs.writeFile(fullPath, content)
      }
    } catch {
      throw new Error('Zip extraction requires JSZip. Install it: npm i jszip')
    }
  }

  /* ── Quick Skill 创建 ── */

  /**
   * 从 QuickSkill 创建一个只有 SKILL.md 的技能包
   * quick skill 内部也转换成标准技能包格式
   */
  async createFromQuick(skill: QuickSkill): Promise<SkillPackage> {
    const id = slugify(skill.name)
    const rootPath = this.fs.join(this.fs.tempDir(), 'skills', `quick-${id}`)

    await this.fs.mkdir(rootPath)

    // 生成 SKILL.md，带 frontmatter
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `triggers: [${(skill.triggers ?? [skill.name]).join(', ')}]`,
      '---',
      '',
      skill.content,
    ].join('\n')

    await this.fs.writeFile(this.fs.join(rootPath, 'SKILL.md'), frontmatter)

    const manifest = await this.readManifest(rootPath)

    return { manifest, rootPath, source: 'quick' }
  }
}

/* ── 默认适配器实现 ──────────────────────────────────────────────────────── */

/**
 * Electron 环境适配器
 * 在 preload.js 中暴露 fs 操作后使用
 */
export const createElectronAdapter = (): FileSystemAdapter => {
  // 运行时从 window.electron 获取
  const electron = (window as unknown as { electron: { fs: typeof import('fs'); path: typeof import('path'); os: typeof import('os') } }).electron

  return {
    readFile: (path) => electron.fs.promises.readFile(path, 'utf-8'),
    readFileBuffer: (path) => electron.fs.promises.readFile(path).then((b) => b.buffer),
    writeFile: (path, content) => electron.fs.promises.writeFile(path, content, 'utf-8'),
    exists: (path) =>
      electron.fs.promises
        .access(path)
        .then(() => true)
        .catch(() => false),
    readdir: (path) => electron.fs.promises.readdir(path),
    mkdir: (path) => electron.fs.promises.mkdir(path, { recursive: true }),
    join: (...segments) => electron.path.join(...segments),
    basename: (path) => electron.path.basename(path),
    tempDir: () => electron.os.tmpdir(),
  }
}

/**
 * Web File System Access API 适配器
 * 适用于支持 showDirectoryPicker 的浏览器
 */
export const createWebAdapter = (baseDir?: FileSystemDirectoryHandle): FileSystemAdapter => {
  // 简化的 Web 适配器实现
  // 实际项目中需要用 IndexedDB 缓存目录句柄
  throw new Error('Web adapter implementation depends on your app setup. See createElectronAdapter for reference.')
}

/* ── 默认导出（需要先调用 setAdapter 设置运行环境） ── */

// 临时占位适配器（所有操作抛出错误，提示需要设置）
const placeholderAdapter: FileSystemAdapter = {
  readFile: () => Promise.reject(new Error('FileSystemAdapter not configured. Call skillPackageService.setAdapter() first.')),
  readFileBuffer: () => Promise.reject(new Error('FileSystemAdapter not configured.')),
  writeFile: () => Promise.reject(new Error('FileSystemAdapter not configured.')),
  exists: () => Promise.reject(new Error('FileSystemAdapter not configured.')),
  readdir: () => Promise.reject(new Error('FileSystemAdapter not configured.')),
  mkdir: () => Promise.reject(new Error('FileSystemAdapter not configured.')),
  join: (...s) => s.join('/'),
  basename: (p) => p.split('/').pop() ?? '',
  tempDir: () => '/tmp',
}

export const skillPackageService = new SkillPackageService(placeholderAdapter)
