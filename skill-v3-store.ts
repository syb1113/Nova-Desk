/**
 * V3 Skill Package Store
 *
 * 核心原则：
 * - localStorage/Zustand 只存 PackageIndex[]（索引）
 * - skill 文件本体留在磁盘
 * - 匹配时只读 manifest（triggers），不读 SKILL.md 全文
 * - 注入时才读 SKILL.md，references 按需读取
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppliedSkill,
  PackageIndex,
  QuickSkill,
  SkillImportSource,
  SkillManifest,
  SkillPackage,
} from '../types/skill'
import { skillPackageService } from '../services/skillPackageService'

/* ── Fuzzy match（与 V2 逻辑相同）────────────────────────────────────── */

function fuzzyScore(text: string, query: string): number {
  const lt = text.toLowerCase()
  const lq = query.toLowerCase()

  if (!lq) return 1
  const sub = lt.indexOf(lq)
  if (sub !== -1) return 200 - sub

  let qi = 0
  let score = 0
  let runStart = -1

  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      if (runStart === -1) runStart = i
      score += i === runStart ? 10 : 5
      if (i === 0 || /[-_/\s]/.test(text[i - 1])) score += 15
      qi++
      if (qi >= lq.length) break
    } else {
      runStart = -1
    }
  }

  return qi < lq.length ? 0 : score
}

/* ── Store Interface ─────────────────────────────────────────────────── */

interface SkillStoreState {
  /** 技能包索引列表（唯一持久化到 localStorage 的数据） */
  packages: PackageIndex[]

  /** ── 查询 ── */
  /** 列出所有已启用的包索引 */
  enabledPackages: () => PackageIndex[]
  /** 根据 id 查找包索引 */
  getPackage: (id: string) => PackageIndex | undefined

  /** ── 匹配（只读 manifest，不读文件） ── */
  /**
   * 对用户输入进行技能匹配
   * 返回匹配的 AppliedSkill[]（此时 injectedContent 为空字符串）
   * 调用方拿到 ids 后需调用 loadSkillContents 才能获得实际内容
   */
  matchSkills: (input: string) => { matches: AppliedSkill[] }

  /** ── 注入（按需读 SKILL.md） ── */
  /**
   * 根据匹配结果加载实际 SKILL.md 内容
   * 只在 handleSubmit 等需要真正注入时调用
   */
  loadSkillContents: (matches: AppliedSkill[]) => Promise<AppliedSkill[]>

  /** ── CRUD ── */
  importSkill: (source: SkillImportSource) => Promise<PackageIndex>
  addQuickSkill: (skill: QuickSkill) => Promise<PackageIndex>
  removeSkill: (id: string) => void
  toggleSkill: (id: string, enabled: boolean) => void
  updateOverrides: (id: string, overrides: Partial<Pick<SkillManifest, 'name' | 'description' | 'triggers'>>) => void

  /** ── 刷新 ── */
  /** 重新从磁盘读取某个包的 manifest（用于文件变更后） */
  refreshManifest: (id: string) => Promise<void>
  /** 刷新所有包的 manifest */
  refreshAll: () => Promise<void>
}

/* ── Store Implementation ────────────────────────────────────────────── */

export const useSkillStore = create<SkillStoreState>()(
  persist(
    (set, get) => ({
      packages: [],

      /* ── 查询 ── */

      enabledPackages: () => get().packages.filter((p) => p.enabled),

      getPackage: (id) => get().packages.find((p) => p.id === id),

      /* ── 匹配（纯内存操作，零 I/O） ── */

      matchSkills: (input) => {
        const enabled = get().packages.filter((p) => p.enabled)
        const matches: AppliedSkill[] = []

        for (const pkg of enabled) {
          const effectiveManifest = { ...pkg.overrides } as Partial<SkillManifest>
          const triggers = effectiveManifest.triggers ?? []

          // 对每个 trigger 做模糊匹配
          let bestScore = 0
          for (const trigger of triggers) {
            const s = fuzzyScore(trigger, input)
            if (s > bestScore) bestScore = s
          }

          // 也对 name / description 做匹配（降权）
          const nameScore = fuzzyScore(effectiveManifest.name ?? '', input) * 0.6
          const descScore = fuzzyScore(effectiveManifest.description ?? '', input) * 0.3

          const finalScore = Math.max(bestScore, nameScore, descScore)

          if (finalScore > 30) {
            matches.push({
              id: pkg.id,
              name: effectiveManifest.name ?? pkg.id,
              injectedContent: '', // 此时不读文件，内容为空
            })
          }
        }

        // 按分数排序
        matches.sort((a, b) => {
          const sa = enabled.find((p) => p.id === a.id)
          const sb = enabled.find((p) => p.id === b.id)
          return 0 // 已经按遍历顺序了，这里可以加更多排序逻辑
        })

        return { matches }
      },

      /* ── 注入（按需读文件） ── */

      loadSkillContents: async (matches) => {
        const packages = get().packages
        const loaded: AppliedSkill[] = []

        for (const match of matches) {
          const pkg = packages.find((p) => p.id === match.id)
          if (!pkg) continue

          try {
            // 读 SKILL.md 入口
            const content = await skillPackageService.readEntry(pkg.rootPath)

            // references 按需读取（这里暂不注入，由 UI 决定是否需要）
            loaded.push({
              ...match,
              injectedContent: content,
            })
          } catch (err) {
            console.error(`Failed to load skill content for ${match.id}:`, err)
            // 即使读取失败也保留 match（注入空内容）
            loaded.push(match)
          }
        }

        return loaded
      },

      /* ── CRUD ── */

      importSkill: async (source) => {
        const { manifest, rootPath, source: src } = await skillPackageService.import(source)

        const index: PackageIndex = {
          id: manifest.id,
          rootPath,
          source: src,
          enabled: true,
          overrides: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          packages: [...state.packages, index],
        }))

        return index
      },

      addQuickSkill: async (skill) => {
        // quick skill → 只有 SKILL.md 的技能包
        const result = await skillPackageService.createFromQuick(skill)

        const index: PackageIndex = {
          id: result.manifest.id,
          rootPath: result.rootPath,
          source: 'quick',
          enabled: true,
          overrides: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          packages: [...state.packages, index],
        }))

        return index
      },

      removeSkill: (id) => {
        set((state) => ({
          packages: state.packages.filter((p) => p.id !== id),
        }))
      },

      toggleSkill: (id, enabled) => {
        set((state) => ({
          packages: state.packages.map((p) =>
            p.id === id ? { ...p, enabled, updatedAt: Date.now() } : p,
          ),
        }))
      },

      updateOverrides: (id, overrides) => {
        set((state) => ({
          packages: state.packages.map((p) =>
            p.id === id
              ? { ...p, overrides: { ...p.overrides, ...overrides }, updatedAt: Date.now() }
              : p,
          ),
        }))
      },

      /* ── 刷新 ── */

      refreshManifest: async (id) => {
        const pkg = get().packages.find((p) => p.id === id)
        if (!pkg) return

        try {
          const manifest = await skillPackageService.readManifest(pkg.rootPath)
          set((state) => ({
            packages: state.packages.map((p) =>
              p.id === id ? { ...p, updatedAt: Date.now() } : p,
            ),
          }))
          // manifest 本身存在磁盘的 manifest 缓存中，不需要更新 packages
          // packages 只存 overrides，manifest 每次从磁盘读
        } catch (err) {
          console.error(`Failed to refresh manifest for ${id}:`, err)
        }
      },

      refreshAll: async () => {
        const packages = get().packages
        await Promise.allSettled(packages.map((p) => get().refreshManifest(p.id)))
      },
    }),
    {
      name: 'nova-desk-skill-packages',
      // 只持久化 packages 索引，不持久化文件内容
      partialize: (state) => ({ packages: state.packages }),
    },
  ),
)
