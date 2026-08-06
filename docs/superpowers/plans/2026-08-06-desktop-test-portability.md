# Desktop test portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端测试不再把 Windows 的符号链接权限和路径分隔符误报为产品回归，同时保留安全边界覆盖。

**Architecture:** 仅修改 Vitest 测试。软链接用例在实际创建时只对 Windows `EPERM` 明确跳过；平台相关纯函数测试显式注入目标平台；路径断言使用与生产代码相同的 Node `path.join` 语义。

**Tech Stack:** TypeScript、Vitest、Node.js `fs` / `path`

## Global Constraints

- 不修改 `petInstall`、`petWindow`、文档库或宠物存储的生产逻辑。
- 不新增依赖、不修改 npm lockfile，也不绕过 Electron 下载的 TLS 校验。
- 安全用例只在 Windows 创建软链接收到 `EPERM` 时跳过；其它错误必须继续抛出。
- 保持中文测试名称和注释，说明为什么存在该条件，而非重复代码动作。

---

### Task 1: 文档库安全测试的平台权限处理

**Files:**
- Modify: `desktop/test/documents.test.ts`

**Interfaces:**
- Consumes: `fs.promises.symlink(target, path)` 的 `EPERM` 错误码与 Vitest 测试上下文的 `skip(message)`。
- Produces: 在可创建符号链接的平台运行三条库外软链接安全断言；Windows 无权限时三条用例以明确原因跳过。

- [ ] **Step 1: 保留当前失败作为 RED 证据**

Run: `npx vitest run test/documents.test.ts`

Expected: Windows 上软链接的三条用例在 `fs.promises.symlink(...)` 处以 `EPERM` 失败；这证明失败发生于测试前置条件，而不是 `listDocuments`、`resolveInVault` 或 `removeDocument` 的安全逻辑。

- [ ] **Step 2: 写入最小的软链接能力探测辅助函数**

在 `srcFile` 后添加下列测试专用函数。它不吞掉非权限错误，以免把真实环境或产品问题伪装成跳过：

```ts
async function createSymlinkOrSkip(target: string, link: string): Promise<boolean> {
  try {
    await fs.promises.symlink(target, link)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}
```

- [ ] **Step 3: 将三条软链接安全用例改为权限受限时显式跳过**

把第一个 `listDocuments` 软链接用例、`resolveInVault` 软链接用例和 `removeDocument` 软链接用例的回调改为接收 `ctx`；每次创建软链接前写入：

```ts
if (!await createSymlinkOrSkip(outside, path.join(vault, '看起来很正常.txt'))) {
  return ctx.skip('当前 Windows 账号没有创建符号链接的权限；支持该能力的平台仍执行库外链接防护断言。')
}
```

第二、三条分别使用其原有的 `outside` 与链接路径。创建成功后的全部原断言必须保持不变。

- [ ] **Step 4: 令反斜杠文件名用例只在可表示该文件名的平台运行**

将该用例声明改为：

```ts
it.skipIf(process.platform === 'win32')('名字含反斜杠的普通文件不出现在列表里 —— 否则它的三个动作全抛「非法文件名」', async () => {
```

Windows 的反斜杠是路径分隔符，不能通过真实文件系统构造该 POSIX 文件名；不要改变现有断言或生产校验。

- [ ] **Step 5: 验证 GREEN 并提交**

Run: `npx vitest run test/documents.test.ts`

Expected: 文件通过；无权限的 Windows 显示四条有原因的 skipped，用例未静默通过。

```bash
git add desktop/test/documents.test.ts
git commit -m "test: 适配文档库安全用例的 Windows 权限"
```

### Task 2: 宠物存储软链接安全测试的平台权限处理

**Files:**
- Modify: `desktop/test/petStore.test.ts`

**Interfaces:**
- Consumes: `fs.symlinkSync(target, path)` 的 `EPERM` 错误码与 Vitest 测试上下文的 `skip(message)`。
- Produces: Petdex manifest、资产以及导入预览图的软链接防护仍在有权限的系统上被实际验证。

- [ ] **Step 1: 保留当前失败作为 RED 证据**

Run: `npx vitest run test/petStore.test.ts`

Expected: Windows 无符号链接权限时，两个安全用例在 `fs.symlinkSync(...)` 抛出 `EPERM`，而不是在 `listPets` 或 `previewDataUrl` 的防护断言失败。

- [ ] **Step 2: 写入同步软链接能力探测辅助函数**

在本文件的测试辅助函数附近添加：

```ts
function createSymlinkOrSkip(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}
```

- [ ] **Step 3: 将两个用例改为权限受限时显式跳过**

让两个受影响的 `it` 回调接收 `ctx`。在每个 `fs.symlinkSync` 位置改为检查辅助函数；返回 `false` 时立即调用：

```ts
return ctx.skip('当前 Windows 账号没有创建符号链接的权限；支持该能力的平台仍执行宠物包路径逃逸防护断言。')
```

`does not follow Petdex manifest or asset symlinks outside a package` 中两次链接创建都必须检查；创建成功时原有 `listPets` 与 `previewDataUrl` 断言保持不变。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `npx vitest run test/petStore.test.ts`

Expected: 文件通过；无权限 Windows 只跳过两条依赖软链接的安全用例。

```bash
git add desktop/test/petStore.test.ts
git commit -m "test: 保留宠物软链接防护的跨平台覆盖"
```

### Task 3: 显式平台输入与平台无关的路径断言

**Files:**
- Modify: `desktop/test/petInstall.test.ts`
- Modify: `desktop/test/petInstallWindows.test.ts`
- Modify: `desktop/test/petWindowLifecycle.test.ts`

**Interfaces:**
- Consumes: `npxSearchDirs(pathEnv, homedir, platform)`、`resolveNpx(dirs, existsFn, platform)`、`npxSpawnArgs(npxPath, args, platform, comSpec)`、`petHtmlTarget(rendererUrlEnv, dirname)`。
- Produces: 每个测试都声明其目标平台，不再读取测试进程所在的 OS；HTML 文件目标按 Node 路径语义断言。

- [ ] **Step 1: 保留当前失败作为 RED 证据**

Run: `npx vitest run test/petInstall.test.ts test/petInstallWindows.test.ts test/petWindowLifecycle.test.ts`

Expected: Windows 上旧 macOS 测试得到 Windows 候选路径，`undefined` 使用真实 `ComSpec`，以及 `path.join` 产生反斜杠；这三类失败说明测试隐含了宿主 OS。

- [ ] **Step 2: 显式声明 macOS 测试的目标平台**

在 `petInstall.test.ts` 的两个 `npxSearchDirs` 调用和两个 `resolveNpx` 调用末尾加入 `'darwin'`。例如：

```ts
const dirs = npxSearchDirs('/usr/local/bin:/foo/bin', '/Users/me', 'darwin')
expect(resolveNpx(['/usr/local/bin', '/opt/homebrew/bin'], exists, 'darwin'))
  .toBe('/opt/homebrew/bin/npx')
```

- [ ] **Step 3: 让 ComSpec fallback 测试表达真正的缺失状态**

在 `petInstallWindows.test.ts` 的两条 fallback 断言中，以 `''` 和 `'  '` 作为第四个参数：

```ts
expect(npxSpawnArgs('C:\\n\\npx.cmd', ARGS, 'win32', '').command).toBe('cmd.exe')
expect(npxSpawnArgs('C:\\n\\npx.cmd', ARGS, 'win32', '  ').command).toBe('cmd.exe')
```

不要把生产函数的默认参数改为 `cmd.exe`；`undefined` 的设计含义是读取真实 `process.env.ComSpec`。

- [ ] **Step 4: 让 HTML 文件目标按 Node 路径规则断言**

在 `petWindowLifecycle.test.ts` 顶部加入：

```ts
import path from 'node:path'
```

并把生产路径的期望替换为：

```ts
expect(petHtmlTarget(undefined, '/x/out/main')).toEqual({
  file: path.join('/x/out/main', '../renderer/pet.html'),
})
```

- [ ] **Step 5: 验证 GREEN 并提交**

Run: `npx vitest run test/petInstall.test.ts test/petInstallWindows.test.ts test/petWindowLifecycle.test.ts`

Expected: 三个文件在 Windows、macOS、Linux 上都通过；测试继续分别覆盖 darwin 和 win32 的行为。

```bash
git add desktop/test/petInstall.test.ts desktop/test/petInstallWindows.test.ts desktop/test/petWindowLifecycle.test.ts
git commit -m "test: 消除桌面测试的宿主平台假设"
```

### Task 4: 全量桌面回归

**Files:**
- Verify: `desktop/test/**/*.test.*`
- Verify: `desktop/tsconfig.json`

**Interfaces:**
- Consumes: Tasks 1–3 的 Vitest 测试变更。
- Produces: 完整桌面测试与 TypeScript 类型检查结果。

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run`

Expected: 不再出现 `EPERM symlink`、POSIX 路径硬编码或真实 `ComSpec` 导致的失败；只接受设计文档中未涉及且已单独记录的失败。

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`

Expected: 退出码为 0；新增的 Vitest 测试上下文与辅助函数没有 TypeScript 错误。

- [ ] **Step 3: 提交验证记录（仅当 Task 1–3 已全部提交后）**

不创建空提交。将命令与结果写入本计划执行的 SDD 报告中，保持 Git 历史只包含实际代码与测试改动。
