# 企业微信网关 Phase C 实现计划(桌面配置表单)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 执行。步骤用 `- [ ]`。
> **前置**:Phase A+B(feat/im-wecom-gateway,HEAD cc0fe1a)已完成——后端长连接/单聊/HITL/投递/config RPC 全就绪。本计划纯桌面侧(`desktop/`),照飞书 Phase C 的既有形态。

**Goal:** 桌面「IM 网关」屏支持企业微信:平台卡可选、配置表单(BotID / Secret 掩码 / 主人 userid / 工作目录)读写走 `gateway.config.get/set platform=wecom`,与 QQ/飞书表单同屏同构。

**Architecture:** 三层各加一薄片:shared 类型 + `wecomConfigPayload` 纯模块(空字段省略)→ preload/main IPC(`gatewaySetWecomConfig` → RPC `gateway.config.set{platform:wecom}`)→ `ImGatewayPanel` 企微表单分支(照飞书表单)。状态灯 `subscribed→running` 已在 Phase A 修好,无需再动。

**Tech Stack:** Electron(main/preload/renderer 三端),React,TypeScript,vitest。

## Global Constraints

- 密钥红线:`secret` 明文**绝不出现在任何发往 renderer 的结构里**;后端视图只回 `hasSecret`;表单 secret 输入保存后清空、已存时显示 `••••••(留空保持已存)` 占位(照 QQ/飞书两处现成掩码);**空 secret 不下发**(保持后端已存)。
- 后端 wecom 视图字段(Phase B 已定,逐字):`{bound, hasSecret, botId, ownerUserid, workspace}`——注意是 `botId`/`ownerUserid`,**不是** appId/ownerOpenid。
- set 载荷字段(逐字):`{platform:"wecom", botId?, secret?, ownerUserid?, workspace?}`。
- 「启动网关」按 `anyBound`(全局单进程):把 wecom 并入现有 QQ+飞书的汇总检查。
- 每任务:`npm run typecheck` 无错 + `npx vitest run` 全绿(在 `desktop/` 下跑);提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- **preload 改动不热更**:眼验前必须整体重启桌面 App(已知 quirk)。

---

### Task 1: shared 类型 + wecomConfigPayload 纯模块 + vitest

**Files:**
- Modify: `desktop/src/shared/gateway.ts`
- Create: `desktop/src/renderer/lib/wecomConfigPayload.ts`
- Test: `desktop/test/wecomConfigPayload.test.ts`

**Interfaces:**
- Produces:`GatewayConfigView` 增可选字段 `botId?: string | null`、`ownerUserid?: string | null`(企微专用;QQ/飞书视图无);`WecomConfigFields { botId?, secret?, ownerUserid?, workspace? }`;`wecomConfigPayload(inputs) -> WecomConfigFields`(trim 后非空才带上)。

- [ ] **Step 1: 写失败测试** `desktop/test/wecomConfigPayload.test.ts`(照 `feishuConfigPayload.test.ts` 风格):

```ts
import { describe, it, expect } from 'vitest'
import { wecomConfigPayload } from '../src/renderer/lib/wecomConfigPayload'

describe('wecomConfigPayload', () => {
  it('省略空白字段(空 secret 不下发,避免覆盖已存密钥)', () => {
    expect(wecomConfigPayload({ botId: ' bot1 ', secret: '', ownerUserid: '  ', workspace: '/w' }))
      .toEqual({ botId: 'bot1', workspace: '/w' })
  })
  it('全部非空则全带上(trim 后)', () => {
    expect(wecomConfigPayload({ botId: 'b', secret: 's', ownerUserid: 'u', workspace: '/w' }))
      .toEqual({ botId: 'b', secret: 's', ownerUserid: 'u', workspace: '/w' })
  })
  it('全空则空对象', () => {
    expect(wecomConfigPayload({ botId: '', secret: '', ownerUserid: '', workspace: '' })).toEqual({})
  })
})
```

- [ ] **Step 2: 跑确认失败** — `cd desktop && npx vitest run test/wecomConfigPayload.test.ts`(模块不存在,红)。

- [ ] **Step 3: 改 shared 类型**(`desktop/src/shared/gateway.ts`):
- `GatewayConfigView` 在 `region?` 行后加:
```ts
  botId?: string | null        // 企微专用;QQ/飞书视图无此字段
  ownerUserid?: string | null  // 企微专用
```
- 文件末尾(FeishuConfigFields 之后)加:
```ts
/** 企微配置写入字段(全可选;空字段调用方应省略以免覆盖已存值)。 */
export interface WecomConfigFields {
  botId?: string
  secret?: string
  ownerUserid?: string
  workspace?: string
}
```

- [ ] **Step 4: 写模块** `desktop/src/renderer/lib/wecomConfigPayload.ts`:

```ts
import type { WecomConfigFields } from '../../shared/gateway'

/**
 * 把企微表单输入映射为下发字段:trim 后非空的才带上。
 * 空白 = 不改动该字段(尤其空 secret 不下发,保留后端已存密钥)。
 */
export function wecomConfigPayload(inputs: {
  botId: string
  secret: string
  ownerUserid: string
  workspace: string
}): WecomConfigFields {
  const out: WecomConfigFields = {}
  const put = (k: keyof WecomConfigFields, v: string) => {
    const t = v.trim()
    if (t) out[k] = t
  }
  put('botId', inputs.botId)
  put('secret', inputs.secret)
  put('ownerUserid', inputs.ownerUserid)
  put('workspace', inputs.workspace)
  return out
}
```

- [ ] **Step 5: 跑确认通过** — `npx vitest run test/wecomConfigPayload.test.ts`(3/3)+ `npm run typecheck` 无错。

- [ ] **Step 6: Commit**
```bash
git add desktop/src/shared/gateway.ts desktop/src/renderer/lib/wecomConfigPayload.ts desktop/test/wecomConfigPayload.test.ts
git commit -m "feat(desktop): 企微共享类型 + wecomConfigPayload 纯模块(空字段省略)+ vitest"
```

---

### Task 2: preload + main IPC(gatewaySetWecomConfig)

**Files:**
- Modify: `desktop/src/preload/index.ts`(接口声明 + 实现,照 gatewaySetFeishuConfig 两处)
- Modify: `desktop/src/main/index.ts`(IPC handler,照 wraith:gatewaySetFeishuConfig)

**Interfaces:**
- Consumes:Task 1 的 `WecomConfigFields`;AppServer RPC `gateway.config.set{platform:'wecom',...}`(Phase B 已就绪)。
- Produces:`window.wraith.gatewaySetWecomConfig(fields: WecomConfigFields): Promise<{ok:boolean}>`。

- [ ] **Step 1: preload 声明**(`desktop/src/preload/index.ts`,`gatewaySetFeishuConfig` 声明行之后):
```ts
  gatewaySetWecomConfig(fields: WecomConfigFields): Promise<{ ok: boolean }>
```
(同文件顶部 import type 处把 `WecomConfigFields` 并入既有 `FeishuConfigFields` 的 import。)

- [ ] **Step 2: preload 实现**(`gatewaySetFeishuConfig` 实现之后):
```ts
  gatewaySetWecomConfig(fields: WecomConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetWecomConfig', fields) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: main handler**(`desktop/src/main/index.ts`,`wraith:gatewaySetFeishuConfig` handler 之后):
```ts
ipcMain.handle('wraith:gatewaySetWecomConfig', async (_e, fields: Record<string, string | undefined>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'wecom', ...fields })
  return { ok: true }
})
```

- [ ] **Step 4: 验证** — `npm run typecheck` 无错 + `npx vitest run` 全绿(无回归)。

- [ ] **Step 5: Commit**
```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): window.wraith.gatewaySetWecomConfig → gateway.config.set(platform=wecom)"
```

---

### Task 3: imPlatforms 企微可用 + ImGatewayPanel 企微表单

**Files:**
- Modify: `desktop/src/renderer/lib/imPlatforms.ts`(wecom `soon` → `available`)
- Modify: `desktop/src/renderer/components/ImGatewayPanel.tsx`(企微表单分支 + anyBound 并入 wecom)

**先读 `ImGatewayPanel.tsx` 全文**(飞书表单在 `selectedPlatform === 'feishu'` 分支,是逐字范式)。

- [ ] **Step 1: imPlatforms.ts** — 把
```ts
  { id: 'wecom', name: '企业微信', icon: '🏢', status: 'soon' },
```
改为
```ts
  { id: 'wecom', name: '企业微信', icon: '🏢', status: 'available', note: '机器人' },
```

- [ ] **Step 2: ImGatewayPanel.tsx — state + 刷新 + 保存**(照飞书那组):

(a) import 处把 `wecomConfigPayload` 加进来:
```ts
import { wecomConfigPayload } from '../lib/wecomConfigPayload'
```

(b) 飞书表单 state 组(`fsHint` 那行)之后加:
```ts
  // 企微表单输入(受控)
  const [wcBotId, setWcBotId] = useState('')
  const [wcSecret, setWcSecret] = useState('')
  const [wcOwner, setWcOwner] = useState('')
  const [wcWorkspace, setWcWorkspace] = useState('')
  const [wcBusy, setWcBusy] = useState(false)
  const [wcHint, setWcHint] = useState<string | null>(null)
```

(c) `refreshConfig` 里,飞书回填块(`if (selectedPlatform === 'feishu') {...}`)之后加:
```ts
      if (selectedPlatform === 'wecom') {
        setWcBotId(cfg.botId ?? '')
        setWcOwner(cfg.ownerUserid ?? '')
        setWcWorkspace(cfg.workspace ?? '')
        // secret 永不回填(后端只回 hasSecret);留空 = 保持已存密钥
      }
```
同函数里错误分支的提示,把 `if (selectedPlatform === 'feishu') setFsHint('读取配置失败')` 一行扩为:
```ts
      if (selectedPlatform === 'feishu') setFsHint('读取配置失败')
      else if (selectedPlatform === 'wecom') setWcHint('读取配置失败')
      else setHint('读取配置失败')
```
`anyBound` 的 Promise.all 从 `[qq, fs]` 扩为三平台:
```ts
      const [qq, fs, wc] = await Promise.all([
        window.wraith.gatewayGetConfig('qq'),
        window.wraith.gatewayGetConfig('feishu'),
        window.wraith.gatewayGetConfig('wecom'),
      ])
      setAnyBound(!!qq?.bound || !!fs?.bound || !!wc?.bound)
```

(d) `handleSaveFeishu` 之后加:
```ts
  const handleSaveWecom = async () => {
    setWcBusy(true)
    setWcHint(null)
    try {
      const payload = wecomConfigPayload({
        botId: wcBotId, secret: wcSecret, ownerUserid: wcOwner, workspace: wcWorkspace,
      })
      await window.wraith.gatewaySetWecomConfig(payload)
      setWcSecret('')                 // 保存后清空密钥输入(不回显)
      setWcHint('已保存')
      await refreshConfig()
    } catch (err) {
      setWcHint('保存失败')
    } finally {
      setWcBusy(false)
    }
  }
```

- [ ] **Step 3: ImGatewayPanel.tsx — 渲染分支**:

(a) 平台分隔条 label 三元扩为:
```ts
          {selectedPlatform === 'feishu' ? '飞书 / Lark · 机器人'
            : selectedPlatform === 'wecom' ? '企业微信 · 机器人'
            : 'QQ · 单聊'}
```

(b) 飞书表单 `{selectedPlatform === 'feishu' && (...)}` 块之后,加企微表单块(逐字照飞书表单结构,字段换企微):
```tsx
        {selectedPlatform === 'wecom' && (
          <section className="rounded-lg border border-border p-4" data-testid="im-wecom-form">
            <div className="mb-1 text-xs font-bold text-fg">企业微信智能机器人</div>
            <div className="text-2xs text-fg-subtle">
              在 企业微信管理后台 建智能机器人,API 接收模式选「长连接」,把 BotID / Secret 填这里(与回调模式的 Token/AESKey 不同)。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              BotID
              <input data-testid="im-wc-botid" value={wcBotId} onChange={e => setWcBotId(e.target.value)}
                placeholder="机器人 BotID" className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              Secret {config?.hasSecret && <span className="text-3xs text-success">(已存,留空则保持)</span>}
              <input data-testid="im-wc-secret" type="password" value={wcSecret} onChange={e => setWcSecret(e.target.value)}
                placeholder={config?.hasSecret ? '••••••(留空保持已存)' : '粘贴长连接 Secret'} className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              主人 userid
              <input data-testid="im-wc-owner" value={wcOwner} onChange={e => setWcOwner(e.target.value)}
                placeholder="留空:先私聊 bot 拿回显" className={INPUT} />
            </label>
            <div className="mt-1 text-3xs text-fg-subtle">
              未填主人时,启动网关后私聊 bot,它会回显你的 userid;填进来再重启即绑定。主动推送(审批卡/定时投递)需要你先给 bot 发过消息。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              工作目录
              <input data-testid="im-wc-workspace" value={wcWorkspace} onChange={e => setWcWorkspace(e.target.value)}
                placeholder="/path/to/workspace" className={INPUT} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button data-testid="im-wc-save" disabled={wcBusy} onClick={() => void handleSaveWecom()} className={BTN_PRIMARY}>
                {wcBusy ? '保存中…' : '保存企微配置'}
              </button>
              {wcHint && <span className="text-xs text-fg-subtle">{wcHint}</span>}
            </div>
          </section>
        )}
```

- [ ] **Step 4: 验证** — `npm run typecheck` 无错;`npx vitest run` 全绿;`npm run build` 成功。

- [ ] **Step 5: Commit**
```bash
git add desktop/src/renderer/lib/imPlatforms.ts desktop/src/renderer/components/ImGatewayPanel.tsx
git commit -m "feat(desktop): 企业微信平台卡可选 + 配置表单(BotID/Secret 掩码/主人 userid/工作目录)"
```

---

## 真机眼验(Phase C 收尾;preload 有改 → 必须整体重启桌面 App)

1. 重启桌面 App → IM 网关屏 → 「企业微信」卡可点、显「可配置」。
2. 填 BotID/Secret/工作目录 → 保存 → 提示「已保存」;重进屏,BotID/工作目录回填、Secret 显示 `••••••(已存)`。
3. 「启动网关」可点(anyBound 含 wecom)→ 状态灯转「运行中」(subscribed)。
4. 私聊 bot 拿 userid 回显 → 表单填主人 userid → 保存 → 重启网关 → 对话 + 审批卡 + cron 投递(Phase A/B 眼验项)。

## Self-Review 记录

- Spec 覆盖:组件 9(桌面 UI)全落;状态灯已在 Phase A 完成,不重复。
- 无占位:各步含完整代码;视图字段名(botId/ownerUserid)与 Phase B AppServer 逐字核对过。
- 类型一致:`WecomConfigFields` 贯穿 payload→preload→main;`GatewayConfigView.botId/ownerUserid` 可选不破 QQ/飞书。
- 红线:secret 全链只下行 `hasSecret`;表单不回显;空 secret 不下发(Task 1 测试锁定)。
