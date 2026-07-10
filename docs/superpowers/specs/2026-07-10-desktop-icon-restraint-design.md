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

## 附录(同日第二波,用户追加)

### 平台卡真实品牌图标
- 新依赖 `react-icons`(simple-icons/remix/bootstrap 子集,tree-shake 按需引)。
- 映射:QQ=SiQq 微信=SiWechat 钉钉=RiDingdingFill Slack=RiSlackFill Teams=BsMicrosoftTeams
  元宝=@lobehub/icons Yuanbao **Mono 深路径**(barrel 会连带未装 peer @lobehub/ui 炸 build,
  与 ProviderIcon.tsx 同一模式)其余走 si;**企微/飞书全网开源集无品牌标(商标)**→
  lucide 兜底:Building2 / Send(纸飞机贴飞书意象)。
- 渲染:单色 currentColor,默认 text-fg-muted、选中 text-accent;`imPlatforms.ts` 数据层不动
  (emoji 留作 fallback,测试零改)。新文件 `lib/imPlatformIcons.tsx`。

### Composer 底排「文字下沉」修复
- 病因:底排 flex 无 nowrap/shrink 约束,窄窗时中文在项内折行(停止/转写中/替我审批/发送/模型名全折两行)。
- 修法:固定控件(± 语音/停止/转写中/替我审批/中断/发送/模式 chip/状态 chip)一律
  `whitespace-nowrap shrink-0`;可伸缩项(模型 chip max-w-160 / 目录 chip max-w-180)`min-w-0 + truncate`
  ——空间不够时先收缩 spacer、再截断长名,**任何项内不再折行**。
- 顺手清底排残留 emoji/字符钮:＋→Plus ×→X 📁→Folder;ModeSwitcher ⚡📋🤝→Zap/ClipboardList/Users。
