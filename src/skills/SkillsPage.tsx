import {
  Code2,
  FileText,
  GitFork,
  Bug,
  Globe,
  Plus,
  Trash2,
  Download,
  Search,
  Zap,
  CheckCircle2,
  XCircle,
  Wrench,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Package,
} from 'lucide-react'
import { Dropdown, Input, Modal, Switch, Tag, Tooltip, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createSkillPackageFromFiles,
  exportSkillAsMd,
  parseSkillMdFrontmatter,
  useSkillStore,
} from '../state/skillStore'
import {
  deleteSkillPackage,
  isSkillFsAvailable,
  listSkillPackages,
  readSkillPackage,
  revealSkillsRoot,
  selectSkillFolder,
  writeSkillPackage,
} from '../api/skillFs'
import { readZipEntries } from '../utils/zipReader'
import type { SkillConfig } from '../types/skill'

const builtinIcons: Record<string, typeof Code2> = {
  'builtin-web-ui': Globe,
  'builtin-code-review': ShieldCheck,
  'builtin-debug': Bug,
  'builtin-docs': FileText,
  'builtin-git': GitFork,
}

// ── Skill Card ──────────────────────────────────────────────────────────────

const SkillCard = ({
  skill,
  onDelete,
  onToggle,
  onExport,
}: {
  skill: SkillConfig
  onDelete: (skill: SkillConfig) => void
  onToggle: (id: string) => void
  onExport: (skill: SkillConfig) => void
}) => {
  const Icon = builtinIcons[skill.id] ?? Code2
  const isCustom = skill.source === 'custom'
  const packageSource = skill.packageSource ?? (skill.source === 'builtin' ? 'builtin' : 'quick')
  const entryFile = skill.entryFile ?? 'SKILL.md'
  const packageLabel: Record<SkillConfig['packageSource'], string> = {
    builtin: '内置包',
    quick: '快捷包',
    file: '文件包',
    zip: '压缩包',
    folder: '文件夹',
  }

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border bg-white p-4 transition-shadow hover:shadow-[0_6px_24px_rgb(15_23_42_/_0.07)] ${
        skill.enabled ? 'border-primary/20' : 'border-[#e5e9f0]'
      }`}
    >
      {/* Top row: icon + name + toggle */}
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              skill.enabled ? 'bg-primary/10 text-primary' : 'bg-[#f0f2f5] text-[#8a919d]'
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[#111827]">{skill.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Tag
                className={`m-0 rounded border-0 px-1.5 py-0 text-[10px] leading-4 ${
                  isCustom ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'
                }`}
              >
                {isCustom ? '自定义' : '内置'}
              </Tag>
              <Tag className="m-0 rounded border-0 bg-surface px-1.5 py-0 text-[10px] leading-4 text-textMuted">
                {packageLabel[packageSource]}
              </Tag>
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] ${
                  skill.enabled ? 'text-emerald-600' : 'text-[#9ca3af]'
                }`}
              >
                {skill.enabled ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                {skill.enabled ? '启用' : '关闭'}
              </span>
            </div>
          </div>
        </div>
        <Switch size="small" checked={skill.enabled} onChange={() => onToggle(skill.id)} />
      </div>

      {/* Description */}
      <p className="mb-2.5 line-clamp-2 flex-1 text-xs leading-5 text-[#6b7280]">{skill.description}</p>

      {/* Triggers */}
      <div className="mb-2 flex items-center gap-2 text-[10px] text-textMuted">
        <span className="truncate">入口：{entryFile}</span>
        {skill.references && skill.references.length > 0 ? <span>{skill.references.length} 个引用</span> : null}
      </div>

      {skill.triggers.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {skill.triggers.slice(0, 3).map((trigger) => (
            <span
              key={trigger}
              className="inline-block rounded bg-[#f4f6f8] px-1.5 py-0.5 text-[10px] text-[#6b7280]"
            >
              {trigger}
            </span>
          ))}
          {skill.triggers.length > 3 && (
            <span className="text-[10px] text-[#9ca3af]">+{skill.triggers.length - 3}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 border-t border-[#f0f2f5] pt-2.5">
        <Tooltip title="导出 SKILL.md">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a919d] transition hover:bg-[#f4f6f8] hover:text-primary"
            onClick={() => onExport(skill)}
          >
            <Download size={13} />
          </button>
        </Tooltip>
        {isCustom && (
          <Tooltip title="删除">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a919d] transition hover:bg-red-50 hover:text-red-500"
              onClick={() => onDelete(skill)}
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ── Test Match Panel ─────────────────────────────────────────────────────────

const TestMatchPanel = () => {
  const matchSkills = useSkillStore((s) => s.matchSkills)
  const [testInput, setTestInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const result = useMemo(() => {
    if (!testInput.trim()) return null
    return matchSkills(testInput)
  }, [testInput, matchSkills])

  return (
    <div className="mb-6 rounded-xl border border-[#e5e9f0] bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <Search size={15} className="text-emerald-500" />
          <span className="text-sm font-semibold text-[#111827]">测试匹配</span>
          <span className="text-xs text-[#9ca3af]">验证输入会命中哪些技能</span>
        </div>
        {collapsed ? <ChevronDown size={16} className="text-[#9ca3af]" /> : <ChevronUp size={16} className="text-[#9ca3af]" />}
      </button>

      {!collapsed && (
        <div className="border-t border-[#f0f2f5] px-5 pb-4 pt-3">
          <Input
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="试试：帮我 review 一下这段代码 / 这个 bug 怎么修 / 前端布局怎么做"
            allowClear
            className="mb-3"
          />
          {result && (
            result.skills.length > 0 ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Sparkles size={13} className="text-primary" />
                  <span className="text-xs font-medium text-[#111827]">匹配 {result.skills.length} 个：</span>
                  {result.applied.map((s) => (
                    <span key={s.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {s.name}
                    </span>
                  ))}
                </div>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f4f6f8] px-4 py-3 font-mono text-[11px] leading-5 text-[#374151]">
                  {result.injectedContext}
                </pre>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-[#f8f9fb] px-4 py-2.5">
                <XCircle size={14} className="text-[#9ca3af]" />
                <span className="text-xs text-[#6b7280]">没有匹配到任何技能</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'skills' | 'runtime'
type SourceFilter = 'all' | 'builtin' | 'custom'

const toPackageId = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || crypto.randomUUID()
}

const filesRecordToList = (files: Record<string, string>) =>
  Object.entries(files).map(([path, content]) => ({ path, content }))

export const SkillsPage = () => {
  const builtinSkills = useSkillStore((s) => s.builtinSkills)
  const customSkills = useSkillStore((s) => s.customSkills)
  const autoMatchEnabled = useSkillStore((s) => s.autoMatchEnabled)
  const toggleSkillEnabled = useSkillStore((s) => s.toggleSkillEnabled)
  const deleteCustomSkill = useSkillStore((s) => s.deleteCustomSkill)
  const upsertSkillPackage = useSkillStore((s) => s.upsertSkillPackage)
  const setAutoMatchEnabled = useSkillStore((s) => s.setAutoMatchEnabled)
  const getEnabledSkills = useSkillStore((s) => s.getEnabledSkills)

  const [tab, setTab] = useState<Tab>('skills')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allSkills = useMemo(() => [...builtinSkills, ...customSkills], [builtinSkills, customSkills])
  const enabledSkills = useMemo(() => getEnabledSkills(), [builtinSkills, customSkills, getEnabledSkills])

  const filteredSkills = useMemo(() => {
    if (filter === 'builtin') return builtinSkills
    if (filter === 'custom') return customSkills
    return allSkills
  }, [filter, allSkills, builtinSkills, customSkills])

  const counts = useMemo(() => ({
    all: allSkills.length,
    builtin: builtinSkills.length,
    custom: customSkills.length,
    enabled: enabledSkills.length,
  }), [allSkills, builtinSkills, customSkills, enabledSkills])

  useEffect(() => {
    let cancelled = false

    const syncDiskPackages = async () => {
      const packageIds = await listSkillPackages()
      for (const packageId of packageIds) {
        const packageResult = await readSkillPackage(packageId)
        if (!packageResult || cancelled) continue

        const files = Object.fromEntries(packageResult.files.map((file) => [file.path, file.content]))
        const packageSkill = createSkillPackageFromFiles(files, 'folder', packageId)
        if (!packageSkill) continue

        upsertSkillPackage({
          ...packageSkill,
          id: packageId,
          rootPath: packageResult.rootPath,
          packageSource: packageSkill.packageSource === 'zip' ? 'zip' : 'folder',
        })
      }
    }

    void syncDiskPackages()

    return () => {
      cancelled = true
    }
  }, [upsertSkillPackage])

  const persistSkillPackage = async (
    skill: Parameters<typeof upsertSkillPackage>[0],
    preferredId = skill.id ?? toPackageId(skill.name),
  ) => {
    if (!isSkillFsAvailable()) {
      return skill
    }

    const files = skill.files ?? { [skill.entryFile ?? 'SKILL.md']: skill.content }
    const result = await writeSkillPackage(preferredId, filesRecordToList(files))
    return {
      ...skill,
      id: preferredId,
      rootPath: result?.rootPath,
    }
  }

  const handleDelete = (skill: SkillConfig) => {
    Modal.confirm({
      centered: true,
      title: '确认删除',
      content: `删除「${skill.name}」后无法撤销。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteSkillPackage(skill.id)
        deleteCustomSkill(skill.id)
      },
    })
  }

  const handleExport = (skill: SkillConfig) => {
    const md = exportSkillAsMd(skill)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${skill.name.replace(/\s+/g, '-').toLowerCase()}.skill.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(`已导出：${skill.name}`)
  }

  // ── Import: .md / .txt / .zip ─────────────────────────────────────────────

  const importFromText = async (raw: string, fileName: string): Promise<boolean> => {
    const packageSkill = createSkillPackageFromFiles(
      { [fileName]: raw },
      'file',
      fileName.replace(/\.(skill\.)?(md|txt)$/i, ''),
    )
    const parsed = packageSkill ?? parseSkillMdFrontmatter(raw)
    if (parsed) {
      const persisted = await persistSkillPackage({
        ...parsed,
        packageSource: packageSkill ? 'file' : 'quick',
        entryFile: packageSkill?.entryFile ?? fileName,
        files: packageSkill?.files ?? { [fileName]: raw },
      })
      upsertSkillPackage(persisted)
      return true
    }
    return false
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const lower = file.name.toLowerCase()

    try {
      if (lower.endsWith('.zip')) {
        const entries = await readZipEntries(file)
        if (entries.size === 0) {
          message.warning('压缩包内没有找到 .md 或 .txt 文件')
        } else {
          const packageSkill = createSkillPackageFromFiles(
            Object.fromEntries(entries),
            'zip',
            file.name.replace(/\.zip$/i, ''),
          )
          if (packageSkill) {
            const persisted = await persistSkillPackage(packageSkill)
            upsertSkillPackage(persisted)
            message.success(`已导入技能包：${packageSkill.name}`)
          } else {
            message.warning('压缩包无法解析：需要包含 skill.json 或 SKILL.md')
          }
        }
      } else {
        const text = await file.text()
        if (await importFromText(text, file.name)) {
          message.success('导入成功')
        } else {
          message.error('无法解析，文件需包含 # 标题或 YAML frontmatter')
        }
      }
    } catch (err) {
      message.error(`导入失败：${err instanceof Error ? err.message : '未知错误'}`)
    }

    event.target.value = ''
  }

  const handleImportFolder = async () => {
    try {
      const selected = await selectSkillFolder()
      if (!selected) return

      const packageSkill = createSkillPackageFromFiles(
        Object.fromEntries(selected.files.map((file) => [file.path, file.content])),
        'folder',
        selected.name,
      )

      if (!packageSkill) {
        message.warning('文件夹无法解析：需要包含 skill.json 或 SKILL.md')
        return
      }

      const persisted = await persistSkillPackage(packageSkill, toPackageId(packageSkill.id ?? packageSkill.name))
      upsertSkillPackage({
        ...persisted,
        packageSource: 'folder',
      })
      message.success(`已导入技能文件夹：${packageSkill.name}`)
    } catch (err) {
      message.error(`导入文件夹失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const filterChips: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: `全部 ${counts.all}` },
    { key: 'builtin', label: `内置 ${counts.builtin}` },
    { key: 'custom', label: `自定义 ${counts.custom}` },
  ]

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-1 pb-8 pt-8">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-[#111827]">技能管理</h1>
              <p className="mt-0.5 text-xs text-[#6b7280]">
                {counts.enabled} 个技能已启用 · 对话时自动匹配触发词注入上下文
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoMatchEnabled(!autoMatchEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  autoMatchEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f0f2f5] text-[#6b7280]'
                }`}
              >
                {autoMatchEnabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                自动匹配
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.zip,.json,.yaml,.yml"
                className="hidden"
                onChange={handleImportFile}
              />
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'file',
                      icon: <Download size={13} />,
                      label: '导入文件',
                      onClick: () => fileInputRef.current?.click(),
                    },
                    {
                      key: 'folder',
                      icon: <FolderOpen size={13} />,
                      label: '导入文件夹',
                      onClick: handleImportFolder,
                    },
                    {
                      key: 'local',
                      icon: <FolderOpen size={13} />,
                      label: '本地目录',
                      onClick: () => void revealSkillsRoot(),
                    },
                  ],
                }}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/90"
                >
                  <Plus size={13} />
                  添加技能
                </button>
              </Dropdown>
            </div>
          </div>

          {/* ── Tab bar ────────────────────────────────────────────────── */}
          <div className="mb-5 flex items-center gap-1 rounded-xl bg-[#eef1f5] p-1">
            {([
              { key: 'skills' as Tab, label: '技能列表', icon: Wrench },
              { key: 'runtime' as Tab, label: '运行时', icon: Zap },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tab === key ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'
                }`}
                onClick={() => setTab(key)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {/* ── Tab: Skills list ───────────────────────────────────────── */}
          {tab === 'skills' && (
            <>
              <TestMatchPanel />

              {/* Filter chips */}
              <div className="mb-4 flex items-center gap-2">
                {filterChips.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      filter === key
                        ? 'bg-primary text-white'
                        : 'bg-white text-[#6b7280] hover:bg-[#f4f6f8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Cards grid */}
              {filteredSkills.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onDelete={handleDelete}
                      onToggle={toggleSkillEnabled}
                      onExport={handleExport}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8e0f0] bg-white py-14">
                  <Package size={28} className="mb-2 text-[#c4c9d4]" />
                  <p className="text-sm text-[#9ca3af]">
                    {filter === 'custom' ? '暂无自定义技能' : '暂无技能'}
                  </p>
                  <p className="mt-1 text-xs text-[#c4c9d4]">点击「添加技能」导入文件或文件夹</p>
                </div>
              )}
            </>
          )}

          {/* ── Tab: Runtime ───────────────────────────────────────────── */}
          {tab === 'runtime' && (
            <div>
              <div className="mb-3 text-xs text-[#6b7280]">
                当前已启用、会在对话中注入上下文的技能。最多同时注入 3 个。
              </div>
              {enabledSkills.length > 0 ? (
                <div className="rounded-xl border border-[#e5e9f0] bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#f0f2f5] text-left text-[11px] text-[#8a919d]">
                        <th className="px-4 py-2.5 font-medium">名称</th>
                        <th className="px-4 py-2.5 font-medium">来源</th>
                        <th className="px-4 py-2.5 font-medium">触发词</th>
                        <th className="px-4 py-2.5 font-medium">自动</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enabledSkills.map((skill) => (
                        <tr key={skill.id} className="border-b border-[#f8f9fb] last:border-0">
                          <td className="px-4 py-2.5 font-medium text-[#111827]">{skill.name}</td>
                          <td className="px-4 py-2.5">
                            <Tag
                              className={`m-0 rounded border-0 px-1.5 py-0 text-[10px] ${
                                skill.source === 'custom' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'
                              }`}
                            >
                              {skill.source === 'custom' ? '自定义' : '内置'}
                            </Tag>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {skill.triggers.slice(0, 4).map((t) => (
                                <span key={t} className="rounded bg-[#f4f6f8] px-1.5 py-0.5 text-[10px] text-[#6b7280]">
                                  {t}
                                </span>
                              ))}
                              {skill.triggers.length > 4 && (
                                <span className="text-[10px] text-[#9ca3af]">+{skill.triggers.length - 4}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[11px] ${skill.autoMatch ? 'text-emerald-600' : 'text-[#9ca3af]'}`}>
                              {skill.autoMatch ? '✓' : '仅手动'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-[#d8e0f0] bg-white py-10">
                  <p className="text-sm text-[#9ca3af]">没有已启用的技能，去「技能列表」启用一个吧</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </section>
  )
}
