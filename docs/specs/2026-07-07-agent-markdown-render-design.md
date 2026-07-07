# 设计：Agent 消息 markdown 全面可读化

日期：2026-07-07
范围：桌面渲染层（Electron/React）。**零后端改动。** 接在 `feat/resend-message` 分支上。

## 背景 / 根因

桌面聊天里，agent 输出的 GFM 表格（如计划的「步骤/任务/预估」表）显示为一坨带管道符的run-on 文本，明显错误。根因：

1. `AgentMessage` 用 `react-markdown@9` 但**未挂 `remark-gfm`**——react-markdown 默认不渲染 GFM 表格/任务列表/删除线/自动链接，表格被当普通段落，`|` 原样输出、多行拼一行。
2. Tailwind `@tailwind base`（preflight reset）清掉了 `ul/ol` 的项目符号、`h1-h6` 的字号、`blockquote` 样式，而组件只手写了 `code`/`pre` 的样式——所以列表/标题/引用也是「平」的。

经确认，采用**全面可读化**：不仅修表格，给 agent 消息一整套主题一致的 markdown 样式。

## 目标

- GFM 表格渲染为真表格（表头、边框、宽表横向滚动）。
- 列表/标题/引用/分隔线/行内代码/链接等全部按主题 token 可读呈现，深浅色自适应。
- 修顺带发现的隐患：agent 消息里的链接点击应走系统外部浏览器，而非让 Electron 窗口导航走。

## 非目标（YAGNI）

- 不引 `@tailwindcss/typography`（避免 tailwind.config 改动的 dev 热更坑 + prose 配色与 token 冲突）。
- 不加 `rehype-raw` / 不渲染原始 HTML（保持无 XSS 面）。
- 不改 agent 输出行为（后端不动）；不动用户气泡 `UserMessage`。

## 现有结构（锚点）

- `desktop/src/renderer/components/AgentMessage.tsx`：`<ReactMarkdown>{text}</ReactMarkdown>`，外层 div 带 `text-sm leading-7 text-fg` + 内联 `[&_code]/[&_pre]` 样式。
- `desktop/src/renderer/styles/tokens.css`：全局主题样式（会热更），含 `:root` / `[data-theme="dark"]` 的 `--fg/--fg-muted/--border/--accent/--bg-elevated` 等 token。
- `window.wraith.openExternal(url: string)`：既有 preload API（更新横幅/GitHub 已用）。
- `react-markdown@9.1.0` 已装；`remark-gfm` 未装。

## 设计

### 1. 挂 remark-gfm

- 新增依赖 `remark-gfm@^4`（unified 11 系，与 react-markdown@9 配套）。
- `AgentMessage`：`import remarkGfm from 'remark-gfm'`，`<ReactMarkdown remarkPlugins={[remarkGfm]} ...>`。

### 2. `.agent-markdown` 主题样式（tokens.css）

在 `tokens.css` 追加 `.agent-markdown` 块，用 token 给全套元素上样式。字号用 **em 相对值**（相对外层 `text-sm` 的 rem 基准），以保留既有「字号缩放」特性（`--font-scale`）：

- **表格**：`table` 宽度自适应、`border-collapse`；`th/td` `--border` 边框 + padding；`thead th` `--bg-elevated` 淡底 + 加粗左对齐；单元格顶对齐。
- **列表**：`ul` disc / `ol` decimal + 左缩进 + `li` 行距 + 嵌套间距。
- **标题**：`h1~h4` 分级 em 字号 + 上下 margin + 600 字重；`h1/h2` 可加下边框细线。
- **引用块**：`blockquote` 左 3px `--accent` 竖条 + 左 padding + `--fg-muted`。
- **分隔线**：`hr` `--border` 细线 + 上下 margin。
- **段落**：`p` 上下 margin（首尾 margin 归零，避免气泡首尾多余空白）。
- **行内 code**：等宽 + `--bg-elevated`/淡底 + 圆角 padding（延续现风格）；**pre**：`--bg-elevated`/surface 底 + `--border` 边框 + 圆角 + padding + `overflow-x:auto`（从组件内联迁来）。
- **strong/em**：加粗 / 斜体。
- 深浅色随 token 自动适配（不写死颜色）。

### 3. 两个自定义渲染组件（AgentMessage 内 `components={{...}}`）

- **`table`**：外包 `<div className="agent-md-table-wrap">`（CSS `overflow-x:auto`），宽表在气泡内横向滚动不撑破布局。须从 props 解构出 `node` 不透传到 DOM：`({ node, children, ...props }) => <div className="agent-md-table-wrap"><table {...props}>{children}</table></div>`。
- **`a`**：`({ node, href, children, ...props }) => <a href={href} onClick={e => { e.preventDefault(); if (href) window.wraith.openExternal(href) }} {...props}>{children}</a>`。阻止 Electron 窗口导航、改走外部浏览器；`--accent` 色 + 下划线由 `.agent-markdown a` 上。

### 4. AgentMessage 收口

- 外层正文 div：保留 `text-sm leading-7 text-fg`（rem 基准，配合 font-scale），追加 `agent-markdown` class；移除内联的 `[&_code]/[&_pre]` 串（统一到 tokens.css）。
- `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table, a }}>{text}</ReactMarkdown>`。

## 错误处理 / 边界

- 空文本：ReactMarkdown 渲染空，无异常。
- 宽表格：`.agent-md-table-wrap` 的 `overflow-x:auto` 兜底；外层 `min-w-0 flex-1` 已允许收缩。
- 链接无 href：`a` 组件 `if (href)` 守卫，不调 openExternal。
- 不渲染原始 HTML（react-markdown 默认），无 XSS。

## 测试 / 门禁

纯渲染 + 样式，无可抽纯函数；项目组件层无 RTL。门禁 = `npm run typecheck` + `npm run build` + 眼验：
1. 让 agent 输出一个 GFM 表格 → 成真表格（表头淡底、边框、宽则横向滚动）。
2. 列表有圆点/序号、标题有层级、引用块有竖条。
3. 点击 agent 消息里的链接 → 系统浏览器打开，app 不跳走。
4. 深浅色切换下均可读。

## 交付链路

接 `feat/resend-message` 分支 → SDD/inline → typecheck + build 全绿 → 与 resend 一起眼验 → FF-merge + 推送（推送前用户点头）。纯桌面改动，jar 不变。

## 安全

无密钥面。不新增网络/HTML 渲染面。`remark-gfm` 为构建期依赖。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
