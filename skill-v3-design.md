# Skill 系统 V3 架构设计

## 一、设计目标

从"技能内容全量存内存"迁移到"技能包索引 + 按需加载"。

| 维度 | V2（现状） | V3（目标） |
|------|-----------|-----------|
| 存储单元 | 技能内容（整段文本塞进 state） | 技能包索引（只存 id、rootPath、enabled） |
| 文件位置 | localStorage / Zustand 内联 | 磁盘文件系统 |
| 匹配时机 | 读取全部 skill 内容做匹配 | 只读 manifest 中的 triggers |
| 注入时机 | 匹配和注入合为一步 | 匹配 → 拿到 ids → 按需读 SKILL.md |
| 引用文件 | 全量塞进注入内容 | 只在 UI 展示或用户主动请求时读取 |
| 导入方式 | 内容粘贴 | SKILL.md / 文件夹 / zip 三种 |
| Quick Skill | 独立类型 | 统一转为只有 SKILL.md 的技能包 |

---

## 二、核心数据流

```
用户输入 "帮我 @rev 代码"
        │
        ▼
┌─────────────────────────┐
│  matchSkills(input)     │  ← 纯内存操作，零 I/O
│  遍历 packages[]        │
│  对每个 enabled 包的     │
│  triggers 做模糊匹配    │
│  返回 AppliedSkill[]    │  ← injectedContent = ""
│  （只有 id + name）      │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  loadSkillContents()    │  ← 按需读文件
│  对每个匹配的 id:       │
│  1. 读 rootPath/SKILL.md│
│  2. 返回完整内容         │
│  references 不默认读取   │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  buildPromptWithHistory │
│  将 SKILL.md 内容注入    │
│  到 enhancedPrompt      │
└─────────────────────────┘
```

---

## 三、文件结构

```
src/
├── types/
│   └── skill.ts                    ← V3 类型定义（已重写）
├── state/
│   └── skillStore.ts               ← V3 Zustand store（已重写）
├── services/
│   └── skillPackageService.ts      ← 文件系统操作 + 导入逻辑
├── skills/
│   ├── SkillsPage.tsx              ← UI（需适配新 store 接口）
│   └── SkillImportDialog.tsx       ← 新增：三种导入方式 UI
└── workspace/
    └── WorkspacePage.tsx           ← 适配新的 matchSkills + loadSkillContents
```

---

## 四、类型定义详解

### 4.1 SkillManifest（轻量元数据）

```typescript
interface SkillManifest {
  id: string              // slug，基于 name 生成
  name: string            // 显示名
  description: string     // 一句话描述
  triggers: string[]      // 匹配关键词（@ 触发用）
  version?: string
  author?: string
  tags?: string[]
  references?: string[]   // 引用文件的相对路径列表
  entryFile?: string      // 入口文件名，默认 'SKILL.md'
}
```

**来源优先级**：
1. `skill.json`（结构化，最优先）
2. `SKILL.md` 的 YAML frontmatter（纯 Markdown 兼容）

### 4.2 PackageIndex（持久化到 localStorage）

```typescript
interface PackageIndex {
  id: string
  rootPath: string        // 包在磁盘上的根路径
  source: 'folder' | 'file' | 'zip' | 'quick'
  enabled: boolean
  overrides: Partial<Pick<SkillManifest, 'name' | 'description' | 'triggers'>>
  scope?: 'global' | 'project'
  createdAt: number
  updatedAt: number
}
```

**这是 localStorage 中唯一存储的 skill 数据**。manifest 本身不缓存，每次从磁盘读取。

### 4.3 AppliedSkill（注入结果）

```typescript
interface AppliedSkill {
  id: string
  name: string
  injectedContent: string           // SKILL.md 全文（注入时填充）
  injectedReferences?: Record<string, string>  // 按需读取的引用文件
}
```

---

## 五、SkillPackageService 设计

### 5.1 文件系统适配器

通过 `FileSystemAdapter` 接口抽象文件操作：

```
┌──────────────────────┐
│  skillPackageService  │
└──────────┬───────────┘
           │ uses
┌──────────▼───────────┐
│  FileSystemAdapter   │  ← 接口定义
│  readFile / writeFile│
│  exists / readdir    │
│  mkdir / join        │
└──────────┬───────────┘
           │ implemented by
    ┌──────┼──────────┐
    ▼      ▼          ▼
Electron  Web FS     Mock
Adapter   API        (测试)
```

启动时根据运行环境注入对应实现：

```typescript
// Electron 环境
import { createElectronAdapter } from './services/skillPackageService'
skillPackageService.setAdapter(createElectronAdapter())
```

### 5.2 三种导入流程

```
导入 SKILL.md（单文件）          导入文件夹                   导入 zip
──────────────────            ─────────────              ─────────────
读取文件内容                    验证路径存在                 解压到临时目录
    │                             │                          │
    ▼                             ▼                          ▼
写入 <temp>/skills/<id>/        读取 skill.json            读取 skill.json
SKILL.md                        或 SKILL.md frontmatter    或 SKILL.md frontmatter
    │                             │                          │
    ▼                             ▼                          ▼
解析 frontmatter               解析 manifest              解析 manifest
生成 SkillManifest
    │
    ▼
返回 SkillPackage
{ manifest, rootPath, source }
```

### 5.3 Quick Skill 转换

```
QuickSkill { name, content, triggers? }
         │
         ▼
生成 SKILL.md（带 frontmatter）
写入 <temp>/skills/quick-<name>/
         │
         ▼
读取并解析 → 标准 SkillPackage
```

---

## 六、Store 行为对比

### 6.1 匹配流程（V2 → V3）

**V2**：`matchSkills(prompt)` 直接读取所有 skill 内容做全文匹配
**V3**：`matchSkills(input)` 只遍历 `packages[]` 中 enabled 条目的 triggers，零 I/O

```typescript
// V3 使用示例
const { matches } = matchSkills(input)  // 纯内存
if (matches.length > 0) {
  const loaded = await loadSkillContents(matches)  // 按需读文件
  const enhancedPrompt = buildPromptWithHistory(chat.messages, loaded)
}
```

### 6.2 持久化对比

**V2**：整个 skills 数组（含内容）序列化到 localStorage
**V3**：只有 `PackageIndex[]`（~200 bytes/skill）存 localStorage

```
V2 localStorage:
{
  "skills": [
    { "id": "review", "name": "Review", "content": "## 代码审查\n\n这是一个很长的..." },  // ~数KB
    { "id": "security", "name": "Security", "content": "## 安全审查\n\n..." }             // ~数KB
  ]
}

V3 localStorage:
{
  "packages": [
    { "id": "review", "rootPath": "/skills/review", "enabled": true, "overrides": {} },     // ~100B
    { "id": "security", "rootPath": "/skills/security", "enabled": true, "overrides": {} }   // ~100B
  ]
}
```

---

## 七、迁移方案

### Phase 1：类型和 Store 替换（已完成）

- [x] `types/skill.ts` — V3 类型定义
- [x] `state/skillStore.ts` — V3 store
- [x] `services/skillPackageService.ts` — 文件系统服务

### Phase 2：WorkspacePage 适配

修改 `handleSubmit`：

```typescript
// V2
const { applied, injectedContext } = matchSkills(prompt)

// V3
const { matches } = matchSkills(prompt)
let applied: AppliedSkill[] = []
if (matches.length > 0) {
  applied = await loadSkillContents(matches)
}
const injectedContext = applied
  .map((s) => s.injectedContent)
  .filter(Boolean)
  .join('\n\n---\n\n')
```

### Phase 3：SkillsPage UI 适配

- 列表从 `skills[]` 改为 `packages[]`
- 每项展示时异步读取 manifest（带缓存）
- 新增导入对话框（支持三种方式）
- 新增 Quick Skill 创建入口

### Phase 4：环境适配器

根据运行环境初始化 `FileSystemAdapter`：

```typescript
// main.ts / App.tsx
import { skillPackageService, createElectronAdapter } from './services/skillPackageService'

if (window.electron) {
  skillPackageService.setAdapter(createElectronAdapter())
}
```

---

## 八、API 速查表

### Store（useSkillStore）

| 方法 | 参数 | 返回 | I/O |
|------|------|------|-----|
| `matchSkills` | `input: string` | `{ matches: AppliedSkill[] }` | 无 |
| `loadSkillContents` | `matches: AppliedSkill[]` | `Promise<AppliedSkill[]>` | 读文件 |
| `importSkill` | `source: SkillImportSource` | `Promise<PackageIndex>` | 读写文件 |
| `addQuickSkill` | `skill: QuickSkill` | `Promise<PackageIndex>` | 写文件 |
| `removeSkill` | `id: string` | `void` | 无 |
| `toggleSkill` | `id, enabled` | `void` | 无 |
| `updateOverrides` | `id, overrides` | `void` | 无 |
| `refreshManifest` | `id: string` | `Promise<void>` | 读文件 |
| `enabledPackages` | — | `PackageIndex[]` | 无 |
| `getPackage` | `id: string` | `PackageIndex \| undefined` | 无 |

### Service（skillPackageService）

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `readManifest` | `rootPath` | `Promise<SkillManifest>` | 读 skill.json 或 frontmatter |
| `readEntry` | `rootPath, entryFile?` | `Promise<string>` | 读 SKILL.md 全文 |
| `readReference` | `rootPath, relPath` | `Promise<string>` | 按需读引用文件 |
| `import` | `source: SkillImportSource` | `Promise<SkillPackage>` | 统一导入入口 |
| `createFromQuick` | `skill: QuickSkill` | `Promise<SkillPackage>` | quick skill → 技能包 |
| `setAdapter` | `adapter: FileSystemAdapter` | `void` | 设置运行环境 |

---

## 九、文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `skill-v3-types.ts` | 已生成 | 完整类型定义，替换 `types/skill.ts` |
| `skill-v3-store.ts` | 已生成 | V3 Zustand store，替换 `state/skillStore.ts` |
| `skill-v3-service.ts` | 已生成 | 文件系统服务，新建 `services/skillPackageService.ts` |
| `WorkspacePage.tsx` | 需适配 | 修改 handleSubmit 使用 matchSkills + loadSkillContents 两步 |
| `SkillsPage.tsx` | 需适配 | 列表改为读 packages[]，新增导入/创建 UI |
