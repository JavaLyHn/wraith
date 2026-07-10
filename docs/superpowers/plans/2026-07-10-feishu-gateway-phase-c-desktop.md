# 飞书网关 Phase C:桌面 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面 IM 网关面板支持配置飞书:平台卡片可点切换,飞书表单(appId/appSecret/region/ownerOpenid/workspace)手填保存,状态灯对飞书正常点亮。QQ 面板行为不变。

**Architecture:** `imPlatforms` 把飞书翻 `available`;`ImGatewayPanel` 加 `selectedPlatform` 态,平台卡可点,按平台条件渲染配置段;preload/main 给 `gatewayGetConfig` 加 `platform` 参、新增 `gatewaySetFeishuConfig`(不碰 QQ 写入路径);daemon 启动平台无关(复用现有按钮);状态灯:桌面 `classifyGatewayStatusLine` 扩认飞书 token + FeishuProvider 连接循环发一次 `running`。

**Tech Stack:** Electron(TS/React)+ vitest;后端 Java(仅 1 行 FeishuProvider 状态输出改动)。

## Global Constraints

- **QQ 行为零回归**:QQ 面板/绑定/密钥/workspace 写入路径与状态灯不变;`gatewaySetSecret`/`gatewaySetWorkspace`/QQ 的 `gateway.config.set{clientSecret|workspace}` 不改。
- **密钥红线**:`appSecret` 用 `type="password"` 输入,只经新 `gatewaySetFeishuConfig` → `gateway.config.set{platform:'feishu',...}` 写入;renderer 从不显示明文(读取只拿 `hasSecret`);编辑时**空 appSecret 不下发**(不覆盖已存密钥)。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer|app.?secret"`(只应命中字段名/自指/测试金丝雀)。
- **向后兼容**:`gatewayGetConfig(platform?)` 的 platform 可选;QQ 现有调用不传 → 后端默认 qq。
- **飞书无扫码绑定**:飞书配置全手填,无 bind/scan;daemon 启动复用现有 `gatewayStart()`(一个 `wraith gateway` 进程服务所有 provider)。
- **状态灯 token**:FeishuProvider 连接循环发 `WRAITH_GATEWAY_STATUS running`,致命失败发 `error`;桌面 `classifyGatewayStatusLine` 认这两个 token(并保留 QQ 的 connecting/connected/disconnected/auth-failed)。
- **commit trailer**:每次提交带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- **前端验证**:纯逻辑走 vitest;组件/preload/main 接线走 `npm run typecheck` + `npx vitest run` + `npm run build` + 眼验(无 RTL,沿用本仓库既有桌面测试约定)。工作目录 `desktop/`。

---

### Task 1: imPlatforms 翻 available + 测试

**Files:**
- Modify: `desktop/src/renderer/lib/imPlatforms.ts:25`(feishu 条目)
- Test: `desktop/test/imPlatforms.test.ts`(改「非 QQ 全 soon」那条)

**Interfaces:**
- Consumes/Produces:`IM_PLATFORMS`(现有);feishu 条目变为 `{ id: 'feishu', name: '飞书 / Lark', icon: '🛰️', status: 'available', note: '机器人' }`。

- [ ] **Step 1: 改失败测试**

现有 `imPlatforms.test.ts` 有一条断言「QQ 之外全部 soon」——飞书翻 available 后它必然失败。把该条改为按 status 泛化断言(不写死哪些 available),并新增飞书 available 断言。将该测试替换为:

```typescript
  it('非 available 的平台一律为 soon 占位', () => {
    IM_PLATFORMS.filter(p => p.status !== 'available').forEach(p => {
      expect(p.status).toBe('soon')
    })
  })

  it('飞书已可用', () => {
    const fs = IM_PLATFORMS.find(p => p.id === 'feishu')
    expect(fs).toBeDefined()
    expect(fs?.status).toBe('available')
  })
```

(保留文件里其余测试,如 QQ available、hermes 清单含 '飞书 / Lark' 等,不动。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run imPlatforms`
Expected: 「飞书已可用」失败(feishu 仍 soon)。

- [ ] **Step 3: 改 `imPlatforms.ts`**

第 25 行 feishu 条目改为:

```typescript
  { id: 'feishu', name: '飞书 / Lark', icon: '🛰️', status: 'available', note: '机器人' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run imPlatforms`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/imPlatforms.ts desktop/test/imPlatforms.test.ts
git commit -m "feat(desktop): imPlatforms 飞书翻 available

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: IPC 层 —— gatewayGetConfig(platform) + gatewaySetFeishuConfig

**Files:**
- Modify: `desktop/src/shared/gateway.ts`(`GatewayConfigView` 加 `region?`)
- Modify: `desktop/src/preload/index.ts`(`gatewayGetConfig` 加 platform 参 + 新增 `gatewaySetFeishuConfig`)
- Modify: `desktop/src/main/index.ts`(对应 ipcMain handler)

**Interfaces:**
- Produces:
  - `GatewayConfigView` += `region?: string | null`
  - preload `WraithApi.gatewayGetConfig(platform?: string): Promise<GatewayConfigView>`
  - preload `WraithApi.gatewaySetFeishuConfig(fields: FeishuConfigFields): Promise<{ ok: boolean }>`,其中 `FeishuConfigFields = { appId?: string; appSecret?: string; ownerOpenid?: string; region?: string; workspace?: string }`(定义在 `shared/gateway.ts` 并导出)

- [ ] **Step 1: 改 `shared/gateway.ts`**

`GatewayConfigView` 加可选 `region`(飞书用;QQ 的 get 不返回该字段 → undefined),并导出飞书写入字段类型:

```typescript
/** 给 renderer 的安全配置视图 —— 只报 hasSecret,绝不含明文。 */
export interface GatewayConfigView {
  bound: boolean
  hasSecret: boolean
  appId: string | null
  ownerOpenid: string | null
  workspace: string | null
  region?: string | null   // 飞书专用;QQ 视图无此字段
}

/** 飞书配置写入字段(全可选;空字段调用方应省略以免覆盖已存值)。 */
export interface FeishuConfigFields {
  appId?: string
  appSecret?: string
  ownerOpenid?: string
  region?: string
  workspace?: string
}
```

- [ ] **Step 2: 改 `preload/index.ts`**

`WraithApi` 接口里 `gatewayGetConfig` 签名改为带可选 platform,并在其附近新增 `gatewaySetFeishuConfig`(import 补 `FeishuConfigFields`):

接口(约 79 行区域):
```typescript
  gatewayGetConfig(platform?: string): Promise<GatewayConfigView>
  gatewaySetFeishuConfig(fields: FeishuConfigFields): Promise<{ ok: boolean }>
```
（文件顶部 import 改为 `import type { FeishuConfigFields, GatewayConfigView, GatewayEvent, GatewayStatus } from '../shared/gateway'`。）

实现(约 353 行区域)替换 `gatewayGetConfig` 并在其后加新方法:
```typescript
  gatewayGetConfig(platform?: string) {
    return ipcRenderer.invoke('wraith:gatewayGetConfig', platform) as Promise<GatewayConfigView>
  },
  gatewaySetFeishuConfig(fields: FeishuConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetFeishuConfig', fields) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: 改 `main/index.ts`**

`wraith:gatewayGetConfig` handler(约 674 行)改为透传 platform;并在其后新增 `wraith:gatewaySetFeishuConfig`:

```typescript
ipcMain.handle('wraith:gatewayGetConfig', async (_e, platform?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('gateway.config.get', platform ? { platform } : {})
})
ipcMain.handle('wraith:gatewaySetFeishuConfig', async (_e, fields: Record<string, string>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'feishu', ...fields })
  return { ok: true }
})
```

（`wraith:gatewaySetSecret` / `wraith:gatewaySetWorkspace` 保持不变。）

- [ ] **Step 4: 类型 + 构建**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: 通过,无类型错误。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/gateway.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): gatewayGetConfig(platform) + gatewaySetFeishuConfig(飞书配置写入,不碰 QQ 路径)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: ImGatewayPanel 飞书 UI

**Files:**
- Create: `desktop/src/renderer/lib/feishuConfigPayload.ts`(纯 helper:表单输入 → 下发字段,空字段省略)
- Test: `desktop/test/feishuConfigPayload.test.ts`
- Modify: `desktop/src/renderer/components/ImGatewayPanel.tsx`

**Interfaces:**
- Consumes:`window.wraith.gatewayGetConfig(platform)` / `gatewaySetFeishuConfig(fields)`(Task 2);`IM_PLATFORMS`(Task 1);`FeishuConfigFields`(Task 2)。
- Produces:`feishuConfigPayload(inputs: {appId:string; appSecret:string; ownerOpenid:string; region:string; workspace:string}): FeishuConfigFields` —— 省略空白字段(空白 = 不改;尤其空 appSecret 不下发以免覆盖已存密钥)。

- [ ] **Step 1: 写失败测试(纯 helper)**

`desktop/test/feishuConfigPayload.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { feishuConfigPayload } from '../src/renderer/lib/feishuConfigPayload'

describe('feishuConfigPayload', () => {
  it('省略空白字段(空 appSecret 不下发,避免覆盖已存密钥)', () => {
    const p = feishuConfigPayload({ appId: 'cli_x', appSecret: '', ownerOpenid: '', region: 'feishu', workspace: '' })
    expect(p).toEqual({ appId: 'cli_x', region: 'feishu' })
    expect('appSecret' in p).toBe(false)
    expect('ownerOpenid' in p).toBe(false)
    expect('workspace' in p).toBe(false)
  })

  it('全填则全带', () => {
    const p = feishuConfigPayload({ appId: 'cli_x', appSecret: 'sec', ownerOpenid: 'ou_o', region: 'lark', workspace: '/w' })
    expect(p).toEqual({ appId: 'cli_x', appSecret: 'sec', ownerOpenid: 'ou_o', region: 'lark', workspace: '/w' })
  })

  it('trim 后为空视为空', () => {
    const p = feishuConfigPayload({ appId: '  ', appSecret: '  ', ownerOpenid: 'ou_o', region: 'feishu', workspace: '' })
    expect(p).toEqual({ ownerOpenid: 'ou_o', region: 'feishu' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run feishuConfigPayload`
Expected: 失败 —— 模块不存在。

- [ ] **Step 3: 建 `feishuConfigPayload.ts`**

```typescript
import type { FeishuConfigFields } from '../../shared/gateway'

/**
 * 把飞书表单输入映射为下发字段:trim 后非空的才带上。
 * 空白 = 不改动该字段(尤其空 appSecret 不下发,保留后端已存密钥;region 恒有下拉值)。
 */
export function feishuConfigPayload(inputs: {
  appId: string
  appSecret: string
  ownerOpenid: string
  region: string
  workspace: string
}): FeishuConfigFields {
  const out: FeishuConfigFields = {}
  const put = (k: keyof FeishuConfigFields, v: string) => {
    const t = v.trim()
    if (t) out[k] = t
  }
  put('appId', inputs.appId)
  put('appSecret', inputs.appSecret)
  put('ownerOpenid', inputs.ownerOpenid)
  put('region', inputs.region)
  put('workspace', inputs.workspace)
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run feishuConfigPayload`
Expected: PASS(3 tests)。

- [ ] **Step 5: 改 `ImGatewayPanel.tsx`**

改动点(在现有结构上增量,保留 QQ 全部现有 JSX):

(a) 顶部 import 加:
```typescript
import { feishuConfigPayload } from '../lib/feishuConfigPayload'
```

(b) state 区新增(在现有 hooks 之后):
```typescript
const [selectedPlatform, setSelectedPlatform] = useState<string>('qq')
// 飞书表单输入(受控)
const [fsAppId, setFsAppId] = useState('')
const [fsAppSecret, setFsAppSecret] = useState('')
const [fsOwner, setFsOwner] = useState('')
const [fsRegion, setFsRegion] = useState('feishu')
const [fsWorkspace, setFsWorkspace] = useState('')
const [fsBusy, setFsBusy] = useState(false)
const [fsHint, setFsHint] = useState<string | null>(null)
```

(c) `refreshConfig` 传入 selectedPlatform,并回填飞书表单的非密字段;把 selectedPlatform 加进 deps;新增一个「切换平台即重载」的 effect:
```typescript
const refreshConfig = useCallback(async () => {
  try {
    const cfg = await window.wraith.gatewayGetConfig(selectedPlatform)
    setConfig(cfg)
    if (selectedPlatform === 'feishu') {
      setFsAppId(cfg.appId ?? '')
      setFsOwner(cfg.ownerOpenid ?? '')
      setFsRegion(cfg.region ?? 'feishu')
      setFsWorkspace(cfg.workspace ?? '')
      // appSecret 永不回填(后端只回 hasSecret);留空 = 保持已存密钥
    }
  } catch (err) {
    setHint('读取配置失败')
  }
}, [selectedPlatform])
```
（原本 mount 时 `void refreshConfig()` 的 useEffect 依赖数组补上 `refreshConfig`,使切换平台时自动重载;若原 effect 依赖为空数组 `[]`,改为 `[refreshConfig]`。）

(d) 平台网格:available 卡片可点切换、加选中高亮与指针样式。把 `IM_PLATFORMS.map` 的卡片 `<div>` 改为:
```tsx
{IM_PLATFORMS.map(p => {
  const isAvailable = p.status === 'available'
  const isSelected = isAvailable && selectedPlatform === p.id
  const statusText = isAvailable ? (isSelected && bound ? '✓ 已配置' : '可配置') : '即将支持'
  return (
    <div
      key={p.id}
      data-testid={`im-platform-${p.id}`}
      onClick={isAvailable ? () => setSelectedPlatform(p.id) : undefined}
      title={isAvailable ? `${p.name}${p.note ? ' · ' + p.note : ''}` : `${p.name} — 即将支持`}
      className={
        'flex flex-col items-center gap-1 rounded-lg border p-3 text-center ' +
        (isAvailable
          ? (isSelected ? 'cursor-pointer border-accent bg-surface' : 'cursor-pointer border-accent bg-surface/60')
          : 'cursor-not-allowed border-border opacity-50')
      }
    >
      <span className="text-xl leading-none">{p.icon}</span>
      <span className="max-w-full truncate text-2xs text-fg">{p.name}</span>
      <span className={'text-3xs ' + (isSelected && bound ? 'text-success' : 'text-fg-subtle')}>{statusText}</span>
    </div>
  )
})}
```
（注:`bound` 现反映「当前选中平台」的配置。原来「未配置/已配置」文案对未选中的 available 卡不再显 bound 态,改为「可配置」,避免用别的平台 bound 误标。)

(e) 分隔行动态化。把硬编码的 `QQ · 单聊` 段改为:
```tsx
<div className="flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle">
  <span className="h-px flex-1 bg-border" />
  {selectedPlatform === 'feishu' ? '飞书 / Lark · 机器人' : 'QQ · 单聊'}
  <span className="h-px flex-1 bg-border" />
</div>
```

(f) QQ 配置段(绑定 section + 密钥手填 section)整体包在 `{selectedPlatform === 'qq' && ( ... )}` 里(daemon 守护进程 section 保持共享,不包)。

(g) 在 QQ 段之后、daemon section 之前,新增飞书配置段:
```tsx
{selectedPlatform === 'feishu' && (
  <section className="rounded-lg border border-border p-4" data-testid="im-feishu-form">
    <div className="mb-1 text-xs font-bold text-fg">飞书自建应用</div>
    <div className="text-2xs text-fg-subtle">
      在 飞书开放平台 建自建应用(开长连接 + im:message 权限 + 订阅 im.message.receive_v1),把 App ID / App Secret 填这里。
    </div>
    <label className="mt-2 block text-xs text-fg-muted">
      App ID
      <input data-testid="im-fs-appid" value={fsAppId} onChange={e => setFsAppId(e.target.value)}
        placeholder="cli_xxx" className={INPUT} />
    </label>
    <label className="mt-2 block text-xs text-fg-muted">
      App Secret {config?.hasSecret && <span className="text-3xs text-success">(已存,留空则保持)</span>}
      <input data-testid="im-fs-secret" type="password" value={fsAppSecret} onChange={e => setFsAppSecret(e.target.value)}
        placeholder={config?.hasSecret ? '••••••(留空保持已存)' : '粘贴 App Secret'} className={INPUT} />
    </label>
    <label className="mt-2 block text-xs text-fg-muted">
      区域
      <select data-testid="im-fs-region" value={fsRegion} onChange={e => setFsRegion(e.target.value)} className={INPUT}>
        <option value="feishu">飞书(open.feishu.cn)</option>
        <option value="lark">Lark 国际(open.larksuite.com)</option>
      </select>
    </label>
    <label className="mt-2 block text-xs text-fg-muted">
      主人 open_id
      <input data-testid="im-fs-owner" value={fsOwner} onChange={e => setFsOwner(e.target.value)}
        placeholder="ou_xxx(留空:先私聊 bot 拿回显)" className={INPUT} />
    </label>
    <div className="mt-1 text-3xs text-fg-subtle">
      未填主人时,启动网关后私聊 bot,它会回显你的 open_id;填进来再重启即绑定。
    </div>
    <label className="mt-2 block text-xs text-fg-muted">
      工作目录
      <input data-testid="im-fs-workspace" value={fsWorkspace} onChange={e => setFsWorkspace(e.target.value)}
        placeholder="/path/to/workspace" className={INPUT} />
    </label>
    <div className="mt-2 flex items-center gap-2">
      <button data-testid="im-fs-save" disabled={fsBusy} onClick={() => void handleSaveFeishu()} className={BTN_PRIMARY}>
        {fsBusy ? '保存中…' : '保存飞书配置'}
      </button>
      {fsHint && <span className="text-xs text-fg-subtle">{fsHint}</span>}
    </div>
  </section>
)}
```

(h) 保存处理器(放在其它 handler 旁):
```typescript
const handleSaveFeishu = async () => {
  setFsBusy(true)
  setFsHint(null)
  try {
    const payload = feishuConfigPayload({
      appId: fsAppId, appSecret: fsAppSecret, ownerOpenid: fsOwner, region: fsRegion, workspace: fsWorkspace,
    })
    await window.wraith.gatewaySetFeishuConfig(payload)
    setFsAppSecret('')              // 保存后清空密钥输入(不回显)
    setFsHint('已保存')
    await refreshConfig()
  } catch (err) {
    setFsHint('保存失败')
  } finally {
    setFsBusy(false)
  }
}
```

- [ ] **Step 6: 类型 + vitest 全量 + 构建**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: 类型通过;vitest 全绿(含新 feishuConfigPayload + imPlatforms);build 成功。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/lib/feishuConfigPayload.ts desktop/test/feishuConfigPayload.test.ts desktop/src/renderer/components/ImGatewayPanel.tsx
git commit -m "feat(desktop): ImGatewayPanel 平台可切换 + 飞书配置表单(feishuConfigPayload 纯 helper)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: 状态灯集成(桌面 classifier + FeishuProvider running 输出)

**Files:**
- Modify: `desktop/src/main/gatewayManager.ts`(`classifyGatewayStatusLine` 扩认飞书 token)
- Test: `desktop/test/gatewayManager.test.ts`(加飞书 token 用例)
- Modify: `src/main/java/com/lyhn/wraith/gateway/feishu/FeishuProvider.java`(连接循环发一次 `running`)

**Interfaces:**
- Consumes:现有 `classifyGatewayStatusLine(line): GatewayStatus | null`(匹配 `WRAITH_GATEWAY_STATUS <token>`)。
- Produces:`classifyGatewayStatusLine` 追加认 `running`→`{state:'running'}`、`error`→`{state:'error'}`、`starting`→`{state:'starting'}`(保留现有 QQ token 分支不变)。

- [ ] **Step 1: 写失败测试**

在 `desktop/test/gatewayManager.test.ts` 追加(沿用文件现有 import 与 `classifyGatewayStatusLine` 调用风格):

```typescript
  it('认飞书 running token → running', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS running')?.state).toBe('running')
  })
  it('认飞书 error token → error', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS error')?.state).toBe('error')
  })
  it('认飞书 starting token → starting', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS starting')?.state).toBe('starting')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run gatewayManager`
Expected: 三条新用例失败(classifier 未认 running/error/starting)。

- [ ] **Step 3: 改 `gatewayManager.ts`**

在 `classifyGatewayStatusLine` 里,现有 QQ token 分支(connecting/connected/disconnected/auth-failed)之外,补认飞书 token。读取该函数当前实现后,在其 token→state 映射中增加:
- `'starting'` → `{ state: 'starting', message: '连接中…' }`
- `'running'` → `{ state: 'running' }`
- `'error'` → `{ state: 'error', message: '连接失败' }`

保留所有现有 QQ token 分支与其消息不变;不改函数签名与匹配前缀(`WRAITH_GATEWAY_STATUS `)。

- [ ] **Step 4: 跑测试确认通过 + 全量 vitest**

Run: `cd desktop && npx vitest run gatewayManager && npx vitest run`
Expected: 新 3 用例 PASS;全量 vitest 绿(现有 QQ 状态用例不回归)。

- [ ] **Step 5: 改 `FeishuProvider.java` —— 连接循环发 running**

`FeishuProvider` 的 `wsLoop`(生产构造里)当前为:
```java
this.wsLoop = () -> {
    System.out.println("WRAITH_GATEWAY_STATUS starting");
    try {
        ws.start();
    } catch (Throwable t) {
        System.out.println("WRAITH_GATEWAY_STATUS error");
        System.err.println("[gateway] 飞书长连接退出: " + t.getClass().getSimpleName());
    }
};
```
在 `ws.start()` 之前(`"starting"` 之后)补发一次 `running`(乐观:provider 连接循环已起、SDK 内部自动重连;致命失败由 catch 的 `error` 覆盖)。改为:
```java
this.wsLoop = () -> {
    System.out.println("WRAITH_GATEWAY_STATUS starting");
    System.out.println("WRAITH_GATEWAY_STATUS running");
    try {
        ws.start();
    } catch (Throwable t) {
        System.out.println("WRAITH_GATEWAY_STATUS error");
        System.err.println("[gateway] 飞书长连接退出: " + t.getClass().getSimpleName());
    }
};
```
不改 `wsLoop` 之外任何内容;测试构造的 stub wsLoop 不受影响。

- [ ] **Step 6: Java 构建 + 飞书回归**

Run: `mvn -q -DskipTests=false -Dtest='FeishuProviderTest,Feishu*Test' test`
Expected: 全 PASS(FeishuProviderTest 用 stub wsLoop,不受 running 行改动影响)。
Run: `mvn -q -DskipTests=false test`
Expected: 全量 0 新增失败。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/main/gatewayManager.ts desktop/test/gatewayManager.test.ts src/main/java/com/lyhn/wraith/gateway/feishu/FeishuProvider.java
git commit -m "feat(gateway): 飞书状态灯 —— 桌面 classifier 认 running/error/starting + FeishuProvider 连接循环发 running

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 自审(写完计划回看 spec)

**1. Spec 覆盖**:覆盖 spec 的 Part 4(桌面 UI:imPlatforms 翻 available、ImGatewayPanel 按平台条件渲染、gatewayManager 状态灯、shared/gateway 类型)。绑定=手填(Task 3 表单 + Task 2 RPC),owner 配对回显=表单提示 + 后端 Task-B 已实现。

**2. 占位扫描**:无 TBD/TODO。Task 3(e)(f) 与 Task 4 Step 3 是「在现有代码上增量」——给了明确的替换/插入内容与定位;非占位(改动点、样式、testid、handler 全给全)。唯一需实现者对着现有代码微调的是:①原 mount useEffect 的依赖数组(视现状 `[]` 改 `[refreshConfig]`);②`classifyGatewayStatusLine` 的 token 分支插入(保留现有 QQ 分支)。均已写明意图 + 精确新增内容。

**3. 类型一致性**:`FeishuConfigFields`(Task 2 shared)被 preload、feishuConfigPayload(Task 3)、handleSaveFeishu 一致消费;`gatewayGetConfig(platform?)` 签名 Task 2 定义、Task 3 调用一致;`GatewayConfigView.region?` Task 2 加、Task 3 读一致;状态 token(running/error/starting)Task 4 两侧(Java 发 / TS 认)一致。

**4. 已知点(诚实标注)**:
- 组件/preload/main 接线无 RTL 单测,靠 typecheck + build + 眼验(沿用本仓库桌面既有约定);纯逻辑(feishuConfigPayload、imPlatforms、classifyGatewayStatusLine)有 vitest。
- daemon 「启动网关」按钮的 `disabled={!bound}` 中 `bound` 现反映**当前选中平台**:若 QQ 已配、飞书未配而正查看飞书,按钮会禁用——需切回 QQ 卡再启动。v1 可接受的小 UX 取舍(daemon 一个进程服务所有已配 provider)。
- 飞书状态灯 `running` 为乐观信号(provider 连接循环已起 + SDK 自动重连),非 TCP 层确认;凭据错误时 `ws.start()` 抛出 → `error` 覆盖。真机眼验确认灯正常转绿/报错。

**眼验脚本(Phase C 完工,整体验)**:重建 jar + 重启桌面 → MCP 面板旁 IM 网关面板 → 点飞书卡切到飞书表单 → 填 appId/appSecret/region(ownerOpenid 先空)→ 保存 → 「已保存」→ 启动网关(状态灯转绿 running)→ 手机私聊 bot → 收到 open_id 回显 → 填 ownerOpenid 保存 + 重启网关 → 对话收到回复 → 触发 HITL 看审批卡三按钮 → 点批准 turn 继续 → 切回 QQ 卡确认 QQ 表单/绑定/状态灯行为一如既往 → `ps` 查无残留。真机验证归用户。
