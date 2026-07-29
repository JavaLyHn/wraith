# Windows 对等 块3:编辑器探测+打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「用应用打开文件」在 Windows 上可用——按已知安装路径探测编辑器 + 直接 spawn 其 exe 打开文件;mac 行为不变。

**Architecture:** 在纯模块 `fileOpen.ts` 加 `KNOWN_WINDOWS_EDITORS` 表 + 纯函数 `detectWindowsEditors(env, exists)`(mac 上注入假 env/exists 单测),并把 `resolveOpenWithPlan` 的 win32 分支从 shellOpen 占位改为 spawn exe;`index.ts` 的 `computeEditors` 加 win32 分支调 `detectWindowsEditors`;渲染层零改(UI 数据驱动)。

**Tech Stack:** Electron 32 主进程(TS)、vitest、electron-vite。

## Global Constraints

- 语言:注释/文档中文;代码/命令/路径原样。
- 分支 `feat/windows-parity-block1`(Windows 系列同分支,已 checkout,直接提交)。工作目录 /Users/aa00945/Desktop/wraith;桌面命令在 desktop/ 下跑。
- **不改 Java 后端、不改渲染层、不改 mac 行为**(`detectEditors`/`KNOWN_EDITORS`/darwin 打开路径均不动)。
- 纯函数模块 `fileOpen.ts` 保持无 electron 值导入(现状只 import path/fs + type EditorApp)。
- 每个代码任务结束:`cd desktop && npm run typecheck`(tsc 0)+ `npm run test`(vitest 全绿、不回归)。
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;**绝不碰** WIP 文件(README.md、demo/pom.xml、.claude/settings.json、demo/src/Hello.java、progress.md、.superpowers/)。
- 提交信息中文,结尾逐字附:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- 诚实边界:本环境 macOS,无法验证真实 Windows 编辑器探测/spawn 打开;交付 = 纯函数单测(mac 绿)+ 实机验收清单条目,实机冒烟归用户/CI。

## 文件结构

- `desktop/src/main/fileOpen.ts`(改):加 `KNOWN_WINDOWS_EDITORS` + `detectWindowsEditors`;改 `resolveOpenWithPlan` win32 分支。
- `desktop/test/fileOpen.test.ts`(改):加 `detectWindowsEditors` 用例;更新块 1 的 `resolveOpenWithPlan` win32 断言。
- `desktop/src/main/index.ts`(改):`computeEditors` 加 win32 分支。
- `docs/windows-dev.md`(改):验收清单补编辑器条目 + 更新降级。

---

### Task 1: detectWindowsEditors + resolveOpenWithPlan win32 spawn

**Files:**
- Modify: `desktop/src/main/fileOpen.ts`
- Test: `desktop/test/fileOpen.test.ts`

**Interfaces:**
- Produces: `export function detectWindowsEditors(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): EditorApp[]`（`EditorApp = { name, appPath }`）。
- Changes: `resolveOpenWithPlan('win32', appPath, filePath)` → `{ kind:'spawn', cmd: appPath, args:[filePath] }`（darwin/linux 分支不变）。

- [ ] **Step 1: 写失败测试(detectWindowsEditors)+ 更新 win32 open 断言**

改 `desktop/test/fileOpen.test.ts`:把 `detectWindowsEditors` 加进顶部已有的 `import { … } from '../src/main/fileOpen'` 那一行(不新开 import 行)。追加:

```ts
describe('detectWindowsEditors', () => {
  const LA = 'C:\\Users\\me\\AppData\\Local'
  const PF = 'C:\\Program Files'
  const env = { LOCALAPPDATA: LA, ProgramFiles: PF } as NodeJS.ProcessEnv
  const codeUser = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
  const codeSys = 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
  const cursor = 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe'

  it('命中 user 安装的 VS Code', () => {
    expect(detectWindowsEditors(env, p => p === codeUser)).toEqual([{ name: 'VS Code', appPath: codeUser }])
  })
  it('user 缺则回退 ProgramFiles 的 VS Code', () => {
    expect(detectWindowsEditors(env, p => p === codeSys)).toEqual([{ name: 'VS Code', appPath: codeSys }])
  })
  it('多编辑器按表序,每个只出一条(首候选命中即止)', () => {
    expect(detectWindowsEditors(env, p => p === codeUser || p === cursor)).toEqual([
      { name: 'VS Code', appPath: codeUser },
      { name: 'Cursor', appPath: cursor },
    ])
  })
  it('全漏装 → 空', () => {
    expect(detectWindowsEditors(env, () => false)).toEqual([])
  })
  it('base 环境变量缺失 → 跳过该候选(仅 ProgramFiles 候选的编辑器拼不出路径)', () => {
    const subl = 'C:\\Program Files\\Sublime Text\\sublime_text.exe'
    expect(detectWindowsEditors({ LOCALAPPDATA: LA } as NodeJS.ProcessEnv, p => p === subl)).toEqual([])
  })
})
```

并把块 1 遗留的这条用例(在 `describe('resolveOpenWithPlan', …)` 内):

```ts
  it('win32 → shellOpen(系统默认程序,不 spawn open)', () => {
    expect(resolveOpenWithPlan('win32', 'C:/whatever.exe', 'C:/x/y.txt'))
      .toEqual({ kind: 'shellOpen', target: 'C:/x/y.txt' })
  })
```

替换为:

```ts
  it('win32 → spawn 编辑器 exe(直接开文件,不用 -a)', () => {
    expect(resolveOpenWithPlan('win32', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 'C:\\x\\y.txt'))
      .toEqual({ kind: 'spawn', cmd: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', args: ['C:\\x\\y.txt'] })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/fileOpen.test.ts`
Expected: FAIL —— `detectWindowsEditors` 未导出;且更新后的 win32 用例与现有 shellOpen 实现不符而失败。

- [ ] **Step 3: 实现 detectWindowsEditors + 表**

在 `desktop/src/main/fileOpen.ts` 里(`detectEditors` 之后、`resolveOpenWithPlan` 之前或文件合适处)加:

```ts
/** 已知 Windows 编辑器:展示名 → 候选安装位置(base=环境变量名,rel=相对该目录的 exe)。
 *  覆盖默认安装路径;自定义目录/注册表安装不在 v1 覆盖内(将来可选增强)。 */
const KNOWN_WINDOWS_EDITORS: { name: string; candidates: { base: string; rel: string }[] }[] = [
  { name: 'VS Code', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code\\Code.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code\\Code.exe' },
  ] },
  { name: 'VS Code Insiders', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code Insiders\\Code - Insiders.exe' },
  ] },
  { name: 'Cursor', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\cursor\\Cursor.exe' },
  ] },
  { name: 'Sublime Text', candidates: [
    { base: 'ProgramFiles', rel: 'Sublime Text\\sublime_text.exe' },
  ] },
  { name: 'Notepad++', candidates: [
    { base: 'ProgramFiles', rel: 'Notepad++\\notepad++.exe' },
    { base: 'ProgramFiles(x86)', rel: 'Notepad++\\notepad++.exe' },
  ] },
]

/** 从已知安装路径探测已装的 Windows 编辑器。env、exists 均注入以便纯函数单测。
 *  每编辑器按候选顺序取首个存在者,最多一条(天然按 name 去重)。用 path.win32.join
 *  保证跨宿主(含 mac 测试)都产 Windows 风格路径。 */
export function detectWindowsEditors(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): EditorApp[] {
  const out: EditorApp[] = []
  for (const ed of KNOWN_WINDOWS_EDITORS) {
    for (const c of ed.candidates) {
      const baseDir = env[c.base]
      if (!baseDir) continue
      const full = path.win32.join(baseDir, c.rel)
      if (exists(full)) { out.push({ name: ed.name, appPath: full }); break }
    }
  }
  return out
}
```

- [ ] **Step 4: 改 resolveOpenWithPlan win32 分支**

把 `resolveOpenWithPlan` 里:

```ts
  if (platform === 'darwin') {
    return { kind: 'spawn', cmd: 'open', args: ['-a', appPath, filePath] }
  }
  return { kind: 'shellOpen', target: filePath }
```

改为:

```ts
  if (platform === 'darwin') {
    return { kind: 'spawn', cmd: 'open', args: ['-a', appPath, filePath] }
  }
  if (platform === 'win32') {
    // Windows:appPath 是编辑器 exe(由 detectWindowsEditors 探得),直接 spawn 开文件(无 -a)
    return { kind: 'spawn', cmd: appPath, args: [filePath] }
  }
  return { kind: 'shellOpen', target: filePath }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/fileOpen.test.ts`
Expected: PASS(detectWindowsEditors 5 用例 + resolveOpenWithPlan darwin/win32/linux 全绿)。

- [ ] **Step 6: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(不回归)。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/fileOpen.ts desktop/test/fileOpen.test.ts
git commit -m "feat(windows): detectWindowsEditors 已知路径探测 + resolveOpenWithPlan win32 spawn exe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: computeEditors 加 win32 分支

**Files:**
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `detectWindowsEditors`。

- [ ] **Step 1: 改 computeEditors**

在 `desktop/src/main/index.ts`:把 `detectWindowsEditors` 加进现有 `import { detectEditors, … } from './fileOpen'` 那一行(不新开 import)。把 `computeEditors` 改为:

```ts
function computeEditors(): EditorApp[] {
  if (editorsCache) return editorsCache
  if (process.platform === 'win32') {
    editorsCache = detectWindowsEditors(process.env, fs.existsSync)
    return editorsCache
  }
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')]
  const appPaths: string[] = []
  for (const d of dirs) {
    try { for (const n of fs.readdirSync(d)) if (n.endsWith('.app')) appPaths.push(path.join(d, n)) }
    catch { /* 目录不存在,跳过 */ }
  }
  editorsCache = detectEditors(appPaths)
  return editorsCache
}
```

(win32 走 detectWindowsEditors;darwin/linux 保持 `/Applications` 扫描——linux 目录不存在被吞返回 `[]`。)

- [ ] **Step 2: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0(`detectWindowsEditors` 导入解析、`process.env` 类型匹配 `NodeJS.ProcessEnv`);vitest 全绿(不回归)。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/index.ts
git commit -m "feat(windows): computeEditors win32 分支走 detectWindowsEditors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: docs/windows-dev.md 更新(编辑器打开可用)

**Files:**
- Modify: `docs/windows-dev.md`

- [ ] **Step 1: 补验收清单 + 更新降级**

先读 `docs/windows-dev.md`。在"验收清单"追加:

```markdown
- [ ] 文件的「用应用打开」能列出已装编辑器(VS Code 等),点击用该编辑器打开文件
```

在"已知降级"里,把关于"'用应用打开'/编辑器走系统默认程序 → 块3"的那条,改写为已完成表述,例如:

```markdown
- (块 3 已完成)"用应用打开"在 Windows 探测已知编辑器(VS Code / Insiders / Cursor / Sublime Text / Notepad++,默认安装路径)并直接打开;自定义目录/注册表安装暂不覆盖。
```

其余降级条目(桌宠→块5、无安装包→块4)不动。

- [ ] **Step 2: 校对**

肉眼确认:清单条目可打勾、与块 3 实际交付一致;"已知降级"不再声称 Windows 编辑器打开走系统默认;无占位符。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add docs/windows-dev.md
git commit -m "docs(windows): 验收清单补编辑器打开 + 更新已知降级(块3 完成)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## 完成判据(块 3)

- `detectWindowsEditors`(命中/回退/表序/去重/env 缺失 5 用例)+ `resolveOpenWithPlan` win32=spawn 更新 全绿;`npm run typecheck` 0。
- `computeEditors` 在 win32 走 `detectWindowsEditors`;mac 扫描路径不变、darwin 行为不变。
- 既有 vitest 不回归。
- `docs/windows-dev.md` 反映块 3 完成。
- **Windows 实机**(真实 VS Code 等被探测、点击打开)= 用户/CI 负责,本环境不冒领。
