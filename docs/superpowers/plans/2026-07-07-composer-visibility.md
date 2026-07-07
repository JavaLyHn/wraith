# 输入框(Composer)清晰可见 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让聊天输入框边界清晰可见、聚焦时高亮，修"完全看不清"。

**Architecture:** 只改 `Composer.tsx` 外层容器 className：加强静息边框 + 抬升阴影 + `focus-within` accent 高亮圈。全走 token，深浅两主题生效。零逻辑、零后端。

**Tech Stack:** React + Tailwind（token 颜色 via CSS var）；门禁 tsc + vitest 不回归 + electron-vite build。

## Global Constraints

- 工作目录 `desktop/`。桌面渲染层，纯样式，零后端；只改 Composer 容器 className。
- 全走 token（`fg-subtle`/`accent` 映射到 CSS var），不改全局 `--border` token，不重排布局，不动 textarea/控制行。
- 门禁：`npm run typecheck` + `npm run test`（不回归）+ `npm run build` 全绿。无密钥面。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支：接在 `feat/resend-message`（当前分支）。

## File Structure

- `desktop/src/renderer/components/Composer.tsx` — 唯一改动：外层容器 div 的 className（第 101-105）。

---

### Task 1: Composer 容器可见性 className

**Files:**
- Modify: `desktop/src/renderer/components/Composer.tsx:102-105`

**Interfaces:**
- Consumes: 既有 Tailwind token 颜色 `fg-subtle`/`accent`（tailwind.config 已映射到 CSS var）。
- Produces: 无对外接口（纯样式）。

- [ ] **Step 1: 改 className**

在 `desktop/src/renderer/components/Composer.tsx`，把外层容器 div（约第 102-105）的：

```tsx
        className={
          'relative w-full rounded-2xl border border-border bg-surface shadow-sm ' +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
```

改为：

```tsx
        className={
          'relative w-full rounded-2xl border border-fg-subtle/40 bg-surface shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ' +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
```

（仅这一处；其余文件内容不动。）

- [ ] **Step 2: 门禁 —— typecheck + vitest 不回归 + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected: typecheck exit 0；vitest 既有全绿（311，不回归）；build 成功。

（纯 className 改动，无独立单测——门禁即三门 + 交付后眼验，符合项目「组件无 RTL」约定。）

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/components/Composer.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
fix(desktop): 输入框清晰可见 —— 边框加强 + 抬升阴影 + 聚焦高亮

Composer 外框对比度过低(--border 极淡 + shadow-sm 轻,白框浮灰白底几乎看不见)。
边框换 border-fg-subtle/40、shadow-md、加 focus-within accent 高亮圈。全走 token。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

## 交付后（人工/主循环）

- 眼验：浅色 / 深色主题下输入框边界均清晰；光标进框时整框有 accent 高亮圈；欢迎态窄版与贴底宽版都对。
- 与 resend + markdown 一起眼验通过 → FF-merge + 推送（推送前用户点头）。

## Self-Review

**1. Spec 覆盖：** 边框加强 + 抬升阴影 + 聚焦高亮 → Task 1 Step 1 三处全含；不改全局 token / 不重排 → 仅动容器 className。✓
**2. 占位符扫描：** 无 TBD/TODO；Step 1 给完整前后 className。✓
**3. 一致性：** token 名 `fg-subtle`/`accent` 与 tailwind.config 映射一致；改动行号与 spec 一致。✓
