# 设计：输入框（Composer）清晰可见

日期：2026-07-07
范围：桌面渲染层，单文件 className 改动。零逻辑、零后端。接在 `feat/resend-message` 分支。

## 问题 / 根因

Composer 外框已有 `border border-border bg-surface shadow-sm`，但对比度过低："看不清"不是没框，是框太隐形——浅色主题下白框（`--bg-elevated:#fff`）浮在灰白页面底（`--bg:#f7f8fa`）上，边框 `--border:#e2e6ec` 是极淡灰 + `shadow-sm` 极轻，边界几乎不可见。

## 方案（YAGNI，仅动 Composer 容器 className）

`desktop/src/renderer/components/Composer.tsx` 第 101-105 的外层 div className 三处调整（全走 token、深浅两主题皆生效）：

1. **静息边框加强**：`border-border` → `border-fg-subtle/40`（中性灰，白框/灰白底上都看得出边），宽度仍 1px。
2. **抬升阴影**：`shadow-sm` → `shadow-md`（白框在灰白底上浮起，边界感更强）。
3. **聚焦高亮**：加 `transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25`（光标进输入框时整框描 accent 圈）。

即 className 由：
`'relative w-full rounded-2xl border border-border bg-surface shadow-sm '`
改为：
`'relative w-full rounded-2xl border border-fg-subtle/40 bg-surface shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 '`
（后面的 `+ (centered ? 'max-w-2xl mx-auto' : '')` 不变。）

`centered`（欢迎态窄版）与贴底宽版共用此容器，一改两处生效。

## 不做

- 不改全局 `--border` token（免影响别处所有边框）。
- 不重排布局 / 不动 textarea 或控制行。

## 门禁

单 className 改动，无可测纯逻辑（组件无 RTL）。门禁 = `npm run typecheck` + `npm run build` + 眼验：浅色 / 深色下输入框边界清晰、聚焦时有 accent 高亮圈。

## 安全

无密钥面。纯样式。
