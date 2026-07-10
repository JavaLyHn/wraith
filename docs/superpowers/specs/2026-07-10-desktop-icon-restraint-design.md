# 桌面 chrome 图标克制化设计(emoji → Lucide 线性图标)

**日期:** 2026-07-10 **分支:** feat/desktop-icon-restraint **状态:** 用户已给出设计,本文记录映射与边界

## 问题(用户原话要点)

侧栏(🔍搜索/🧩MCP/⏰自动化/💬IM网关)、设置子页(👤我/🎨界面/ℹ️关于)、底部 🛡️沙箱全是彩色 emoji——
活泼、多彩、系统渲染不可控,与「克制」冲突,一眼「没精修」。统一换 **Lucide** 1.5px 描边单色线性图标,
默认中性灰、hover/选中提亮。

## 方案

- 依赖:`lucide-react`(已装,--legacy-peer-deps,与既有 @lobehub/icons 的 react19 peer 冲突同源)。
- 统一规格:`strokeWidth={1.5}`,尺寸 `h-3.5 w-3.5`(14px,配 text-xs;行内小操作钮 `h-3 w-3`),
  `shrink-0`;**颜色不单独设**——继承 `currentColor`,由按钮既有类(默认 `text-fg-muted`/`text-fg-subtle`,
  hover/选中 `text-fg`/`text-accent`)驱动,天然满足「默认中性灰、hover 提亮」。
- 布局:纯文本按钮补 `flex items-center gap-2`(行内小钮不需要)。

## 映射(chrome 全量,不止用户点名的 8 处——半换更难看)

| 现状 | Lucide | 位置 |
|---|---|---|
| ＋ 新对话 | `Plus` | Sidebar |
| 🔍 搜索 | `Search` | Sidebar |
| ✕ 清搜索 | `X` | Sidebar |
| 🧩 MCP | `Blocks` | Sidebar |
| ⏰ 自动化 | `Clock` | Sidebar |
| 💬 IM 网关 | `MessageSquare` | Sidebar |
| 🔌 Provider 配置 | `Plug` | Sidebar |
| 📚 技能 | `BookOpen` | Sidebar |
| ⭐ 重点(分区头) | `Star` | Sidebar |
| 🗂 / ≡ 分组切换 | `ListTree` / `List` | Sidebar |
| ★/☆ 会话星标 | `Star`(选中 `fill="currentColor"`) | SessionRow |
| ✎ 改名 | `Pencil` | SessionRow |
| 🗑 / ✓ 删除/确认 | `Trash2` / `Check` | SessionRow |
| ⚙ 设置 | `Settings` | Sidebar 底部 |
| ⚠/🛡/— 沙箱徽标 | `ShieldAlert` / `ShieldCheck` / `Shield` | Sidebar 底部 |
| 👤 我 / 🎨 界面 / ℹ️ 关于 | `User` / `Palette` / `Info` | SettingsPanel |

## 边界(不动)

- **内容区 emoji 不动**:IM 平台卡占位图标(`imPlatforms.ts`,待换品牌图标)、插件橱窗(`pluginShowcase.ts`)、
  消息文案里的 ⚠️/✅ 等(那是内容,不是 chrome)。
- 测试全用 data-testid,无 emoji 文案断言,零测试改动预期。

## 验证

typecheck / vitest 全绿 / build 成功;肉眼:默认中性灰、hover/选中随既有类提亮。
