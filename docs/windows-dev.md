# Windows:开发、打包与**完整验收清单**

> 🧭 **找错门了?** 这份是**验收清单**,给验证这个端口的人用的。
> 如果你只是想在 Windows 上**把 wraith 用起来**(装包 / 配模型 / 界面导览 / 出问题怎么查),
> 请看 [`windows-usage.md`](windows-usage.md)。

> **当前状态(诚实版)**:Java 内核与渲染层本就跨平台,平台专属代码只集中在少数几处(窗口 chrome / 终端 shell / 编辑器打开 / spawn java / 桌宠 FFI / 打包)。Windows 对等块 1–6 均已**实现**,但 **截至本文档更新为止,以上绝大部分从未在真 Windows 机器上运行过** —— mac 侧全绿(Java 1810 用例 0F/0E、桌面 1227 用例 / 143 文件、tsc 0、E2E 55+1)不等于 Windows 能跑。**本批风险最高的是第 5.1 节的命令沙箱**:AppContainer 的 Win32 调用序列、管道 DACL、icacls 授权、工具链可读性在 mac 上原理性无法验证。本清单就是用来还这笔验证债的。
>
> 逐条打勾即可;每条给了**预期**和**翻车时最可能的原因**,便于你现场判断是环境问题还是真 bug。

---

## 0. 前置(均需在 PATH)

| 检查 | 命令 | 预期 |
|---|---|---|
| JDK 17 | `java -version` | 17.x |
| Maven | `mvn -v` | 能输出版本 |
| Node ≥ 18 | `node -v` | v18+ |
| (打包才需)jlink | `jlink --version` | 随 JDK 自带 |

- [ ] 四项前置齐备

---

## 1. 后端:构建与测试

```powershell
# 仓库根
mvn clean package -DskipTests
mvn -DskipTests=false test        # ⚠ 本仓库测试默认跳过,必须显式打开
```

- [ ] `mvn clean package -DskipTests` 成功,产出 `target\wraith-1.0-SNAPSHOT.jar`
- [ ] `mvn -DskipTests=false test` 全绿(mac 基线:**1810 tests / 0 failures / 0 errors**)

**重点关注这几个类**(它们最可能暴露 Windows 与 POSIX 的语义差异):

- [ ] `AtomicFileMoveTest` —— tmp→target 原子改名 + Windows 锁重试策略
- [ ] `AutomationStoreConcurrencyTest` —— **48 线程**并发压 `writeAtomic`(整个套件里对文件系统压力最大的一个)
- [ ] `AutomationToolsTest` / `AutomationDefaultDirTest` —— `%USERPROFILE%\.wraith` 目录解析
- [ ] `MemoryToolsTest` —— 记忆库与候选库(两套独立目录)
- [ ] `SessionStore` 相关用例 —— 会话落盘走同一条原子写路径

> **翻车最可能的原因**:Windows 上目标文件被杀软/索引器短暂占用 → `AccessDeniedException`。已加 5 次有界重试(20/40/60/80ms)。若仍失败,说明占用超过 200ms,请记下报错栈,这是需要调大退避的真实信号 —— **不要**当成 flake 重跑了事。

**短命令**(`scripts\windows\wraith-install.ps1`,**须新开终端**才生效)

- [ ] 在**仓库根**跑 `powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1`,结尾打印「已把 …\scripts\windows 加入用户 PATH」+「已安装 -> …\.wraith\wraith.jar」
- [ ] **新开**终端:`where.exe wraith` 指到 `wraith.cmd`
- [ ] `wraith -h` 打印用法(**不需要 jar 也能打印** —— help 分支在 jar 检查之前)
- [ ] 重复跑一次 install:打印「PATH 里已有 …」而**不是**把同一段追加第二遍
- [ ] 临时把 `%USERPROFILE%\.wraith\wraith.jar` 改名 → `wraith` 报「还没安装 jar」并指向 `wraith-install`(不是 java 的堆栈)

**终端 CLI**

- [ ] `wraith` 能起(没装短命令则 `java -jar target\wraith-1.0-SNAPSHOT.jar`)
- [ ] 开场动画 + banner + 输入提示符都在
- [ ] 敲 `/` 弹命令列表,Tab 补全可用
- [ ] 发一条消息有**流式**回复
- [ ] 让它读一个文件 → 弹 HITL 审批 → 批准后有内容
- [ ] `/model` / `/context` / `/policy` 各有输出
- [ ] `/exit` 干净退出(不留孤儿 java 进程:`Get-Process java`)
- [ ] 退出后 `wraith -c` 能接上刚才那次会话;`wraith -r` 列得出历史
- [ ] **配置共享**:桌面里配的 key,CLI 直接可用(反之亦然,同一份 `%USERPROFILE%\.wraith\config.json`)

**参数分流**(启动器只截 `-d`/`-h`,其余透传)

- [ ] `wraith -d` 起的是桌面 dev,**不是** CLI
- [ ] `wraith sandbox doctor` 走到 doctor,不是进 REPL
- [ ] 在仓库外的目录敲 `wraith -d` → 仍能起(靠脚本自身位置反推仓库根);设 `WRAITH_REPO` 也能起

> ⚠ **CLI 不套命令沙箱**(`setCommandSandbox` 只在 app-server / gateway / automation 三处调用)。
> 所以 §5.1 那批围栏用例**必须在桌面里验**,在 CLI 里验会全部"通过"——因为压根没有围栏在拦。

---

## 2. 桌面:开发态启动

```powershell
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1   # 构建并放 jar 到 %USERPROFILE%\.wraith\wraith.jar
cd desktop
npm install --legacy-peer-deps     # ⚠ 必须带,见下
npm run dev
```

- [ ] `dev-win.ps1` 跑通,`%USERPROFILE%\.wraith\wraith.jar` 存在且时间戳是刚才
- [ ] `npm install --legacy-peer-deps` 成功(含 node-pty 原生二进制)
- [ ] `npm run dev` 起得来,主窗出现
- [ ] 顶部/状态区显示**后端已连接**

> `--legacy-peer-deps` 是必须的:`@lobehub/icons`→`@lobehub/ui` 有 react 18 vs 19 的 peer 冲突,干净 checkout 上普通 `npm install` 会 ERESOLVE 失败。
> **后端连不上时**:主进程是 `spawn('java', ['-jar', %USERPROFILE%\.wraith\wraith.jar, 'app-server'])` —— 先确认 `java` 在 GUI 进程的 PATH 里(GUI 应用不继承登录 shell 的 PATH,这是 Windows 上的常见坑)。

---

## 3. 窗口外壳与视觉(平台专属,mac 与 Windows 是两套)

Windows 走 `frame:false` 无边框 + 渲染层自绘窗控;mac 走交通灯 + vibrancy 磨砂。**皮肤也不同**:mac 有 `html.is-mac` 的半透明侧栏,Windows 走实色(无 vibrancy,这是有意设计,不是缺样式)。

- [ ] 主窗**无系统标题栏**,整窗是自绘表面
- [ ] 顶条右上角有 最小化 / 最大化 / 关闭 三键
- [ ] 三键各自点击都生效
- [ ] 最大化后图标变「还原」,还原后变回「最大化」
- [ ] 双击顶条空白处能 最大化 / 还原
- [ ] 关闭键悬停变红
- [ ] 拖顶条空白处能移动窗口
- [ ] 顶条左侧**没有**为 mac 交通灯预留的 80px 空白(Windows 应是 `pl-2` 紧凑)
- [ ] 侧栏/正文是**实色**背景,不透明、无穿透感,对比度正常(深浅色主题各看一次)
- [ ] 窗口圆角/阴影无异常(Windows 未设 transparent,首帧不应白闪)

---

## 4. 会话栏 + 左侧工具栏(**零平台分支,两端同一份代码** —— 这里出问题就是真 bug)

- [ ] 发消息、流式回复正常
- [ ] 侧栏折叠/展开正常,折叠图标形态正确(无重叠竖线)
- [ ] 左侧 11 个面板**逐个能打开且不报错**:
  - [ ] MCP(plugins) - [ ] 自动化 - [ ] IM 网关 - [ ] Provider 配置
  - [ ] 技能 - [ ] 记忆 - [ ] 快照 - [ ] 后台任务
  - [ ] 安全 - [ ] 浏览器 - [ ] 代码检索
- [ ] 三种执行模式(ReAct / Plan / Team)各跑一次,均有产出
- [ ] 切换模式后追问「我刚问了什么」能答上来(跨模式上下文)

### 4.1 界面新面(这批 UI 晚于本清单初版,Windows 上一次都没渲染过)

**首页空态(两级示例)**

- [ ] 新会话首页显示四组:了解这个项目 / 改进代码 / 排查问题 / 写文档
- [ ] 点一组 → 展开三条具体建议 + 「‹ 返回」
- [ ] 点一条建议 → **完整**句子填进输入框(不是半句、不以冒号收尾)
- [ ] 点「返回」能回到四组重选

**账户行(侧栏最底)**

- [ ] 底部是头像 + 昵称一行,右侧齿轮**常驻可见**(不靠 hover 才出现)
- [ ] 点进去是设置(我 / 界面 / 宠物 / 关于)
- [ ] 未设昵称与头像时**不出现「我 我」**这类重复字(glyph 与昵称去重)

**后台任务计数**

- [ ] 挂一个后台任务 → 侧栏「后台任务」右侧出现数字
- [ ] 把工具组收起 → 数字冒到「工具」标题上(收起不该等于看不见)
- [ ] 任务跑完 → 对话里出现一颗药丸,点它跳「后台任务」面板
- [ ] 在**全新会话**(还没发过消息的首页空态)里任务跑完,药丸**照样出现**

**顶栏沙箱盾**(平台专属,mac 与 Windows 预期**不同**)

- [ ] 盾显示为**中性墨色打勾盾**,tooltip 含「AppContainer」与「已断网」
- [ ] 进「安全」面板拨开「命令沙箱联网」→ **顶栏盾当场变成橙色半盾**,tooltip 变「已放行网络」
- [ ] 再拨回去 → 盾变回浅墨打勾盾(这条是 2026-08-02 修的:此前盾是开机快照,拨开关毫无反应)
- [ ] 盾**若是红色「沙箱未启用」** = AppContainer 没起来 → 跑 `wraith sandbox doctor` 查缺失项(见 §5.1)
- [ ] 点盾能进「安全」面板
- [ ] 在面板页(非对话页)盾仍在;终端/右栏两键则正确收起

> **这条预期在 2026-08-02 反过来了。** 旧版清单写的是「中性墨色 + 当前平台无沙箱,红色即为 bug」——
> 那是 Windows 还没有沙箱实现时的口径。现在 Windows 有 AppContainer,后端直接回
> `capabilities.sandbox='windows-appcontainer'`,**红色不再是 bug,而是「本该有却没起来」的真告警**。
> 渲染层的 `platform` 反推也随之收窄到只用于区分 Linux(确实没有实现)。

---

## 5. 平台专属路径(Windows 与 mac 走不同代码)

- [ ] **终端面板**能打开、能敲命令 —— Windows 用 `COMSPEC`(通常 cmd),缺失时回退 `powershell.exe`
- [ ] 终端里中文/路径显示正常,无乱码
- [ ] **「用应用打开」**能列出已装编辑器(VS Code / Insiders / Cursor / Sublime Text / Notepad++),点击能用该编辑器打开文件
  - 探测按**默认安装路径**;自定义目录 / 注册表安装**不覆盖**(已知限制,不算 bug)
- [ ] 文件路径显示为 Windows 形式(反斜杠),点击可打开
- [ ] 项目切换、目录选择对话框正常

### 5.1 `execute_command` 与命令沙箱(**本批全新,风险最高**)

> 这批全部**未经真机验证**——作者没有 Windows 机器。Win32 调用序列、管道 DACL、
> icacls 授权、工具链可读性只能在这里验出来。**任一条不过请把整段输出发出来。**

**先跑体检**(所有后续条目的前提):

```cmd
wraith sandbox doctor
```

- [ ] 四条前置全 ✔(平台 / Windows 版本 / powershell.exe / 发射器脚本)
- [ ] 探针 `stdio 管道` ✔ —— **最可能翻车的一环**。若报「退出码 0 但没拿到输出」,是管道 DACL 没授给 AppContainer
- [ ] 探针 `工作区内可写` ✔
- [ ] 探针 `工作区外拒写` ✔(显示"已被拦截") —— 显示"本应被拦截却成功了"= 写围栏没生效
- [ ] 探针 `断网` ✔(显示"已被拦截") —— 显示"本应被拦截却成功了"= 断网没生效
- [ ] doctor 退出码为 0

**基本执行**(此前 Windows 上写死 `bash -c`,而 Git for Windows 默认不把 `bash.exe` 放进 PATH):

- [ ] 聊天里让 agent 跑 `dir`,能拿到输出(不是 `CreateProcess error=2`)
- [ ] 跑一条有中文输出的命令,**不乱码**(JEP 400 之后默认编码变 UTF-8,而 cmd 吐的是本地代码页)
- [ ] 跑 `npm -v` / `git --version` 之类工具链命令,能正常执行
- [ ] 跑一条长命令(如 `npm install`)不因沙箱 ACL 缺失而失败

**围栏语义**:

- [ ] 让 agent 往工作区外写文件(如 `%USERPROFILE%\x.txt`),被拒
- [ ] 让 agent 改 `.git` 里的文件,被拒
- [ ] 面板「命令沙箱联网」开关**可点**(不再灰着),顶栏盾随它在浅墨打勾盾/橙色半盾之间切换
- [ ] 关着开关时 agent 联网命令失败;打开后成功
- [ ] 沙箱不可用时(可临时改名发射器脚本模拟):顶栏盾变红、面板显示具体缺失原因、**命令仍能执行**(fail-open 不阻断)

**命令黑名单**(此前九条全是 POSIX 词汇,Windows 上形同虚设):

- [ ] 让 agent 执行 `rd /s /q C:\`,被黑名单拒(不进审批弹窗)
- [ ] 让 agent 执行 `format C:`,被拒
- [ ] 让 agent 执行 `Remove-Item -Recurse -Force $env:USERPROFILE`,被拒
- [ ] **误杀检查**:`rd /s /q build`、`del target\classes\x.class`、`icacls C:\wraith-test`(不带 `/T`)**不被拦**

**超时清理**:

- [ ] 让 agent 跑一条超 60 秒的命令,超时后用任务管理器确认**子孙进程也没了**(此前只杀直接子进程)

**撤销**(验完清理机器):

- [ ] 按 `docs/windows-usage.md` §6.5「撤销」把 ACL 和临时目录清掉

---

## 6. 第 26 期新增 ①:自我认知 + 动作卡(mac 已验,Windows 未验)

> 这三条是纯事件流 + React,理论上与平台无关;列出来是为了确认「mac 上刚做完的东西在 Windows 上同样在」。

- [ ] 问「**Wraith 有哪些 IM 集成?**」→ 回答列出 QQ/飞书/企业微信/微信,**不会**去 grep 你的项目代码
- [ ] 问「**怎么配 MCP?**」→ 出现可点的「🧭 打开 MCP 面板」动作卡,点击真的跳到该面板
- [ ] **ReAct 模式**问「怎么接微信」→ 出现 IM 接入卡
- [ ] **Plan 模式**同样问 → **动作卡同样出现**(这是本次修的核心 bug:此前只有 ReAct 出卡)
- [ ] **Team 模式**同样问 → **动作卡同样出现**
- [ ] 微信接入卡:点「扫码绑定微信」后卡内**内联出现二维码**(不点不会自动开始绑定)
- [ ] QQ 接入卡:点击后**打开系统浏览器**授权页,卡内显示状态(QQ 无内联二维码,这是设计)
- [ ] 飞书/企业微信接入卡:显示「打开 IM 网关面板」按钮,点击跳转
- [ ] 绑定进行中出现「取消」,点击能取消
- [ ] 同时挂两张接入卡时,**未点击**的那张不显示状态、不出现取消按钮

> **Windows 专属风险点**:IM 绑定要 spawn `java.exe`(`gatewayManager.ts` 已按平台选 `java.exe`/`java`)。若卡在「二维码生成中…」,先查 GUI 进程能否找到 `java`。

---

## 7. 第 26 期新增 ②:三件套工具(聊天里直接操作面板功能)

**自动化(cron)**
- [ ] 说「**每天早上 9 点帮我跑一遍测试**」→ 弹 HITL 审批 → 批准后创建成功
- [ ] **打开左侧「自动化」面板,能看到刚才聊天里建的任务**(这条最关键:验证 `%USERPROFILE%\.wraith\automations.json` 两条路径口径一致)
- [ ] 说「列出定时任务」→ 列表与面板一致
- [ ] 说「把那个任务改个名字」→ 只改名,**prompt 与排程保持不变**
- [ ] 说「删掉那个定时任务」→ 弹审批 → 面板里消失
- [ ] 说「立刻跑一次」→ 回复中**明确说明**需要守护进程运行才会真执行(未起守护时只排队,不算失败)

**后台任务**
- [ ] 说「**把这个挂后台跑**」→ 弹 HITL 审批 → 返回任务 id
- [ ] 说「后台任务怎么样了」→ 列出任务与状态
- [ ] 「后台任务」面板里能看到同一条
- [ ] 说「取消那个后台任务」→ 成功

**后台任务面板:删除与重试**(2026-08-02 新增)
- [ ] 终态记录(已完成/失败/已取消)行尾有**垃圾桶**键;运行中/排队中**没有**(只有 ✕ 取消)
- [ ] 点垃圾桶 → 该条消失,刷新后不回来(删除落到 SQLite,持久)
- [ ] 只删被点的那条,邻居不动
- [ ] 失败的记录点 **⟲ 重试** → 新任务入队,**原那条同时消失**(顶替,不是并存)
- [ ] 重试失败时(比如把后端停掉)→ 原记录**留在原地**,并显示原因

**记忆**
- [ ] 说「**你记得我什么**」→ 列出长期记忆
- [ ] 说「搜索记忆里关于 X 的」→ 有结果
- [ ] 说「**忘掉某条**」→ 弹 HITL 审批 → 批准后记忆面板里消失
- [ ] 说「有哪些待确认的记忆候选」→ 列出(无候选时明确说「没有」,不报错)
- [ ] 批准/驳回某条候选 → 记忆面板同步

**闸门**
- [ ] 高危写(建/删/立刻跑 自动化、挂后台任务、删记忆)**都弹了审批**
- [ ] 只读(列/搜/查)**都没弹**审批

---

## 8. IM 网关(需真账号,可选)

- [ ] IM 网关面板能打开,平台列表正常
- [ ] 微信扫码绑定跑通(spawn `java.exe ... gateway bind-weixin`)
- [ ] QQ 扫码绑定跑通(会开系统浏览器)
- [ ] 飞书/企业微信填密钥后能保存(密钥不回显)
- [ ] 启动/停止网关守护进程正常,日志可见

---

## 9. 桌宠

- [ ] 开启桌宠后 App 不崩,宠物出现在桌面
- [ ] 单击/拖动桌宠**不打断**你在其它应用里的操作(`WS_EX_NOACTIVATE` via koffi FFI)
- [ ] 拖动、滚轮缩放、右键菜单正常
- [ ] 透明区域点击能穿透到桌面
- [ ] 关闭桌宠后 App 不崩

---

## 10. 打包与安装版

```powershell
mvn -q clean package -DskipTests        # 仓库根
cd desktop
npm install --legacy-peer-deps
npm run dist:win                        # 产物:desktop\release\*.exe
```

- [ ] `npm run dist:win` 成功(内部会 `jlink` 造捆绑 JRE + 复制 jar 到 `resources/`)
- [ ] `desktop\release\` 下有 `*.exe` NSIS 安装包
- [ ] 双击安装:向导式、可选安装目录、创建桌面/开始菜单快捷方式
- [ ] SmartScreen 报「未知发布者」→「更多信息 → 仍要运行」能装(**未签名,属预期**)
- [ ] 装完从开始菜单/桌面快捷方式能启动
- [ ] **安装版**(非 dev)核心功能通:聊天 / 终端 / 记忆 / 窗控 / 编辑器打开
- [ ] 安装版后端用的是**捆绑 JRE**(`resources\runtime\bin\java.exe`),即使机器没装 JDK 也能跑

---

## 11. 已知限制 / **预期失败**(勾上表示"确认是这个已知情况",不是 bug)

- [ ] **Petdex 桌宠安装在 Windows 不可用** —— `npxSearchDirs` 按 `:` 切 PATH(Windows 是 `;`)、只找 `${dir}/npx` 不找 `npx.cmd`(代码注释已写明「本项目 macOS-only,不处理 .cmd」)。表现:点安装后**明确报错**(不是静默失败)。导入本地图片/精灵包不受影响。
- [ ] 桌宠**跨虚拟桌面**常驻做不到(Windows 无官方 API)
- [ ] `WS_EX_NOACTIVATE` 仅 **x64** 精确;ia32 自动降级为 `focusable:false`
- [ ] 编辑器探测不覆盖**自定义安装目录 / 注册表安装**
- [ ] 沙箱**首条命令慢 1–2 秒** —— PowerShell 发射器要 `Add-Type` 就地编译 C# P/Invoke,之后有缓存
- [ ] 沙箱把工作区授权给 AppContainer SID 时会**改文件 ACL**,面板里关掉沙箱**不会自动撤销**(撤销方式见 windows-usage.md §6.5)
- [ ] 装在用户目录下的工具链(如 `%APPDATA%\npm`)AppContainer **读不到**,需手工 `icacls` 授权;`C:\Windows` 与 `C:\Program Files` 默认已开放
- [ ] 工作区在**非 NTFS / 网络盘**上时 `icacls` 会失败 → 沙箱降级为无
- [ ] 安装包**未签名**(根治需 Authenticode 证书)
- [ ] GitHub Release 目前**只发了 mac 版**(v1.3.0 dmg/zip);Windows 版需自行 `dist:win`

---

## 12. 发现问题怎么记

请把以下信息一并记下,便于定位:

1. 哪一条勾失败
2. 完整报错(尤其 Java 栈:是 `AccessDeniedException` 还是别的)
3. 是 dev 态还是安装版
4. `java -version` 与是否在 GUI 进程 PATH 中

**优先级判断**:第 1、2、10 节失败 = 阻塞(基础跑不起来);第 6、7 节失败 = 第 26 期新功能在 Windows 上的真 bug;第 3、5 节失败 = 平台外壳问题;第 11 节 = 已知,不用报。
