# Agent 消息 markdown 全面可读化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 消息里的 GFM 表格及全套 markdown（列表/标题/引用/链接等）按主题一致、可读地渲染。

**Architecture:** `AgentMessage` 挂 `remark-gfm`（修表格等 GFM）；在 `tokens.css` 加 `.agent-markdown` 用 token 给全元素上样式（em 相对字号以随 `--font-scale` 缩放）；两个自定义组件——`table` 外包横向滚动容器、`a` 走系统浏览器。零后端。

**Tech Stack:** Electron + React + TS；react-markdown@9 + remark-gfm@4；tokens.css（热更）；门禁 tsc + vitest（不回归）+ electron-vite build。

## Global Constraints

- 工作目录 `desktop/`。桌面渲染层，**零后端改动**；不动 `UserMessage`；不改 agent 输出行为。
- 不引 `@tailwindcss/typography`；不加 `rehype-raw` / 不渲染原始 HTML（无 XSS 面）。
- 字号用 **em 相对值**（相对外层 `text-sm` rem 基准），保留 `--font-scale` 缩放特性。
- 颜色一律走 token（`--fg/--fg-muted/--border/--accent/--bg-elevated`），深浅色自适应。`surface` == `var(--bg-elevated)`。
- 组件层无 RTL：UI 接线走 typecheck + build + 眼验。门禁：`npm run typecheck` + `npm run test`（不回归）+ `npm run build` 全绿。
- 无密钥面。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支：接在 `feat/resend-message`（当前分支）。

## File Structure

- `desktop/package.json` / lockfile — 加依赖 `remark-gfm@^4`。
- `desktop/src/renderer/styles/tokens.css` — 追加 `.agent-markdown` / `.agent-md-table-wrap` 全元素样式块。
- `desktop/src/renderer/components/AgentMessage.tsx` — 挂 remark-gfm + 两自定义组件 + `.agent-markdown` 包裹，移除内联 `[&_code]/[&_pre]` 变体。

---

### Task 1: markdown 全面可读化渲染

**Files:**
- Modify: `desktop/package.json`（+ lockfile）—— 加 `remark-gfm@^4`
- Modify: `desktop/src/renderer/styles/tokens.css` —— 追加 `.agent-markdown` 样式
- Modify: `desktop/src/renderer/components/AgentMessage.tsx` —— 挂插件 + 组件 + 包裹类

**Interfaces:**
- Consumes: `react-markdown@9`（`remarkPlugins`、`components`、`Components` 类型）；`remark-gfm@4` default export；`window.wraith.openExternal(url: string): Promise<void>`（既有 preload）；tokens.css 的 `--fg/--fg-muted/--border/--accent/--bg-elevated`。
- Produces: 无对外接口（纯展示）。`.agent-markdown` / `.agent-md-table-wrap` CSS 类名由 `AgentMessage` 独占使用。

- [ ] **Step 1: 安装 remark-gfm**

Run:
```bash
cd /Users/aa00945/Desktop/wraith/desktop
npm install remark-gfm@^4
```
Expected: package.json 出现 `"remark-gfm": "^4..."`，lockfile 更新，无 peer 冲突报错（remark-gfm@4 与 react-markdown@9 同属 unified 11，兼容）。

- [ ] **Step 2: tokens.css 追加 `.agent-markdown` 样式**

在 `desktop/src/renderer/styles/tokens.css` **末尾**（现有 `[data-theme="dark"] .brand-logo-light { display: block; }` 那行之后）追加：

```css

/* ── Agent 消息 markdown 正文:全元素主题样式。em 相对字号→随 --font-scale 缩放 ── */
.agent-markdown > :first-child { margin-top: 0; }
.agent-markdown > :last-child { margin-bottom: 0; }
.agent-markdown p { margin: 0.5em 0; }

.agent-markdown h1,
.agent-markdown h2,
.agent-markdown h3,
.agent-markdown h4 { font-weight: 600; line-height: 1.3; margin: 1em 0 0.5em; }
.agent-markdown h1 { font-size: 1.5em; }
.agent-markdown h2 { font-size: 1.3em; }
.agent-markdown h3 { font-size: 1.15em; }
.agent-markdown h4 { font-size: 1em; }

.agent-markdown ul,
.agent-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.agent-markdown ul { list-style: disc; }
.agent-markdown ol { list-style: decimal; }
.agent-markdown li { margin: 0.25em 0; }
.agent-markdown li > ul,
.agent-markdown li > ol { margin: 0.25em 0; }

.agent-markdown strong { font-weight: 600; }
.agent-markdown em { font-style: italic; }

.agent-markdown blockquote {
  margin: 0.5em 0;
  padding: 0.25em 0 0.25em 1em;
  border-left: 3px solid var(--accent);
  color: var(--fg-muted);
}

.agent-markdown hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}

.agent-markdown a {
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}

.agent-markdown code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 0.3em;
  padding: 0.1em 0.35em;
}
.agent-markdown pre {
  overflow-x: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 0.5em;
  padding: 0.75em;
  margin: 0.5em 0;
}
.agent-markdown pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.85em;
}

/* GFM 表格:外层 .agent-md-table-wrap 提供横向滚动 */
.agent-md-table-wrap { overflow-x: auto; margin: 0.5em 0; }
.agent-markdown table { border-collapse: collapse; width: auto; font-size: 0.95em; }
.agent-markdown th,
.agent-markdown td {
  border: 1px solid var(--border);
  padding: 0.4em 0.7em;
  text-align: left;
  vertical-align: top;
}
.agent-markdown thead th {
  background: var(--bg-elevated);
  font-weight: 600;
}
```

- [ ] **Step 3: 重写 AgentMessage.tsx**

整文件替换 `desktop/src/renderer/components/AgentMessage.tsx` 为：

```tsx
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Logo from './Logo'

/** Agent 消息 markdown 正文的自定义渲染:表格外包横向滚动容器、链接走系统浏览器。 */
const MARKDOWN_COMPONENTS: Components = {
  table: ({ node, children, ...props }) => (
    <div className="agent-md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      onClick={e => {
        e.preventDefault()
        if (href) void window.wraith.openExternal(href)
      }}
      {...props}
    >
      {children}
    </a>
  ),
}

/** Agent 消息:左侧主题感知 Wraith logo 头像+名字,右侧全宽 markdown 正文(GFM + 主题样式)。 */
export default function AgentMessage({ text }: { text: string }): JSX.Element {
  return (
    <div data-testid="agent-msg" className="flex gap-2.5">
      <Logo className="mt-0.5 h-6 w-6 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-2xs font-semibold text-fg-muted">Wraith</div>
        <div className="agent-markdown text-sm leading-7 text-fg">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 门禁 —— typecheck + vitest 不回归 + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected:
- typecheck exit 0（`Components` 类型、`node` 解构不透传、`window.wraith.openExternal` 均通过）。
- vitest 全绿（本改动不碰逻辑测试，既有 311 应不变）。
- build 成功（remark-gfm 打进 bundle，无解析错）。

（本任务为渲染+样式,无独立单测——门禁即 typecheck + vitest 不回归 + build,符合项目「组件无 RTL」约定;视觉正确性靠交付后眼验。）

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add package.json package-lock.json src/renderer/styles/tokens.css src/renderer/components/AgentMessage.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): agent 消息 markdown 全面可读化(remark-gfm + 主题样式)

修表格不渲染(挂 remark-gfm)+ preflight 清掉的列表/标题/引用样式(tokens.css
加 .agent-markdown 全元素主题样式,em 字号随 font-scale 缩放)。table 外包
横向滚动、链接改走系统浏览器(修 Electron 窗口被导航走的隐患)。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

> lockfile 名以仓库实际为准（`package-lock.json`);若用 pnpm/yarn 则 add 对应 lock 文件。

---

## 交付后（计划外，人工/主循环执行）

1. 眼验（重启/运行桌面 App 后）：① 让 agent 输出 GFM 表格 → 成真表格（表头淡底、边框、宽则横向滚动）；② 列表有圆点/序号、标题有层级、引用块有 accent 竖条；③ 点 agent 消息里的链接 → 系统浏览器打开、app 不跳走；④ 深/浅色切换均可读。
2. 与 resend-message 一并眼验通过后 → `git checkout main && git merge --ff-only feat/resend-message && git push origin main`（推送前用户点头）。纯桌面改动，jar 不变。

## Self-Review

**1. Spec 覆盖：**
- 挂 remark-gfm 修表格 → Step 1 + Step 3（remarkPlugins）。✓
- `.agent-markdown` 全元素主题样式（表格/列表/标题/引用/hr/段落/code/pre/strong/em）→ Step 2。✓
- 自定义 `table`（横向滚动）/`a`（openExternal）→ Step 3。✓
- em 相对字号保留 font-scale → Step 2 全用 em/相对。✓
- AgentMessage 收口（包裹类 + 移除内联变体）→ Step 3。✓
- 不引 typography、不渲染原始 HTML → 未加相关依赖/插件。✓
- 测试策略（无纯函数,typecheck+build+眼验）→ Step 4 + 交付后。✓

**2. 占位符扫描：** 无 TBD/TODO；CSS 与组件为完整代码;lockfile 名给了兜底说明。✓

**3. 类型/命名一致性：**
- `.agent-markdown` / `.agent-md-table-wrap`:Step 2 CSS 定义与 Step 3 组件使用一致。✓
- `MARKDOWN_COMPONENTS: Components`、`remarkPlugins={[remarkGfm]}`:react-markdown@9 API 一致。✓
- `window.wraith.openExternal(href)`:与 preload 签名 `(url: string) => Promise<void>` 一致(`void` 忽略返回)。✓
- 颜色 token 名(`--bg-elevated` 等)与 tokens.css `:root` 定义一致。✓
