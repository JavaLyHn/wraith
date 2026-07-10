# 微信网关 Phase C 实现计划(桌面:扫码绑定流 + 微信卡)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 执行。步骤用 `- [ ]`。
> **前置**:Phase A+B(feat/im-weixin-gateway)已完成。本计划纯桌面侧(`desktop/`)。

**Goal:** 桌面「IM 网关」屏支持个人微信:平台卡可选、「扫码绑定」按钮(spawn `gateway bind-weixin`,二维码经日志区呈现 + 链接兜底自动打开)、绑定状态/主人/工作目录展示与保存,anyBound 并入 weixin。

**Architecture:** 复用 QQ 的桌面 bind 机器(spawn + 行解析 + bind 事件):`gatewayManager` 加 `resolveBindWeixinCommand`/`parseWeixinQrUrl`/`bindWeixinStart`(现有 `classifyBindLine` 的关键词恰好匹配 WeixinBind 输出——绑定成功/绑定超时/已过期);IPC 加 `gatewayBindWeixinStart` 与 `gatewaySetWeixinConfig`(仅 workspace);面板加微信分支。绑定中每 2s 拉日志展示终端二维码(Unicode 块字符在 `<pre>` 等宽区可扫)。

**Tech Stack:** Electron 三端,React,TypeScript,vitest。

## Global Constraints

- 密钥红线:`bot_token` 不经任何 renderer 结构(weixin 视图已由 Phase B 保证只回 bound/hasSecret/ownerUserid/workspace);桌面代码不新增任何 token 通路。
- `parseWeixinQrUrl` 只认 `https?://` 开头的链接才交给 `openExternal`(防非 URL 内容误开)。
- weixin 的 workspace 保存仅在**已绑定**时可用(set 只更新已存账号);未绑定时 workspace 经「扫码绑定」的 `--workspace` 传入。
- 每任务:`npm run typecheck` + `npx vitest run` 全绿(在 `desktop/`);Task 3 加 `npm run build`;提交前红线扫描。
- 不改动 QQ/飞书/企微既有分支与 bind 机器(只新增平行方法)。

---

### Task 1: gatewayManager 微信绑定机器 + 测试

**Files:**
- Modify: `desktop/src/main/gatewayManager.ts`
- Modify: `desktop/test/gatewayManager.test.ts`

**先读现有文件全文**(`resolveBindCommand`/`bindStart`/`classifyBindLine` 是范式)。

- [ ] **Step 1: 追加失败测试**(gatewayManager.test.ts):

```ts
describe('resolveBindWeixinCommand', () => {
  it('appends bind-weixin to the gateway command', () => {
    expect(resolveBindWeixinCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j/wraith.jar', 'gateway', 'bind-weixin'],
    })
  })
  it('appends --workspace when provided', () => {
    expect(resolveBindWeixinCommand({}, '/j.jar', undefined, '/ws')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j.jar', 'gateway', 'bind-weixin', '--workspace', '/ws'],
    })
  })
})

describe('parseWeixinQrUrl', () => {
  it('extracts http(s) url after 打开链接 marker', () => {
    expect(parseWeixinQrUrl('扫码失败时可打开链接:https://x.y/qr?z=1')).toBe('https://x.y/qr?z=1')
  })
  it('rejects non-http content and unrelated lines', () => {
    expect(parseWeixinQrUrl('扫码失败时可打开链接:weixin://xyz')).toBeNull()
    expect(parseWeixinQrUrl('普通行')).toBeNull()
  })
})

describe('classifyBindLine — weixin 输出', () => {
  it('认微信绑定成功/二维码过期/超时', () => {
    expect(classifyBindLine('✅ 微信绑定成功,账号: acc1')).toBe('bound')
    expect(classifyBindLine('[gateway] 二维码已过期,请重试 wraith gateway bind-weixin')).toBe('failed')
    expect(classifyBindLine('[gateway] 绑定超时(未在限定时间内完成扫码),请重试')).toBe('failed')
  })
})
```
(import 处补 `resolveBindWeixinCommand, parseWeixinQrUrl`。)

- [ ] **Step 2: 跑确认失败** — `npx vitest run test/gatewayManager.test.ts`。

- [ ] **Step 3: 实现**(gatewayManager.ts):

纯函数区(resolveBindCommand 之后):
```ts
/** 微信绑定命令 = 网关命令 + `bind-weixin` [+ --workspace <dir>]。 */
export function resolveBindWeixinCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
  workspace?: string,
): { cmd: string; args: string[] } {
  const g = resolveGatewayCommand(env, defaultJar, packaged)
  const args = [...g.args, 'bind-weixin']
  if (workspace && workspace.trim()) args.push('--workspace', workspace.trim())
  return { cmd: g.cmd, args }
}

/** 从 bind-weixin 输出行提取扫码兜底链接;仅 http(s) 才返回(防 openExternal 误开非 URL 内容)。 */
export function parseWeixinQrUrl(line: string): string | null {
  const marker = '扫码失败时可打开链接:'
  const idx = line.indexOf(marker)
  if (idx < 0) return null
  const url = line.slice(idx + marker.length).trim()
  return /^https?:\/\/\S+$/.test(url) ? url : null
}
```

`GatewayManager` 类内(bindStart 之后,结构镜像 bindStart;共用 `this.bindProc`/`cancelBind`/exit 分发):
```ts
  /** 一次性微信扫码绑定。spawn `... gateway bind-weixin`;二维码在输出(日志区可见),http 链接兜底打开。 */
  bindWeixinStart(workspace?: string): void {
    if (this.bindProc) return
    const { cmd, args } = resolveBindWeixinCommand(this.env, this.jarPath, this.packaged, workspace)

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch (e) {
      this.onEvent({ kind: 'bind', phase: 'failed', message: '启动微信绑定失败: ' + (e as Error).message })
      return
    }
    this.bindProc = proc

    let resolvedPhase: GatewayBindPhase | null = null
    let cancelled = false

    const handleLine = (l: string): void => {
      this.pushLog(l)
      if (l.includes('请用目标微信扫描二维码')) {
        this.onEvent({ kind: 'bind', phase: 'scanning' })
      }
      const url = parseWeixinQrUrl(l)
      if (url) this.openExternal(url)
      const phase = classifyBindLine(l)
      if (phase) resolvedPhase = phase
    }
    readline.createInterface({ input: proc.stdout }).on('line', handleLine)
    readline.createInterface({ input: proc.stderr }).on('line', handleLine)

    this.cancelBindImpl = () => { cancelled = true }

    proc.on('exit', (code) => {
      if (this.bindProc !== proc) return
      this.bindProc = null
      this.cancelBindImpl = null
      if (cancelled) {
        this.onEvent({ kind: 'bind', phase: 'cancelled' })
      } else if (resolvedPhase === 'bound') {
        this.onEvent({ kind: 'bind', phase: 'bound' })
      } else {
        this.onEvent({
          kind: 'bind',
          phase: 'failed',
          message: resolvedPhase === 'failed' ? '绑定失败/超时/二维码过期,请重试' : `绑定进程退出(code=${code})`
        })
      }
    })
  }
```

- [ ] **Step 4: 跑确认通过** — 全部 gatewayManager 用例绿(原 + 新)+ `npm run typecheck`。

- [ ] **Step 5: Commit**
```bash
git add desktop/src/main/gatewayManager.ts desktop/test/gatewayManager.test.ts
git commit -m "feat(desktop/gateway): 微信扫码绑定机器(bind-weixin spawn/QR 链接解析/输出分类)+ 单测"
```

---

### Task 2: IPC(gatewayBindWeixinStart + gatewaySetWeixinConfig)

**Files:**
- Modify: `desktop/src/shared/gateway.ts`(加 `WeixinConfigFields`)
- Modify: `desktop/src/preload/index.ts`(两方法声明 + 实现)
- Modify: `desktop/src/main/index.ts`(两 handler;bind 的 manager 调用点对照现有 `wraith:gatewayBindStart` handler 找到 gatewayManager 实例变量名)

- [ ] **Step 1: shared 类型**(FeishuConfigFields/WecomConfigFields 之后):
```ts
/** 微信配置写入字段:仅 workspace 可改(token/owner 由扫码绑定写入账号店)。 */
export interface WeixinConfigFields {
  workspace?: string
}
```

- [ ] **Step 2: preload**(声明区 gatewaySetWecomConfig 之后 + 实现区对应位置;import 并入 WeixinConfigFields):
```ts
  gatewayBindWeixinStart(workspace?: string): Promise<void>
  gatewaySetWeixinConfig(fields: WeixinConfigFields): Promise<{ ok: boolean }>
```
```ts
  gatewayBindWeixinStart(workspace?: string) {
    return ipcRenderer.invoke('wraith:gatewayBindWeixinStart', workspace) as Promise<void>
  },
  gatewaySetWeixinConfig(fields: WeixinConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetWeixinConfig', fields) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: main handlers**(gatewaySetWecomConfig handler 之后;bind handler 照现有 `wraith:gatewayBindStart` 的写法拿 manager 实例):
```ts
ipcMain.handle('wraith:gatewayBindWeixinStart', (_e, workspace?: string) => {
  gatewayManager?.bindWeixinStart(workspace)   // 变量名以现有 gatewayBindStart handler 实际为准
})
ipcMain.handle('wraith:gatewaySetWeixinConfig', async (_e, fields: Record<string, string | undefined>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'weixin', ...fields })
  return { ok: true }
})
```

- [ ] **Step 4: 验证** — typecheck + vitest 全绿。

- [ ] **Step 5: Commit**
```bash
git add desktop/src/shared/gateway.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): gatewayBindWeixinStart + gatewaySetWeixinConfig(仅 workspace)"
```

---

### Task 3: imPlatforms 微信可用 + ImGatewayPanel 微信分支

**Files:**
- Modify: `desktop/src/renderer/lib/imPlatforms.ts`(weixin `soon` → `available`)
- Modify: `desktop/src/renderer/components/ImGatewayPanel.tsx`

**先读 ImGatewayPanel 全文**(QQ 绑定卡 + 飞书/企微表单是范式;`maskId` 已有)。

- [ ] **Step 1: imPlatforms.ts**:
```ts
  { id: 'weixin', name: '微信', icon: '💬', status: 'available', note: '扫码' },
```

- [ ] **Step 2: ImGatewayPanel 五处**:

(a) state(wc* 组后):
```ts
  // 微信表单输入(受控)
  const [wxWorkspace, setWxWorkspace] = useState('')
  const [wxBusy, setWxBusy] = useState(false)
  const [wxHint, setWxHint] = useState<string | null>(null)
```

(b) refreshConfig:weixin 回填分支(wecom 分支后)+ 错误提示分支 + anyBound 扩四平台:
```ts
      if (selectedPlatform === 'weixin') {
        setWxWorkspace(cfg.workspace ?? '')
      }
```
```ts
      else if (selectedPlatform === 'weixin') setWxHint('读取配置失败')
```
```ts
      const [qq, fs, wc, wx] = await Promise.all([
        window.wraith.gatewayGetConfig('qq'),
        window.wraith.gatewayGetConfig('feishu'),
        window.wraith.gatewayGetConfig('wecom'),
        window.wraith.gatewayGetConfig('weixin'),
      ])
      setAnyBound(!!qq?.bound || !!fs?.bound || !!wc?.bound || !!wx?.bound)
```

(c) 绑定中自动刷日志(现有 useEffect 区后加;终端二维码经日志 `<pre>` 呈现):
```ts
  // 微信扫码绑定期间每 2s 拉日志(终端二维码在日志区呈现)
  useEffect(() => {
    if (selectedPlatform !== 'weixin' || bind?.phase !== 'scanning') return
    setShowLogs(true)
    const t = setInterval(async () => {
      try { const { lines } = await window.wraith.gatewayLogs(); setLogs(lines) }
      catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(t)
  }, [selectedPlatform, bind?.phase])
```

(d) handlers(handleSaveWecom 后):
```ts
  const handleBindWeixin = () => {
    setBind({ phase: 'scanning' })
    void window.wraith.gatewayBindWeixinStart(wxWorkspace.trim() || undefined)
  }

  const handleSaveWeixinWorkspace = async () => {
    setWxBusy(true)
    setWxHint(null)
    try {
      await window.wraith.gatewaySetWeixinConfig({ workspace: wxWorkspace.trim() })
      setWxHint('已保存')
      await refreshConfig()
    } catch {
      setWxHint('保存失败')
    } finally {
      setWxBusy(false)
    }
  }
```

(e) 渲染:分隔条三元加 weixin(`: selectedPlatform === 'weixin' ? '微信 · 单聊(扫码)'`);wecom 表单块后加:
```tsx
        {selectedPlatform === 'weixin' && (
          <section className="rounded-lg border border-border p-4" data-testid="im-weixin-form">
            <div className="mb-1 text-xs font-bold text-fg">个人微信(官方 ClawBot / iLink)</div>
            <div className="text-2xs text-fg-subtle">
              手机微信扫码即绑定,扫码者即主人;⚠ 与终端 /wechat 通道不可同时运行。
            </div>
            {bound ? (
              <div className="mt-2 space-y-1 text-xs text-fg-muted">
                <div>主人:<span className="text-fg">{maskId(config?.ownerUserid ?? null)}</span></div>
                <div>工作目录:<span className="truncate text-fg">{config?.workspace ?? '—'}</span></div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-fg-subtle">
                未绑定——点「扫码绑定」,二维码会出现在下方日志区(自动展开);若有 http 链接会同时在浏览器打开。
              </div>
            )}
            <label className="mt-2 block text-xs text-fg-muted">
              工作目录{!bound && <span className="text-3xs text-fg-subtle">(未绑定时随扫码绑定一并设置)</span>}
              <input data-testid="im-wx-workspace" value={wxWorkspace} onChange={e => setWxWorkspace(e.target.value)}
                placeholder="/path/to/workspace" className={INPUT} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button data-testid="im-wx-bind" onClick={handleBindWeixin}
                className={bound ? BTN_SECONDARY : BTN_PRIMARY}>{bound ? '重新扫码绑定' : '扫码绑定'}</button>
              {bind?.phase === 'scanning' && (
                <button onClick={() => void window.wraith.gatewayBindCancel()} className={BTN_SECONDARY}>取消</button>
              )}
              <button data-testid="im-wx-save" disabled={wxBusy || !bound}
                onClick={() => void handleSaveWeixinWorkspace()} className={BTN_SECONDARY}>
                {wxBusy ? '保存中…' : '保存工作目录'}
              </button>
              {wxHint && <span className="text-xs text-fg-subtle">{wxHint}</span>}
            </div>
            {bind && selectedPlatform === 'weixin' && (
              <div data-testid="im-wx-bind-status"
                className={'mt-2 text-xs ' + (bind.phase === 'bound' ? 'text-success' : bind.phase === 'failed' ? 'text-danger' : 'text-fg-muted')}>
                {bindPhaseLabel(bind.phase, bind.message)}
              </div>
            )}
          </section>
        )}
```

- [ ] **Step 3: 验证** — typecheck 无错;vitest 全绿;`npm run build` 成功。

- [ ] **Step 4: Commit**
```bash
git add desktop/src/renderer/lib/imPlatforms.ts desktop/src/renderer/components/ImGatewayPanel.tsx
git commit -m "feat(desktop): 微信平台卡可选 + 扫码绑定流(日志区二维码)+ 工作目录表单"
```

---

## 收尾

- 全量:desktop typecheck + vitest + build;后端 `mvn -DskipTests=false -Dtest='Weixin*Test,AppServerGatewayConfigTest' test`。
- opus 整支终审(Phase C BASE..HEAD)。
- 眼验(最终一次性):重启桌面(preload 有改)→ 微信卡 → 扫码绑定(日志区二维码)→ 启动网关 → 对话/审批 y/a/n/cron 推送。

## Self-Review 记录

- Spec 覆盖:组件 8(桌面 UI)全落——绑定按钮/二维码呈现(日志区 + http 链接兜底)/主人与工作目录/anyBound。
- 已知限制(如实):二维码经等宽日志区呈现,行距可能影响扫码成功率——http 链接兜底 + 终端 CLI 兜底(bind-weixin 直接跑)双保险;bind 事件流不带平台标签(与 QQ 共用),v1 以「当前选中平台」上下文呈现,记 Minor。
- 复用:classifyBindLine 关键词与 WeixinBind 输出逐字核对过(绑定成功/绑定超时/已过期)。
