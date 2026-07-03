# 清债波(Debt Sweep)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清空三层债目(spec `docs/specs/2026-07-03-debt-sweep.md`),使打包前代码库零已知缺陷、门禁全绿稳定。

**Architecture:** 基建先行(C 域稳门禁)→ 功能债(A 域,含 2 处 Java)→ 打磨债(B 域)。纯函数改动带单测,I/O 壳改动带 fake-child/E2E,调查类任务(C1/C2)带明确决策树与止损出口。

**Tech Stack:** Java 17/Maven(A1/B1/B4-Java/C2)、Electron main+React TS(其余)、vitest、Playwright-electron。

## Global Constraints

- 分支 `feat/debt-sweep`;逐项债务修复,**除处方项外零行为改动**;既有 testid 只增不改名。
- 每次提交前:`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"` 无命中;提交信息末尾空行后 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;只 add 本任务文件。
- 门禁基线(Task 1 若成功则 Java 切 0F/0E 新基线):Java 全量 939@3F/38E;vitest 143;Playwright 37;tsc 0。每任务钉自己的目标数。
- E2E 纪律:`WRAITH_E2E_USERDATA` 临时目录+清理;零 sleep,一律 expect.poll/locator 等待。
- E-2 既有不变量不得破坏:Runner settle 恰好一次/只 resolve;timer 全 unref+统一清理;tick/drain 全程同步无 await;并发 1;审批三层闭环;主会话链路零触碰。

---

### Task 1: C2 Java 3F/38E 噪音时间盒(诊断→升级→止损)

**Files:**
- Modify: `pom.xml`(mockito-core 版本,当前 5.11.0 @ 约 L113-117)
- Create(仅止损路径): `docs/notes/2026-07-03-jdk26-mockito-diagnosis.md`

**Interfaces:** 无代码接口;产出=新 Java 基线数字(后续所有任务的门禁引用它)。

- [ ] **Step 1: 抓取现有 38E 的真实堆栈**

```bash
mvn test -DskipTests=false 2>&1 | grep -B2 -A15 "ERROR.*Test\|MockitoException\|byte-buddy\|Unsupported" | head -120
```
预期看到 ByteBuddy/Java 版本不支持类签名(如 `Java 26 (70) is not supported`)。把代表性堆栈存档到临时文件备用。

- [ ] **Step 2: 升级 mockito-core 到最新 5.x**

`pom.xml` 中 `<version>5.11.0</version>` 改为 Maven Central 当前最新 5.x(用 `curl -s "https://search.maven.org/solrsearch/select?q=g:org.mockito+AND+a:mockito-core&rows=1&wt=json" | python3 -c "import json,sys;print(json.load(sys.stdin)['response']['docs'][0]['latestVersion'])"` 查询;若网络不可用则用 5.15.2 起步)。

- [ ] **Step 3: 全量验证**

```bash
mvn test -DskipTests=false 2>&1 | grep -E "Tests run:.*Failures" | tail -1
```
- **绿(0F/0E)** → 新基线成立,进 Step 4 提交。
- **仍有 E 且堆栈仍指向 byte-buddy** → 在 pom 显式加最新 `net.bytebuddy:byte-buddy` + `byte-buddy-agent` test 依赖再跑一次。
- **仍失败或出现新类别失败(Mockito API 变更需改测试代码 >3 处)** → **止损**:还原 pom,写诊断文档(堆栈+尝试记录+结论)到 `docs/notes/`,提交文档,报告 DONE_WITH_CONCERNS(基线维持 3F/38E)。

- [ ] **Step 4: 提交**

成功路径:`build(test): 升级 mockito 至 5.x 最新,消除 JDK26 兼容噪音(全量 939 转 0F/0E)`;止损路径:`docs(notes): JDK26+Mockito 噪音诊断(升级不可达,基线维持文档化)`。

---

### Task 2: C1 workspace-switch E2E 偶发根因(调查→修复→压测门禁)

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`(诊断日志,env 门控,保留)
- Modify: 根因所在文件(调查决定;候选:mock fixture / `desktop/src/main/index.ts` 事件转发 / `desktop/test/e2e/shell.e2e.ts:146`)
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:** 无新接口;产出=该用例 `--repeat-each=20 --workers=1` 全绿。

**已知事实**(编号引用,不要重查):①失败形态=提交 'hi' 后 `workspace-switch` 钮 disabled(`running===true`)持续 30s+;②transcript 在 message.delta 即可见,turn.completed 才置 running=false;③mock 正常在数十 ms 内发完 turn.completed;④BASE(4d2b4f1) 与 HEAD 失败率一致(~19-25%),高负载敏感,单跑常绿;⑤mock 的 stdout 经 main readline→client.handleLine→sendEvent→renderer。

- [ ] **Step 1: 加确定性诊断日志(env 门控,可留存)**

`mock-appserver.mjs` 的 `notify()` 与请求处理入口:当 `process.env.MOCK_DEBUG_LOG` 存在时,向该路径 append `${Date.now()} SEND ${method}\n` / `${Date.now()} RECV ${method}\n`(同步 appendFileSync,避免缓冲丢失)。`desktop/src/main/index.ts` 的主会话 notification 转发处(sendEvent 前):`WRAITH_E2E_DEBUG_LOG` 存在时同样 append `${Date.now()} FWD ${method}`。

- [ ] **Step 2: 复现并定位停滞段**

```bash
cd desktop && npm run build && MOCK_DEBUG_LOG=/tmp/c1-mock.log WRAITH_E2E_DEBUG_LOG=/tmp/c1-main.log npx playwright test -g "workspace switch re-picks" --repeat-each=30 --workers=1
```
失败例比对两份日志:turn.completed 是 mock 未发(SEND 缺)/main 未收(FWD 缺)/renderer 未处理(都在但 UI 卡)。按段进入 Step 3 对应分支。若 30 连全绿,升压(同时 `yes > /dev/null &` ×4 CPU 负载)再 30 连;仍不复现 → 走 Step 3-D。

- [ ] **Step 3: 按定位修根因(四分支)**

- **3-A mock 未发**:检查 mock 内 await/定时链在负载下的行为(如 `delay()` 的 setTimeout 饿死、写 stdout 背压),修 mock。
- **3-B main 未收**:readline 分包/背压问题,查 `createInterface` 与大行处理,修 main 转发。
- **3-C renderer 未处理**:事件到达但 dispatch 前被节流/丢弃(注意 `status` 100ms 节流只吞 status;确认 turn.completed 不经节流),修 App 事件分派。
- **3-D 不可复现**:把该用例的点击前置等待改为确定性条件 `await expect(win.locator('[data-testid="workspace-switch"]')).toBeEnabled({ timeout: 30000 })` 之后再 click(消除"transcript 可见≠turn 完成"的窗口依赖),并在用例注释记录调查证据与结论。**不允许 sleep/不允许跳测。**

- [ ] **Step 4: 压测门禁 + 全量回归**

```bash
npx playwright test -g "workspace switch re-picks" --repeat-each=20 --workers=1   # 期望 20 passed
npx playwright test                                                                # 期望 37 passed
npx tsc --noEmit && npx vitest run                                                 # 0 错误 / 143 passed
```

- [ ] **Step 5: 提交** `fix(desktop-e2e): workspace-switch 偶发根因修复(<定位结论>)+诊断日志门控`

---

### Task 3: A1-Java `mcp.enable/restart` 异步化(dispatch 不阻塞)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java`(:131/:133 及类字段、close 路径)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java`

**Interfaces:**
- Consumes: `McpServerManager.enable/restart(String)`(synchronized,同步 start,**保持不动**——CLI 依赖其同步语义);既有 `setStatusListener` → `mcp.status` 通知链。
- Produces: `McpOps.enable/restart` 语义变更为"受理即返回"(wire 形状 `{ok:true}` 不变,`AppServer.java:98/:100` 的 `ok(msg)` 不动);启动结果经 `mcp.status`(STARTING→READY/ERROR)呈现。

- [ ] **Step 1: 写失败测试**(先读 AppServerMcpTest 既有 fixture 模式——E-1 已有假 stdio server 脚本构造法,复用同款;慢 server = 握手前 sleep 数秒的脚本)

```java
@Test void enableReturnsBeforeSlowServerReady() throws Exception {
    // 配置一个握手前 sleep 3s 的 stdio server(复用本文件既有 fake-server 构造法)
    long t0 = System.nanoTime();
    ops.enable("slow");                                  // 应立即返回
    long elapsedMs = (System.nanoTime() - t0) / 1_000_000;
    assertTrue(elapsedMs < 1000, "enable 阻塞了 " + elapsedMs + "ms");
    // 状态最终经监听器到达 READY(轮询既有 status 收集器,超时 10s)
    awaitStatus("slow", McpServerStatus.READY, 10_000);
}
```
再写一条 `restartReturnsBeforeSlowServerReady`(同型)。运行:`mvn test -Dtest=AppServerMcpTest -DskipTests=false` 预期 FAIL(当前同步实现 elapsedMs≈3000)。

- [ ] **Step 2: 实现——单线程 daemon 执行器 offload**

```java
private final java.util.concurrent.ExecutorService mcpControlExecutor =
        java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "wraith-mcp-control");
            t.setDaemon(true);
            return t;
        });

@Override public void enable(String name) {
    requireServer(name);                       // 校验保持同步(快):未知名仍即时 -32000
    McpServerManager m = requireManager();
    mcpControlExecutor.submit(() -> {
        try { m.enable(name); }
        catch (RuntimeException e) { /* 结果经 mcp.status(ERROR) 呈现,此处不再有响应通道 */ }
    });
}

@Override public void restart(String name) {   // 同型
    requireServer(name);
    McpServerManager m = requireManager();
    mcpControlExecutor.submit(() -> {
        try { m.restart(name); } catch (RuntimeException e) { /* 同上 */ }
    });
}
```
`disable` 保持同步(无进程 spawn,快)。在本类既有的关闭/重建路径(close 或 ensureFor 换工作区处——以文件实际为准)补 `mcpControlExecutor.shutdownNow()`,防执行器泄漏;若类无统一 close,则挂到 manager close 同点。单线程执行器天然串行化 enable/restart,与 manager synchronized 不产生新竞态。

- [ ] **Step 3: 补 dispatch 不阻塞证明测试**

```java
@Test void slowEnableDoesNotBlockOtherRpc() throws Exception {
    ops.enable("slow");                          // 3s 慢启动在途
    long t0 = System.nanoTime();
    Map<String, Object> r = ops.list();          // 另一个 MCP 调用应立即完成
    assertTrue((System.nanoTime() - t0) / 1_000_000 < 1000);
    assertNotNull(r.get("servers"));
}
```

- [ ] **Step 4: 门禁**:`mvn test -Dtest=AppServerMcpTest -DskipTests=false` 全绿;`mvn test -DskipTests=false` 全量对基线(Task 1 结果)。

- [ ] **Step 5: 提交** `fix(mcp): enable/restart 异步化受理即返回,结果经 mcp.status(dispatch 不再被慢启动卡死)`

---

### Task 4: A1-desktop 异步语义适配审计(+E2E 核验)

**Files:**
- Modify(如审计需要): `desktop/src/renderer/App.tsx`(:543-550 handleMcpToggle/handleMcpRestart)、`desktop/src/renderer/components/PluginsPanel.tsx`(busy 语义)
- Test: `desktop/test/e2e/shell.e2e.ts`(既有 MCP 用例 T26-T32 审计)

**Interfaces:** Consumes: Task 3 的"受理即返回"语义;既有 `mcp.status` → `fetchMcp/fetchMcpResources` 刷新链(App.tsx:142-149,已存在)。

- [ ] **Step 1: 审计三点并修正**
  1. `handleMcpToggle/handleMcpRestart`(App.tsx:543-550):await 返回后 `fetchMcp()` 现在拿到的是 starting 态——确认 PluginsPanel 对 starting 的渲染正常(有状态徽标即可),ready 后由 status 链二次刷新(已有)。若 busy 标志在 await 期间锁按钮、返回即解锁导致可疯狂点击:enable/restart 按钮在该 server `state==='starting'` 时也置 disabled。
  2. 既有 E2E T26-T32 中若有"enable 后立即断言 ready/工具列表"的用例:mock 是同步的所以仍绿,但语义上应确认断言走 expect.poll(容忍中间态)。只改脆弱断言,不动通过语义。
  3. mock fixture 的 mcp.enable 处理:保持同步响应(真后端异步化后 mock 更"快"是安全方向,无需改)。

- [ ] **Step 2: 门禁**:`cd desktop && npx tsc --noEmit && npx vitest run`(143)`&& npm run build && npx playwright test`(37)。

- [ ] **Step 3: 提交** `fix(desktop): MCP 启停按钮适配异步受理语义(starting 态禁点,断言容忍中间态)`

---

### Task 5: A2 Runner.stopNow() + will-quit 同步发信号

**Files:**
- Modify: `desktop/src/main/automationRunner.ts`(stop 区域 :98-107)
- Modify: `desktop/src/main/automationScheduler.ts`(stopAll :51-59)
- Test: `desktop/test/automationRunner.test.ts`(+1 用例,fake-child 复用 `desktop/test/fixtures/fake-child.mjs`)

**Interfaces:**
- Produces: `AutomationRunner.stopNow(): void`——置 stopping、**立即** killChild()(SIGTERM 当场发出+既有 2s SIGKILL 升级),不发 turn.interrupt、不等 500ms 宽限。
- `AutomationScheduler.stopAll()` 改调 `runner.stopNow()`;`finishRun(interrupted)` 同步落盘语义不变;正常 `stop()`(交互「终止」钮)的 interrupt+500ms 宽限语义**不变**。

- [ ] **Step 1: 失败测试**(fake-child 忽略 SIGTERM 的既有模式,断言 stopNow 后 SIGTERM 立即送达:fake-child 收到 SIGTERM 时向 stdout/文件写标记,test 用 expect.poll 在 <500ms 内看到标记——证明没等宽限)

```ts
it('stopNow 立即发 SIGTERM(不等 500ms 宽限)', async () => {
  // 复用本文件既有 fake-child 启动法;fake-child 增/复用 SIGTERM 标记输出
  const runner = makeRunner()                    // 既有 helper
  const done = runner.run(tmpDir, 'hi')
  await waitChildSpawned()                       // 既有等待手法
  const t0 = Date.now()
  runner.stopNow()
  await expect.poll(() => sigtermMarkerSeen(), { timeout: 1500 }).toBe(true)
  expect(Date.now() - t0).toBeLessThan(500)      // 宽限是 500ms,收到即证明未走宽限
  await done                                     // interrupted 终局(exit→stopped)
})
```

- [ ] **Step 2: 实现**

```ts
/** A2: will-quit 专用——立即回收(SIGTERM 当场发出+2s SIGKILL 升级),不发 interrupt、不等宽限。 */
stopNow(): void {
  this.stopping = true
  this.killChild()
}
```
`stopAll()` 中 `cur.runner.stop()` → `cur.runner.stopNow()`。

- [ ] **Step 3: 门禁**:`npx vitest run`(143+1=**144**)+ tsc 0。
- [ ] **Step 4: 提交** `fix(desktop): will-quit 走 stopNow 同步发信号,消孤儿子进程(交互终止宽限语义不变)`

---

### Task 6: A3+A5+A6 调度/存储三小修

**Files:**
- Modify: `desktop/src/main/automationsStore.ts`(新增 upsertTaskFromRenderer)
- Modify: `desktop/src/main/index.ts`(:382-385 automationUpsert 改调新函数)
- Modify: `desktop/src/main/automationScheduler.ts`(:140-144 statSync 失败路径)
- Modify: `desktop/src/main/automationRunner.ts`(constructor +taskId 标签,:44 stderr 前缀)
- Test: `desktop/test/automationsStore.test.ts`(+1)、`desktop/test/automationScheduler.shell.test.ts`(新文件,+1:A5)、`desktop/test/automationRunner.test.ts`(+1:A6,fake-child 手法在此)

**Interfaces:**
- Produces: `upsertTaskFromRenderer(dir, task)`——已存在任务忽略传入 lastFiredAt 保留 store 现值(锚点归调度器所有),新任务原样写入;
- `AutomationRunner` 构造签名 `(env, homedir, cb, taskId?: string)`,stderr 前缀 `[automation:<taskId>]`(未传时退回 `[automation]`);Scheduler `fire()` 传 `task.id`。

- [ ] **Step 1: A3 失败测试→实现**

```ts
it('upsertTaskFromRenderer 保留已存在任务的 lastFiredAt(锚点归调度器)', () => {
  upsertTask(dir, task({ id: 'a', lastFiredAt: 111 }))
  upsertTask(dir, { ...task({ id: 'a' }), lastFiredAt: 999 })          // 调度器推进锚点
  upsertTaskFromRenderer(dir, task({ id: 'a', lastFiredAt: 111 }))     // renderer 陈旧快照回写
  expect(readTasks(dir).find(t => t.id === 'a')!.lastFiredAt).toBe(999)
  upsertTaskFromRenderer(dir, task({ id: 'b', lastFiredAt: 5 }))       // 新任务原样
  expect(readTasks(dir).find(t => t.id === 'b')!.lastFiredAt).toBe(5)
})
```
```ts
/** A3: renderer 全量回写入口——lastFiredAt 归调度器所有,已存在任务保留 store 现值。 */
export function upsertTaskFromRenderer(dir: string, task: AutomationTask): void {
  const existing = readTasks(dir).find(t => t.id === task.id)
  upsertTask(dir, existing ? { ...task, lastFiredAt: existing.lastFiredAt } : task)
}
```
index.ts handler 改调 `upsertTaskFromRenderer`(import 同步补)。

- [ ] **Step 2: A5 失败测试→实现**(新文件 automationScheduler.shell.test.ts:构造 AutomationScheduler,deps 全为 vi.fn 记录器,runNow 指向不存在目录的任务)

```ts
it('目录失踪的 failed run 触发 onTerminal(系统通知链)', () => {
  seedTask(dir, task({ id: 'a', projectPath: '/nonexistent-xyz' }))
  const onTerminal = vi.fn()
  const s = new AutomationScheduler({ userDataDir: dir, env: process.env, homedir: os.tmpdir(),
    onRunsChanged: vi.fn(), onApproval: vi.fn(), onTerminal })
  s.runNow('a')
  expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', summary: '项目目录不存在' }))
})
```
实现:fire() 的 catch 块把 failedRun 提为局部变量,`putRun` 后追加 `this.deps.onTerminal(failedRun)`(onRunsChanged 保留在前,与 finishRun 顺序契约一致)。

- [ ] **Step 3: A6 失败测试→实现**

```ts
it('stderr 转发带 taskId 前缀', async () => {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const runner = new AutomationRunner(env, home, cbs, 'task-42')       // 新 4 参
  /* 用 fake-child 输出一行 stderr 的既有手法驱动 */
  await expect.poll(() =>
    spy.mock.calls.some(c => String(c[0]).startsWith('[automation:task-42]'))).toBe(true)
  spy.mockRestore()
})
```
实现:constructor 增 `private readonly taskId?: string`;:44 改 `` process.stderr.write(`[automation:${this.taskId ?? ''}] ${c}`) `` 形态为 `this.taskId ? \`[automation:${this.taskId}] \` : '[automation] '` 前缀;scheduler fire() 的 `new AutomationRunner(this.deps.env, this.deps.homedir, {...}, task.id)`。

- [ ] **Step 4: 门禁**:vitest 144+3=**147**、tsc 0。
- [ ] **Step 5: 提交** `fix(desktop): upsert 保留调度锚点+目录失踪通知+stderr taskId 前缀`

---

### Task 7: A4+B6 渲染层 E-2 打磨批次

**Files:**
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx`(:31-35 debounce 回调)
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(:120-123 badge)
- Modify: `desktop/src/renderer/components/AutomationRuns.tsx`(:14-17 颜色、:62 stop 风格)
- Modify: `desktop/src/renderer/lib/automationLabels.ts`
- Test: `desktop/test/automationsStore.test.ts`(坏 JSON 用例内补断言)、`desktop/test/automationLabels.test.ts`(新,+1)、E2E 不新增

**Interfaces:** 无新接口;A4 语义=面板存活期间收到 runs-changed 即视为已读(main 的 panelOpened 处理已回推 badge,现成)。

- [ ] **Step 1: A4 面板可见即已读**——AutomationsPanel 的 debounce 回调内、`void fetchTasks()` 之后加一行:

```ts
debounceTimer = setTimeout(() => {
  debounceTimer = null
  void fetchTasks()
  void window.wraith.automationPanelOpened()   // A4: 面板可见期间到达的终态即视为已读,红点不重亮
}, 80)
```

- [ ] **Step 2: B6 红点涟漪动效**(Sidebar :120-123 替换;testid 留外层,ml-auto 布局职责随之上移):

```tsx
{automationBadge && (
  <span data-testid="nav-automations-badge" className="relative ml-auto flex h-2 w-2 shrink-0">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:hidden" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
  </span>
)}
```

- [ ] **Step 3: B6 其余三件**
  - AutomationRuns `STATUS_COLOR.waiting_approval: 'text-danger'` → `'text-warning'`;
  - AutomationRuns :62 stop onClick 改内联 async 风格(行为与 catch 不变):`onClick={() => { void (async () => { try { await window.wraith.automationStop(r.runId); await fetchRuns() } catch (err) { console.error('[wraith] automationStop error:', err) } })() }}`;
  - automationLabels:函数首行加 `if (t.lastFiredAt === null && t.enabledAt === 0) return '待触发'`(防 epoch-0 历史日期),新测试文件断言该分支 + 正常分支格式 `下次 MM-DD HH:mm`。

- [ ] **Step 4: B6 store 测试补强**——坏 JSON 用例(automationsStore.test.ts)内追加(不加新 it):

```ts
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
expect(readTasks(dir)).toEqual([])
expect(readRuns(dir)).toEqual([])
expect(readLastPanelOpenedAt(dir)).toBe(0)                              // 坏文件按缺省
expect(warnSpy.mock.calls.some(c => String(c[0]).includes('[automations]'))).toBe(true)
warnSpy.mockRestore()
```
(spy 需在两个 read 调用之前建立;按用例实际顺序摆放。)

- [ ] **Step 5: 门禁**:vitest 147+1=**148**、tsc 0、`npm run build && npx playwright test` 37 全绿(badge/颜色/面板改动涉 E2E 面)。
- [ ] **Step 6: 提交** `fix(desktop): 面板可见即已读+红点涟漪动效+E-2 渲染微项(色/标签/风格/测试补强)`

---

### Task 8: B1 reattach 在途 READY 窗(Java 并发)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/mcp/McpServerManager.java`(startAll worker READY 转换区 约:427-455;reattach :559)
- Test: `src/test/java/com/lyhn/wraith/mcp/McpServerManagerTest.java`(+1 并发用例;禁 Mockito,沿用本套件既有假 server 手法)

**Interfaces:** Consumes: volatile `toolRegistry` 字段(E-1 已有)、`reattach(ToolRegistry)` synchronized。Produces: 不变的公共 API;新不变量=**工具注册动作在注册时刻读取当前 registry**,与 reattach 互斥。

- [ ] **Step 1: 先读代码确认窗口形态**——startAll worker 在异步线程完成握手后注册工具并 setStatus(READY);若它在进入注册前捕获了旧 registry 局部引用,reattach(newRegistry) 之后该注册落入旧 registry(新 registry 缺该 server 工具)。以真实代码为准记录读到的形态到报告。

- [ ] **Step 2: 失败测试**(时序化:慢 server 握手期间调 reattach,断言工具最终只在新 registry)

```java
@Test void inflightReadyRegistersIntoNewRegistryAfterReattach() throws Exception {
    // slow fake server:握手 sleep 800ms(本套件既有构造法)
    manager.startAll();                      // 异步;slow 尚未 READY
    ToolRegistry fresh = new ToolRegistry(/* 本套件既有构造参数 */);
    manager.reattach(fresh);                 // 在途窗口内换 registry
    awaitStatus("slow", McpServerStatus.READY, 10_000);
    assertTrue(fresh.names().stream().anyMatch(n -> n.startsWith("mcp__slow__")),
        "在途 READY 的工具必须落入 reattach 后的新 registry");
    // 旧 registry 不应新增(构造时记录基数比对)
}
```
(`names()`/等价枚举以 ToolRegistry 真实 API 为准;无则用注册副作用可观察点。)

- [ ] **Step 3: 实现**——把 worker 的"注册工具"动作收敛为私有方法 `registerToolsLocked(McpServer)`:`synchronized (this)` 内**重新读取** `this.toolRegistry` 执行注册(与 reattach 的 synchronized 互斥);worker 中原地注册替换为调该方法;`closed` 双检保留。reattach 侧无需改(它已 synchronized 且遍历 READY 重注册——本修复保证"尚未 READY 的在途者"经同一锁点落新 registry)。

- [ ] **Step 4: 门禁**:`mvn test -Dtest=McpServerManagerTest -DskipTests=false` 全绿含新用例;全量对基线。
- [ ] **Step 5: 提交** `fix(mcp): 在途 READY 注册经锁点读取当前 registry,消 reattach 竞态窗`

---

### Task 9: B2 @-mention 不可展开候选过滤

**Files:**
- Modify: `desktop/src/shared/mentionTrigger.ts`(filterMentionItems)
- Test: `desktop/test/mentionTrigger.test.ts`(+1;文件名以现有测试为准)

**Interfaces:** Consumes: `McpResourceView`(shared/types)与 `filterMentionItems(resources, query)`(Composer.tsx:51 调用)。Produces: 过滤语义收紧——**uri 为空/空白的资源不出现在候选中**(AtMentionExpander 按 uri 展开,无 uri 即不可展开;E-1 终审 backlog 原文"@语法不可展开候选未过滤")。

- [ ] **Step 1: 读 filterMentionItems 现状与 McpResourceView 字段**,确认候选唯一可展开性判据是非空 uri(若实际存在其它不可展开形态——如 server 非 ready 条目混入——一并按同一原则过滤并在报告注明)。
- [ ] **Step 2: 失败测试**:

```ts
it('uri 为空的资源不进入 @ 候选(不可展开)', () => {
  const items = filterMentionItems([
    { server: 's', uri: 'file:///a.txt', name: 'a' } as McpResourceView,
    { server: 's', uri: '', name: 'ghost' } as McpResourceView,
    { server: 's', uri: '   ', name: 'blank' } as McpResourceView,
  ], '')
  expect(items.map(i => i.name)).toEqual(['a'])
})
```
- [ ] **Step 3: 实现**:filterMentionItems 首步 `resources.filter(r => r.uri && r.uri.trim() !== '')`(以真实字段名为准)。
- [ ] **Step 4: 门禁**:vitest 148+1=**149**、tsc 0。
- [ ] **Step 5: 提交** `fix(desktop): @-mention 过滤不可展开候选(空 uri)`

---

### Task 10: B3 mock 保真(configError + turnId)+ configError E2E

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`(:34 turnId;mcp.list 结果)
- Modify: `desktop/src/renderer/components/PluginsPanel.tsx`(:80-82 banner 补 testid)
- Test: `desktop/test/e2e/shell.e2e.ts`(+1:T38)

**Interfaces:** Produces: fixture 新 env `MOCK_MCP_CONFIG_ERROR`(值原样注入 mcp.list 结果的 `configError` 字段);turnId 改每次 turn.submit 递增(`turn_1, turn_2, ...`)且同一 turn 的所有通知与响应共用同一 id(保真真后端行为);PluginsPanel banner `data-testid="mcp-config-error"`。

- [ ] **Step 1: fixture 两改**——`let turnId = 'turn_1'` → `let turnSeq = 0; let turnId = ''`,turn.submit 处理入口 `turnId = \`turn_${++turnSeq}\``(该 turn 全部 notify 与响应用它);mcp.list 响应组装处:`...(process.env['MOCK_MCP_CONFIG_ERROR'] ? { configError: process.env['MOCK_MCP_CONFIG_ERROR'] } : {})`。
- [ ] **Step 2: PluginsPanel banner 加 testid**(:81 div 上 `data-testid="mcp-config-error"`,样式不动)。
- [ ] **Step 3: 新 E2E T38**(launchMcpApp 既有 helper 基础上传入 `MOCK_MCP_CONFIG_ERROR: 'mcp.json 第 3 行解析失败'`):进入插件面板,`await expect(win.locator('[data-testid="mcp-config-error"]')).toContainText('第 3 行')`;既有用例零改动(turnId 递增对既有断言透明——若有用例硬编码 'turn_1' 字符串,改为匹配 `turn_\d+`,在报告列出改动点)。
- [ ] **Step 4: 门禁**:`npm run build && npx playwright test` 37+1=**38** 全绿;vitest 149、tsc 0。
- [ ] **Step 5: 提交** `test(desktop): mock 保真(configError 注入+turnId 递增)+插件面板坏配置横幅 E2E`

---

### Task 11: B4 Phase C 遗留批次

**Files:**
- Modify: `desktop/src/renderer/components/DiffCard.tsx`(:17-21)
- Modify: `desktop/src/renderer/components/ApprovalModal.tsx`(:172)
- Modify: `desktop/src/renderer/App.tsx`(:215、:455 两处 resetSession dispatch 前)
- Modify: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerApprovalRespondTest.java`(:78、:132)
- Test: `desktop/test/buildApprovalResponse.test.ts`(+1)

**Interfaces:** 无新接口;全部为既有行为加固。

- [ ] **Step 1: DiffCard 可及性+hover token 化**——toggle 按钮(:18-21)加 `aria-expanded={!collapsed}`;`hover:bg-black/[0.02]` → `hover:bg-surface/60`(ThinkingBlock 已有 aria-expanded,不动)。
- [ ] **Step 2: ApprovalModal hover token 化**——:172 `hover:bg-black/[0.03]` → `hover:bg-surface/60`。
- [ ] **Step 3: throttle cancel 紧贴 resetSession**——App.tsx :215 与 :455 的 `dispatch({ type: 'resetSession', ... })` 前各加 `statusThrottleRef.current?.cancel()`(消灭 100ms 窗内旧会话 status 尾巴)。
- [ ] **Step 4: Java harness 断言**——AppServerApprovalRespondTest :78 与 :132 的 `server.join(2000);` 后各加 `assertFalse(server.isAlive());`(import static org.junit.jupiter.api.Assertions.assertFalse 若缺)。运行 `mvn test -Dtest=AppServerApprovalRespondTest -DskipTests=false` 全绿。
- [ ] **Step 5: validateArgsJson('') 边界测试**——读 `desktop/src/shared/buildApprovalResponse.ts` 中 validateArgsJson 对空串的实际行为,新增一条 it 断言之(文档化边界语义;若行为明显不合理——如空串抛异常——按"空串=未修改,合法"修正实现并在报告注明)。
- [ ] **Step 6: 门禁**:vitest 149+1=**150**、tsc 0、E2E 38 全绿(hover/aria 不动断言,跑全量防意外)、Java 全量对基线。
- [ ] **Step 7: 提交** `fix(desktop+test): Phase C 遗留批次(aria/hover token/throttle cancel/harness 断言/argsJson 边界)`

---

### Task 12: B5 严格并发 1(等旧 child 退净再 fire)

**Files:**
- Modify: `desktop/src/main/automationRunner.ts`(新增 exited promise)
- Modify: `desktop/src/main/automationScheduler.ts`(fire 的 .finally 链)
- Test: `desktop/test/automationRunner.test.ts`(+1 fake-child 用例)

**Interfaces:**
- Produces: `AutomationRunner.exited: Promise<void>`——子进程 exit **或** spawn error 时 resolve;从未 spawn(run 未调)时永不 resolve(调用方只在 run 后使用)。
- Scheduler 语义:run() settle(终态)后,**等 exited 再**清 current 并 drainQueue——任意时刻至多一个自动化子进程存活(消 SIGTERM→SIGKILL ≤2s 双进程窗)。stopAll 不受影响(同步清队列+finishRun;exited 迟到无害——current 由 stopAll 语义废弃)。

- [ ] **Step 1: Runner 实现 exited**

```ts
private exitedResolve: (() => void) | null = null
readonly exited: Promise<void> = new Promise(res => { this.exitedResolve = res })
```
`proc.on('exit', ...)` 回调首行与 `proc.on('error', ...)` 回调首行各加 `this.exitedResolve?.(); this.exitedResolve = null`(幂等)。

- [ ] **Step 2: Scheduler 接线**——fire() 尾链改:

```ts
}).finally(() => {
  // B5: 终态(settle)后等子进程真正退净(SIGKILL 升级 ≤2s 兜底),保证任意时刻至多一个自动化子进程
  void runner.exited.then(() => {
    this.current = null
    this.drainQueue()
  })
})
```
注意:current 在 exited 前保持占位——runNow/decideTick 视该任务仍 active(判 miss/拒重复),语义正确;tick 兜底 drain 的 `!this.current` 守卫天然等待。

- [ ] **Step 3: 失败测试**(fake-child 忽略 SIGTERM → exit 靠 2s SIGKILL;两任务排队,断言第二个 runner 的 spawn 不早于第一 child 的 exit;用 fake-child 写 spawn/exit 时间戳文件比对;vitest timeout 10s)。

- [ ] **Step 4: 门禁**:vitest 150+1=**151**、tsc 0、E2E 38 全绿(T33-T37 走真链,验证接线无回归)。
- [ ] **Step 5: 提交** `fix(desktop): 严格并发1——旧子进程退净后再出队 fire(消双进程窗)`

---

## 收尾(controller 执行)

1. **整支终审**(最强模型;焦点:①C1/C2 调查结论的证据链与门禁真实性 ②A1/B1 两处 Java 并发改动 ③B5 与 E-2 既有不变量(settle/无 await/并发1)的组合 ④wire/语义变更面(enable 受理即返回)对 CLI 与桌面双端的一致性 ⑤台账 Minor 全量复盘)→ ONE 修复 subagent → 复验。
2. **全量回归**:Java(基线以 Task 1 结果为准)+ vitest 151 + E2E 38(含 C1 压测 20 连)+ tsc 0。
3. **jar 重建 + 眼验卡**(边清边验,用户已授权):重建 `~/.wraith/wraith.jar`;卡 A(MCP/自动化功能债,≤5 分钟):真 MCP server 启用期间主会话不卡(A1)、app 退出无孤儿+interrupted 落盘(A2)、面板停留红点不重亮(A4)、通知(A5)、红点涟漪(B6);卡 B(旧欠 ROADMAP 项按域合并勾销)。
4. **merge --no-ff 回 main + push**;ROADMAP 更新(遗留 Minor 节清空/收编,眼验项勾销记录)。
