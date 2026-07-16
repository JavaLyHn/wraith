# 磨砂透明侧栏 + 聊天纯白/面板灰卡 + 质感 设计稿

日期:2026-07-16
状态:设计已与用户确认(方向 A:聊天白/面板保留灰+卡 + 侧栏真磨砂 vibrancy + 质感),待用户审阅
背景:用户嫌当前(截图 #16)整个右侧偏灰、不够精致,想要 Codex 那种(截图 #17)"左侧透明、右侧纯白"的质感。澄清后定:侧栏走 **macOS 真磨砂(vibrancy)**,聊天内容区纯白,工具面板保持"灰底+软白卡"(不破坏已上线的软卡片语言)。

## 目标

给桌面 app 一套"磨砂 chrome + 纯白内容岛"的质感:标题栏顶条 + 侧栏在 macOS 上半透明磨砂(透出桌面模糊),聊天内容区纯白浮起,工具面板维持灰底+软白卡。纯视觉,零行为/数据/testid 变更。非 macOS 自动退回平面两色(灰侧栏 + 白/灰内容),不依赖磨砂。

## 确认的决策(用户)

- **方向 A**:聊天视图内容区**纯白**;工具面板(MCP/自动化/设置…)**保持 `--bg` 灰底 + 软白卡**(否决"全右纯白+卡改描边",避免与软卡片"无边框白卡"回摆)。
- **侧栏真磨砂**:接受 macOS vibrancy 磨砂会**透出桌面壁纸的模糊**(而非平面浅灰)。这是"透明 + 质感"的实现。
- **整体质感**:磨砂 chrome(顶条+侧栏)+ 白内容岛 + 克制的发丝分隔,不堆特效。

## 设计前提(已核)

- 主窗(`src/main/index.ts:245`)当前已有(仅 darwin)`titleBarStyle: 'hidden' as const` + `trafficLightPosition:{x:12,y:11}`(上一特性),**无 vibrancy**。
- tokens(`src/renderer/styles/tokens.css`):`--bg` #f7f8fa 灰(body/内容区底)、`--bg-elevated` #fff 白(卡片)、`.sidebar-gradient` 渐变(#eef1f6→#e7ebf3);暗色 `--bg` #0f1419、`--bg-elevated` #161b22。`body { background: var(--bg) }`(:50)。
- `window.wraith.platform` 已暴露(可在 renderer 判 darwin)。
- 软卡片语言(AutomationForm 已上线 + rollout GATED)靠"`--bg` 灰底 + `--bg-elevated` 白卡";**本设计不动面板底色**,软卡片零冲突。
- App 根 `App.tsx:840` `flex h-screen flex-col ... bg-bg`;TopBar(全宽,`bg-bg`)在上,下面是 `min-h-0 flex-1` 包裹层含 SidebarDock(侧栏 `.sidebar-gradient`)+ 内容行(892 `relative flex min-w-0 flex-1 flex-col`,继承 bg)。

## 视觉结构(目标)

macOS(有磨砂):
```
┌─────────────────────────────────────┐
│▒▒▒ 磨砂顶条(全宽,透壁纸模糊)▒▒▒▒▒▒│  ← TopBar 透明
├────────┬────────────────────────────┤
│▒▒▒▒▒▒▒│  白内容岛(聊天)/灰底(面板)  │
│▒磨砂▒▒│                              │
│▒侧栏▒▒│  ← 内容区实底,不透           │
│▒▒▒▒▒▒│                              │
└────────┴────────────────────────────┘
磨砂 chrome 呈「⌐」形(顶+左),内容是右下的实底面板
```
非 macOS(无磨砂):body 灰、侧栏平面(保留现有渐变)、内容白(聊天)/灰(面板)= 平面两色,不透。

## 组件与改动

### A. 窗口 vibrancy — `src/main/index.ts`(主窗 options,darwin 分支)

现 darwin 分支:
```ts
...(process.platform === 'darwin'
  ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 11 } }
  : {}),
```
改为(加 vibrancy/backgroundColor/visualEffectState):
```ts
...(process.platform === 'darwin'
  ? {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: { x: 12, y: 11 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    }
  : {}),
```
- `vibrancy: 'sidebar'`:macOS 侧栏材质磨砂(比 under-window 更浅、更适合侧栏)。
- `visualEffectState: 'active'`:失焦不变暗,磨砂常亮。
- `backgroundColor: '#00000000'`:透明窗底,让 vibrancy 透出(否则默认不透明底盖住磨砂)。**风险见下**——须保证内容区铺实底,不然会漏桌面。

### B. 平台标记 — renderer 启动入口

在 renderer 入口(`src/renderer/main.tsx` 或等价,渲染 `<App/>` 之前)按平台给 `<html>` 加标记类:
```ts
if (window.wraith.platform === 'darwin') document.documentElement.classList.add('is-mac')
```
CSS 据 `.is-mac` 决定"透明露磨砂"还是"平面纯色",保证非 darwin 有实底不漏。

### C. body / 侧栏 透明化 — `src/renderer/styles/tokens.css`

```css
/* 默认(非 mac / 无磨砂):body 与侧栏走实色,不透 */
body { background: var(--bg); }
.sidebar-gradient { background: linear-gradient(180deg, var(--bg-sidebar-from), var(--bg-sidebar-to)); }

/* mac:body 与侧栏透明,露出窗口 vibrancy 磨砂 */
html.is-mac body { background: transparent; }
html.is-mac .sidebar-gradient { background: transparent; }
```
(默认 body/侧栏规则即现状;只新增 `.is-mac` 两条覆盖。)

### D. App 根 + 内容区铺色 — `src/renderer/App.tsx`

- **根**(:840):`bg-bg` 会盖磨砂。改为不铺底(依赖 body):把根的 `bg-bg` 去掉 → `flex h-screen flex-col overflow-hidden text-fg`(mac 下 body 透明露磨砂;非 mac body 灰)。
- **TopBar**(全宽顶条):mac 透明露磨砂 / 非 mac `bg-bg`。在 `TopBar.tsx` 用已有的 `window.wraith.platform` 判定:容器 className 的 `bg-bg` 改为 `platform === 'darwin' ? '' : 'bg-bg'`(mac 透明)。其余(drag/发丝线/pad)不变。
- **内容区按视图铺实底**:内容列(:892 `relative flex min-w-0 flex-1 flex-col`)加 bg——`view === 'chat' ? 'bg-surface' : 'bg-bg'`:
  - 聊天:`bg-surface`(= `--bg-elevated`,浅白 #fff / 暗 #161b22)= 纯白内容岛。
  - 面板:`bg-bg`(灰)+ 软白卡不动。
  - 关键:内容列**始终有实底**(白或灰),磨砂只在顶条/侧栏露出,内容区不漏桌面。

### E. 质感分隔(克制)

- 侧栏右缘、顶条底缘已有 `border-r/border-b border-border` 发丝线 → 保留,作磨砂 chrome 与内容岛的分界。
- 不加额外阴影/圆角(YAGNI);若眼验觉得内容岛"浮"得不够,再议(留眼验)。

### F. 暗色

- vibrancy 暗色自动适配(深色磨砂)。
- 聊天 `bg-surface` 暗色 = #161b22(深面,非白,合理);面板 `bg-bg` = #0f1419 + 卡 #161b22(现状)。
- `.is-mac` 覆盖对明暗都成立(透明不分主题)。

## 门禁与约束

- 纯视觉:不改行为/数据/props/testid;JSX 仅样式类 + 一处平台标记 + 一处 view 条件 bg。
- desktop typecheck 0;全量 vitest 基线不降(无可测纯函数新增;若加平台标记纯函数可选单测)。
- push 需用户单独点头。

## 眼验(定案点,必须完整重启 dev —— 改了 main vibrancy)

1. macOS:顶条 + 侧栏呈**磨砂**(透出桌面模糊),观感 OK 吗?壁纸透出可接受吗?
2. 聊天视图内容区**纯白**、像一块浮起的纸;工具面板仍是**灰底 + 软白卡**。
3. 磨砂上侧栏文字/图标**可读**(对比够)吗?(不够则加极淡叠加层。)
4. 内容区**不漏桌面**(白/灰实底铺满,无透明缝漏光)。
5. 暗色:磨砂变深、聊天内容 #161b22、整体协调。
6. 交通灯仍垂直居中(vibrancy 叠加后不移位)。

## 风险

- **`backgroundColor:'#00000000'` + vibrancy 漏光**:若内容区某处未铺实底(透明缝),会直接看到桌面。缓解:内容列/TopBar(非 mac)/侧栏 各自 bg 明确;内容列始终 bg-surface/bg-bg。眼验重点核第 4 条。
- **磨砂可读性**:浅色磨砂上浅色文字可能对比不足;必要时 `html.is-mac .sidebar-gradient` 叠一层极淡 `rgba` tint 提可读性(眼验定)。
- **vibrancy 与 titleBarStyle:hidden 叠加**:两者都改窗口外壳,Electron 下一般兼容;眼验核交通灯位置 + 拖拽仍可。
- **Electron/macOS 版本差异**:vibrancy 表现略有差异;`'sidebar'` 材质广泛支持。

## 回退(平面浅灰,一步可切)

若真磨砂观感不满意(壁纸太乱/可读性差),回退到"平面浅灰侧栏"极简:
- main 去掉 `vibrancy/backgroundColor/visualEffectState`(留 titleBarStyle);
- tokens 去掉 `.is-mac` 两条透明覆盖(侧栏回渐变、body 回 --bg);
- 内容区"聊天白/面板灰"保留(与磨砂无关,独立成立)。
即:方向 A 的"聊天白/面板灰卡"始终成立,磨砂是可插拔的质感层。

## 不做(YAGNI)

- 不改面板底色/软卡片语言;
- 不给内容岛加圆角/大阴影(先发丝线,眼验再议);
- 不做 Win/Linux 的 acrylic/mica(仅 macOS vibrancy;其它平面);
- 不改 splash / 其它窗口;不引新依赖。
