# 侧栏墨系选中语言 + 灵条签名 设计稿

日期:2026-07-17
状态:待用户审阅
背景:磨砂 v3 后用户反馈(截图 #20/#21)侧栏不好看,给出 Codex 参照(#22)但要求**不照抄**。

## 诊断(丑在哪)

1. **选中态 = 纯白实心药丸**:active 会话/active 导航/草稿行都是 `bg-surface`(#fff 不透明),玻璃上一块块白瓷砖,又重又刺;悬停 `bg-surface/60`(alpha 修复后=60% 白)同族问题。
2. **sticky 表头 = 通宽硬边灰带**:`.sidebar-sticky` 是矩形实底,上下硬边横切玻璃;还与行内缩不对齐(表头 12px、行文本 20px)。
3. Codex 的好看点:选中是**半透明墨色圆角块**(不是白)、区块标签小而淡、留白从容、全程无硬边。

## 设计原则

玻璃上的一切覆层用**墨**(fg 的低透明度),不用白:浅色主题=深墨、暗色主题=亮墨,`bg-fg/N` 天然双主题(v3 alpha 已就绪)。白色只属于内容列。

**签名(不抄 Codex 的差异点)**:选中项左缘一根 2px 圆头 **accent 灵条**(spectral bar)——幽灵主题的一缕魂,Codex 是纯灰块没有它。全侧栏唯一的彩色笔触,克制。

## 改动

### A. 选中/悬停语言(Sidebar.tsx)

统一替换(共四类状态):

- **active 块**(SessionRow active、nav active、草稿行):`bg-surface` → `relative bg-fg/10` + 灵条伪元素
  `before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent`
- **hover**:`hover:bg-surface/60` → `hover:bg-fg/5`(SessionRow、搜索、工具组、12 个导航项)
- **设置按钮**:`hover:bg-surface` → `hover:bg-fg/5`(保留 hover:text-accent)
- **改名容器**:`bg-surface` → `bg-fg/10`(内部输入框 bg-bg 不动——编辑场景要实底)
- **折叠键**(侧栏顶段):`hover:bg-surface/60` → `hover:bg-fg/5`

### B. sticky 表头:硬带 → 渐隐纱(veil)

- JSX:headerCls/groupLabelCls 去掉 `backdrop-blur-sm`(blur 矩形下缘也是硬边);`px-3` → `pl-5 pr-3`(标签文本与行文本 20px 对齐)。
- tokens.css `.sidebar-sticky` 三条改渐隐:

```css
/* 会话列表 sticky 表头:上实下透渐隐纱,滚动内容从纱下淡出(无硬边) */
.sidebar-sticky { background: linear-gradient(180deg, rgb(var(--bg-rgb) / .95) 55%, rgb(var(--bg-rgb) / 0)); }
html.is-mac .sidebar-sticky { background: linear-gradient(180deg, rgba(255,255,255,.72) 55%, rgba(255,255,255,0)); }
html.is-mac[data-theme="dark"] .sidebar-sticky { background: linear-gradient(180deg, rgba(22,27,34,.72) 55%, rgba(22,27,34,0)); }
```

- 呼吸感:headerCls `py-1` → `pb-1.5 pt-2`(渐隐留出行程);`mt-4` 保留。

### C. 内容列顶行按钮悬停可见性(App.tsx,顺手修)

白底上 `hover:bg-surface`(白上白)不可见:sidebar-expand `hover:bg-surface/60`、terminal-toggle/rightdock-toggle `hover:bg-surface`、chat 工具条 compact/export `hover:bg-surface` → 均改 `hover:bg-fg/5`(墨系统一,白底灰底皆可见)。

## 不做(YAGNI)

- 不动布局结构/testid/行为;不动 ProjectSwitcher 弹层(Portal 在实底 surface 上,白系合理);不动内容列/面板;不加新依赖;间距大改不做(只对齐表头缩进)。

## 门禁

typecheck 0;vitest 678 全绿(纯类名替换,无测试引用);push 需单独点头。

## 眼验

1. 选中/悬停成半透明墨块 + 左缘 accent 灵条,玻璃上不再有白瓷砖;
2. "对话/重点"表头无硬边,滚动内容从纱下淡出;标签与行左对齐;
3. 暗色:墨块自动翻转为亮墨,灵条仍是 accent;
4. 内容列顶行/工具条按钮悬停可见;
5. 非 mac(实色渐变侧栏)同语言成立。
