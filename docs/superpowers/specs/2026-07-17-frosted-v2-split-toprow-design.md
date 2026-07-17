# 磨砂 v2:splash 同款透明 + 顶行按列拆分 设计稿

日期:2026-07-17
状态:待用户审阅
背景:磨砂 v1(781b322)眼验反馈(截图 #18/#19):①整体"不透明";②顶部 38px 那行是一整条灰带横穿白色内容区,用户红框标注"只有左侧栏对应的那段才应该是透明的";③点名"透明效果做成打开 app 动画(splash)那个透明底色"。

## 诊断(systematic-debugging 结论)

- **①③ 根因:材质选错**。主窗用 `vibrancy: 'sidebar'`,浅色外观下渲染为近实心浅灰(截图实测 RGB 221-224,深色壁纸几乎不透出);splash 用的是 `vibrancy: 'fullscreen-ui'`(玻璃感强、明显透壁纸)——用户要的"透明底色"就是它。
- **② 根因:结构错位,不是渲染 bug**。像素采样证明顶条左右两段完全一致(221 vs 221),没有"左透右不透"的渲染差异;用户诉求是规范性的:对照 Codex 参照图,**顶行不该是全宽横条**——左段应属于磨砂侧栏列(整列到顶),右段应并入纯白内容列(白到顶)。

## 目标形态(对照 Codex 截图 #17)

```
┌────────┬────────────────────────────┐
│▒ ●●● ⧉│  (内容列顶行:白,chat 右簇)  │ ← 顶行拆两段,分属两列
│▒▒▒▒▒▒▒│                            │
│▒磨砂▒▒│   纯白内容列(白到顶)        │
│▒整列▒▒│   /面板灰+软白卡            │
│▒到顶▒▒│                            │
└────────┴────────────────────────────┘
 全高发丝线(侧栏 border-r)取代原全宽 border-b
```

- 磨砂只在左列(侧栏,含其顶段);内容列(含其顶行)永远实底白/灰。
- 折叠侧栏后:左列消失,内容列铺满全宽,展开键出现在内容列顶行、交通灯右侧;整窗无磨砂(纯白/灰 app)。
- 非 macOS:同一结构,侧栏走实色渐变(现状),无磨砂。

## 改动点

### A. 材质对齐 splash — `src/main/index.ts`(1 行)

主窗 darwin 分支 `vibrancy: 'sidebar'` → `'fullscreen-ui'`(splash 同款;`visualEffectState: 'active'`、`backgroundColor: '#00000000'` 不变)。**改 main 进程,眼验须完整重启 dev。**

### B. 顶行拆分 — renderer 三处

1. **删全宽 TopBar**:App.tsx 移除 `<TopBar …/>` 及 import;`components/TopBar.tsx` 删除(其 border-b 灰带即②的病灶)。`lib/topBar.ts` 的 `topBarLeftPad` 保留复用(测试不动)。
2. **侧栏顶段(交通灯 + 折叠键)回 Sidebar**:`Sidebar.tsx` aside 内第一个子元素加 38px 顶段——`[-webkit-app-region:drag]`、左 pad 用 `topBarLeftPad(platform)`(mac 让开交通灯 80px / 非 mac pl-2)、内含原折叠键(`data-testid="sidebar-collapse"`,no-drag)。`onToggleCollapsed` prop 加回 Sidebar。透明(mac 磨砂透出/非 mac 渐变)。
3. **内容列顶行**:App.tsx 内容列(:898)第一个子元素加 38px 行——drag、无边框、继承列底色(chat 白/面板灰):
   - 左:`sidebarCollapsed` 时显展开键(`data-testid="sidebar-expand"`,pad 用 `topBarLeftPad`);展开时无左侧内容(pl-2)。
   - 右:`view === 'chat'` 时终端/右侧面板两键(原 TopBar right 簇原样迁移);面板视图右侧留空。
   - 该行所有视图常驻:保证内容区顶部可拖拽 + 折叠时交通灯不压内容。

### 行为细节

- 折叠+peek:浮层(含其顶段折叠键)滑入时盖住内容顶行左段,展开键被自然遮换,无双键并存观感问题。
- RightDock/TerminalDrawer:随 TopBar 移除顶到窗顶,自带 header 与实底 backstop,不漏光。
- 防漏光不变式延续:透明只存在于侧栏列;内容列(含顶行)永远实底。

## 门禁

- 纯视觉+结构迁移:不改行为/数据;testid 迁移(sidebar-collapse 移入 Sidebar,新增 sidebar-expand)。
- typecheck 0;vitest 基线 675 不降(topBar.test.ts 不受影响)。
- push 仍需用户单独点头。

## 眼验清单(定案点,完整重启 dev)

1. 侧栏整列磨砂到顶,透壁纸,观感 = splash 底色;
2. 内容区白到顶(chat)/灰到顶(面板),无灰带横穿;
3. 交通灯右侧折叠键可用;折叠后展开键在交通灯右侧、整窗纯白;peek 滑入正常;
4. 顶行两段均可拖拽窗口;
5. 暗色协调;磨砂上侧栏文字可读(不够加极淡 tint)。

## 风险

- `fullscreen-ui` 透明度更高,花壁纸下侧栏文字对比可能不足 → 备选:`html.is-mac .sidebar-gradient` 叠极淡 `rgba` tint(眼验定)。
- app 主题与系统外观不一致时(app 强制 light/dark 而系统相反),磨砂明暗跟系统走会打架 → 现状即存在,本次不治(YAGNI;要治是 `nativeTheme.themeSource` 同步,单独议)。

## 不做(YAGNI)

- 不动软卡片语言/面板底色;不做 Win/Linux 磨砂;不改 splash;不引依赖。
