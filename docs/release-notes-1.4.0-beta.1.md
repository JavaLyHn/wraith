## Wraith v1.4.0-beta.1 — 首个 Windows 版本（预发布）

> ⚠️ **这是预发布（pre-release）。** Windows 端的代码到 v1.3.0 为止从未有过安装包，这是第一个。请先在非关键环境上试。
>
> macOS 用户请继续用 [v1.3.0](https://github.com/JavaLyHn/wraith/releases/tag/v1.3.0)。本次只出 Windows 资产。

**上手教程：[`docs/windows-usage.md`](https://github.com/JavaLyHn/wraith/blob/feat/windows-parity-block1/docs/windows-usage.md)** —— 从装完之后写起：配模型的三条路、界面导览、故障对照表。

---

### 安装

下载 `Wraith Setup 1.4.0-beta.1.exe`，双击。

- 安装包**未签名**，SmartScreen 会报「未知发布者」→ 点**「更多信息」→「仍要运行」**。
- 向导式安装，可改安装目录，会建桌面和开始菜单快捷方式。
- **不需要系统装 Java** —— 安装包捆绑了 JRE。

装完首次启动要先配一个模型：左侧栏 **配置 → Provider 配置** → 填 API Key → **测试连接** → 保存 → 设默认。

---

### Windows 桌面对等（本次核心）

桌面 App 原以 macOS 为主，这一版把能力搬到了 Windows：

- **无边框主窗 + 自绘窗控** —— 右上角 最小化/最大化/关闭，位置行为随 Windows 习惯，字形是 wraith 的单色墨，关闭键悬停变红；双击顶栏最大化，拖顶栏移窗。
- **终端** —— 走 `COMSPEC`（通常 cmd），缺失时回退 PowerShell。
- **「用应用打开」** —— 按已知安装路径探测 VS Code / VS Code Insiders / Cursor / Sublime Text / Notepad++，直接拉起。
- **NSIS 安装包** —— 捆绑 JRE 与后端 jar，装完即用。
- **桌宠点击不抢焦** —— 用 koffi FFI 给桌宠窗加 `WS_EX_NOACTIVATE`，点它不会把 wraith 抢到前台。
- **顶栏沙箱盾** —— Windows 上显示「当前平台无沙箱」（中性墨色，**不是告警**）。命令沙箱是 macOS Seatbelt 专有；此时 agent 的 shell 命令仍受命令黑名单保护。

---

### 同时包含（自 v1.3.0 起的通用改进，两端共享）

**自我认知 + 聊天↔面板对等**

- 问「你能做什么」按产品能力目录回答，不再去 grep 项目代码
- 聊天里出现**一键动作卡**，直接打开对应面板
- 聊天内接入 IM（微信内联二维码 / QQ 走浏览器授权 / 飞书企微开面板）
- 新增 15 个面板能力工具：后台任务 `task_*`、记忆 `memory_*`、自动化 `automation_*`，均带 HITL 审批与审计
- ReAct / Plan / Team 三种模式都能出动作卡

**界面**

- 侧栏工具按 **配置 / 运行 / 观察** 三组归类
- 左下角改为**账户行**（头像 + 昵称），点进去是整套设置
- **后台任务在对话外可见** —— 侧栏活跃计数 + 完成时的静默药丸
- 首页示例改**两级**（类别 → 具体建议），每条建议都是完整可跑的一句话
- 思考过程改无框旁注；Composer 聚焦改轻阴影；Team 卡片完成即折叠

**代码检索（RAG）**

- embedding 配置现在对 agent 全链路生效（此前只有面板读得到）
- 索引改**并发**（默认 8 路）+ 429/5xx 自动重试；部分失败**不再静默**，会报告失败块数与文件数

**其他修复**

- 审计列表跨天读取（此前只看今日）
- 事件流 sessionId 一致性 —— 修复审批与流式事件在轮次开始后错配
- 思考型模型 `reasoning_content` 回传（不回传会导致下一轮 400）
- 快照：补上只读快照能力，`revert_turn` 的审批不再是盲批

---

### 已知限制

| 项 | 说明 |
|---|---|
| **安装包未签名** | 每次首次运行触发 SmartScreen。根治需 Authenticode 证书。 |
| **Petdex 桌宠在线安装不可用** | `npxSearchDirs` 按 `:` 切 PATH（Windows 用 `;`）、只找 `npx` 不找 `npx.cmd`。点安装会明确报错。**导入本地图片/精灵包不受影响。** |
| **桌宠跨虚拟桌面常驻** | Windows 无官方 API。 |
| **桌宠不抢焦仅 x64 精确** | ia32 自动降级为 `focusable:false`；FFI 失败同样降级，不会崩。 |
| **编辑器探测范围** | 只按已知安装路径找；自定义安装目录、注册表安装不覆盖。 |
| **命令沙箱** | macOS Seatbelt 专有，Windows/Linux 无对应机制，仅命令黑名单生效。 |
| **CLI 无 `wraith` 短命令** | mac 上那个是本机 shell 包装脚本，不随仓库分发。Windows 用 `java -jar`。 |

---

### 遇到问题

请附上：哪一步、完整报错栈、能否复现。

主窗起来但显示后端未连接、发消息报没有 API Key 等常见情况，[`docs/windows-usage.md`](https://github.com/JavaLyHn/wraith/blob/feat/windows-parity-block1/docs/windows-usage.md) 第 5 节有对照表。
