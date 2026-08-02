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
- **命令沙箱（AppContainer）** —— agent 执行的命令关进 Windows 自带的 AppContainer：**默认断网**（不给 `internetClient` 能力，内核级拒绝）+ **写限工作区** + `.git` 只读。顶栏盾正常态显示「沙箱: AppContainer」；起不来时变红并在安全面板给出具体缺失项。跑 `wraith sandbox doctor` 可四条探针逐项体检。
- **`execute_command` 在 Windows 上真的能跑了** —— 此前它在所有平台写死 `bash -c`，而 Git for Windows 默认不把 `bash.exe` 放进 PATH。同批修掉：命令黑名单补 Windows/PowerShell 形状规则（此前九条全是 POSIX 词汇，`rd /s /q C:\`、`format`、`reg delete` 一条不拦）、超时连同子孙进程整棵杀、子进程输出按 OS 本地编码解码（JDK ≥18 上中文原本必乱码）。

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
| **沙箱首条命令慢 1–2 秒** | PowerShell 发射器要 `Add-Type` 就地编译 C# P/Invoke，之后走缓存。 |
| **沙箱会改工作区文件 ACL** | 授权给 AppContainer SID。**面板里关掉沙箱不会自动撤销**，撤销方式见 `docs/windows-usage.md` §6.5。 |
| **用户目录下的工具链读不到** | 装在 `%APPDATA%\npm` 之类位置的工具 AppContainer 读不到，需手工 `icacls` 授权；`C:\Windows` 与 `C:\Program Files` 默认已开放。 |
| **非 NTFS / 网络盘上无沙箱** | `icacls` 会失败，沙箱降级为无（命令仍可执行，面板显示原因）。 |
| **Linux 无命令沙箱** | Seatbelt 是 macOS 专有、AppContainer 是 Windows 专有，Linux 暂无对应实现（bubblewrap 未做）。 |

---

### 遇到问题

请附上：哪一步、完整报错栈、能否复现。

主窗起来但显示后端未连接、发消息报没有 API Key 等常见情况，[`docs/windows-usage.md`](https://github.com/JavaLyHn/wraith/blob/feat/windows-parity-block1/docs/windows-usage.md) 第 5 节有对照表。
