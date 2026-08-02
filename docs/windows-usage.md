# Windows 使用教程

> 从 **`git clone` 一路到能对话**的完整步骤。每步都给了**预期产出**，不对就停下看第 5 节。
>
> 仓库里另有两份 Windows 文档，分工不同，**别拿错**：
>
> | 文档 | 是什么 | 什么时候看 |
> |---|---|---|
> | 本文 `windows-usage.md` | **从零到跑起来 + 怎么用** | 你要用 wraith |
> | [`windows-release.md`](windows-release.md) | 出包与发布 runbook | 你要出一个可分发的安装包 |
> | [`windows-dev.md`](windows-dev.md) | 逐条**验收清单**（102 勾） | 你要验证这个端口有没有做对 |
>
> **诚实声明**：Windows 端代码已完成，但**尚未在真 Windows 机器上跑过一次**。本文按代码实际行为编写，若你遇到与本文不符的情况，那大概率是真 bug，欢迎照第 5 节的排查方向记录下来。

> ### ⚠️ 先确认你在 PowerShell 里，不是 cmd
>
> 本文所有命令按 **PowerShell** 写。看提示符就能分辨：
>
> | 提示符 | 是什么 | 能否照抄本文 |
> |---|---|---|
> | `PS D:\wraith>` | PowerShell | ✅ |
> | `D:\wraith>` | cmd.exe | ❌ 部分命令不存在 |
>
> 在 cmd 里敲 `powershell` 回车即可切换（目录不变）。
>
> **两者最容易咬人的差异**：
>
> | 用途 | PowerShell | cmd |
> |---|---|---|
> | 环境变量取值 | `$env:LOCALAPPDATA` | `%LOCALAPPDATA%` |
> | 删目录 | `Remove-Item -Recurse -Force x` | `rmdir /s /q x` |
> | 设环境变量 | `$env:FOO = "v"` | `set FOO=v` |
>
> 尤其注意第一行：在 cmd 里跑带 `$env:` 的命令**不会报错**，而是把 `$env:LOCALAPPDATA` 当普通字符串原样传下去 —— 比如 `npm config set cache "$env:LOCALAPPDATA\npm-cache"` 会真的把缓存设到一个叫 `$env:LOCALAPPDATA` 的目录。静默走偏，比报错难查。

---

## 0. 全程一眼

```
前置(JDK17/Maven/Node)  →  git clone  →  ⚠ 切到 feat/windows-parity-block1
                                              │
                        ┌─────────────────────┴─────────────────────┐
                   路线 A 开发态                              路线 B 装包
                   (最快跑起来)                              (要一个能分发的 exe)
                   dev-win.ps1                               mvn package
                   npm install                               npm install
                   npm run dev                               npm run dist:win → 装
                        └─────────────────────┬─────────────────────┘
                                              ↓
                                    配一个模型(第 2 节)
                                              ↓
                                        发第一条消息
```

只想跑起来看看 → **路线 A**。想要一个能给别人的安装包 → **路线 B**。

---

## 1. 从零到跑起来

### 1.1 前置

```powershell
java -version    # 期望 17.x
mvn -v           # 能输出版本
node -v          # v18+
git --version
```

四项都要在 PATH 里。缺 JDK 17 就先装 JDK 17 —— 仓库按 Java 17 编译。

> 只走**路线 B 装完之后**用 App 的人不需要 Java（安装包捆绑了 JRE）。但**构建**这一步需要。

### 1.2 拉代码 —— ⚠ 必须切分支

```powershell
git clone https://github.com/JavaLyHn/wraith.git
cd wraith
git checkout feat/windows-parity-block1
```

**这一步不能省。** Windows 的活还没合进 `main` —— `main` 上**一个 Windows 专属文件都没有**（没有自绘窗控、没有 `dev-win.ps1`、没有 NSIS 打包配置）。停在 `main` 上你能把项目构建出来，但拿到的是一个没有任何 Windows 对等的东西，而且不会有任何报错提示你走错了。

> **这里用的是 HTTPS，不是 SSH。** 本仓库是公开的，HTTPS 拉取不需要任何认证配置。
> 若你改用 `git@github.com:...` 而报 `ssh: connect to host github.com port 22: Connection refused`，
> 那是 22 端口被网络挡了（公司网/校园网/部分 ISP 常见）。要么换回 HTTPS，要么让 SSH 走 443：
>
> ```
> # %USERPROFILE%\.ssh\config
> Host github.com
>   HostName ssh.github.com
>   Port 443
>   User git
> ```
>
> 之后若要 **push**，HTTPS 配合 Git for Windows 自带的 Credential Manager 最省事 —— 首次推送会弹浏览器授权，之后自动记住。

确认一下：

```powershell
git branch --show-current      # 期望 feat/windows-parity-block1
dir desktop\scripts\dev-win.ps1   # 这个文件在，就说明分支对了
```

---

### 路线 A：开发态跑起来（最快）

#### A1. 备后端 jar

```powershell
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
```

它做两件事：在仓库根跑 `mvn -q clean package -DskipTests`，然后把产物拷到 `%USERPROFILE%\.wraith\wraith.jar`（桌面 dev 态就是从这个固定位置起后端的）。

- [ ] 结尾打印 `dev-win: 已安装 -> C:\Users\<你>\.wraith\wraith.jar`，并列出文件大小与时间戳

> `-ExecutionPolicy Bypass` 是必须的，否则默认策略会拒绝执行未签名的 .ps1。
> 脚本取的是 `target\wraith-*.jar` 里**最大**的那个（shade 后的可执行包，`original-*` 不匹配这个通配）。

#### A2. 装前端依赖

```powershell
cd desktop
npm install --legacy-peer-deps
```

- [ ] 装完无 ERESOLVE 报错

> `--legacy-peer-deps` **不能省**：`@lobehub/icons` → `@lobehub/ui` 有 react 18 vs 19 的 peer 冲突，干净 checkout 上普通 `npm install` 会直接失败。

#### A3. 起

```powershell
npm run dev
```

- [ ] 主窗出现，**无系统标题栏**，右上角是自绘的 最小/最大/关闭 三键
- [ ] 界面不报「后端未连接」

> **报后端未连接**：dev 态主进程跑的是 `spawn('java', ['-jar', '%USERPROFILE%\.wraith\wraith.jar', 'app-server'])`，走**系统 PATH** 找 `java`。GUI 应用不继承登录 shell 的 PATH —— 这是 Windows 上的经典坑。确认 `java` 在系统级 PATH 里，改完**重启终端再 `npm run dev`**。

改完 Java 代码要重跑 A1（dev 态起的是 `%USERPROFILE%\.wraith\wraith.jar`，不是 `target\` 里那个）。改前端代码则热更新，不用管。

**跳到第 2 节配模型。**

---

### 路线 B：出安装包并安装

```powershell
# 仓库根
mvn clean package -DskipTests       # 产出 target\wraith-1.0-SNAPSHOT.jar
cd desktop
npm install --legacy-peer-deps
npm run dist:win                    # 产物：desktop\release\Wraith Setup <版本>.exe
```

出包后**立刻验一件事**：

```powershell
desktop\resources\runtime\bin\java.exe -version
```

- [ ] 能跑，输出 17.x。报「不是有效的 Win32 应用程序」或文件不存在 = 打进去的是别的平台的 JRE，包是废的

> 必须在 **Windows 机器**上出 Windows 包。捆绑 JRE 由宿主 `jlink` 产出、`node-pty` 是原生模块，都不能交叉。在 mac 上跑 `npm run dist:win` 会被脚本硬拦下（退出码 1）。

双击 `desktop\release\Wraith Setup <版本>.exe`：

- SmartScreen 拦一下，报**「Windows 已保护你的电脑 / 未知发布者」**——安装包**未签名**（根治需 Authenticode 证书）。点**「更多信息」→「仍要运行」**。
- 向导式安装，可改安装目录，会建**桌面**和**开始菜单**快捷方式。
- 从开始菜单启动。

#### 装完之后不需要再装 Java

安装包**捆绑了 JRE**（`resources\runtime\bin\java.exe`）和后端 jar。用装好的 App 的人**不需要**系统里有 JDK —— 前面那套 JDK/Maven/Node 只是**构建**时要的。也因此路线 B 装完后不会遇到路线 A 那个 PATH 坑。

---

## 2. 首次启动：配一个模型

启动后 wraith 还不能对话 —— 它不知道用哪个模型、拿什么密钥。**有三条路，桌面用户走第一条就行。**

### ① 图形界面配（推荐）

1. 左侧栏找到 **配置 → Provider 配置**
2. 搜索或在列表里挑一个 provider（GLM / DeepSeek / Kimi / StepFun / 讯飞星辰 …），点 **＋配置**
3. 多数 provider 卡片右上角有 **「获取密钥 →」** 链接，直接跳该家控制台去申请
4. 填 **API Key**（必填）、**模型**、**Base URL**（多数有默认值，不用改）
5. 点 **「测试连接」** —— 成功显示 `✓ 连接成功 · 模型名 · 延迟ms`；失败显示 `✗` 加后端原文错误
6. 点 **「保存」**。回到列表后，若这张卡片上有 **「设默认」** 就点一下（已经是默认的卡片不显示这个按钮）

配置落到 `%USERPROFILE%\.wraith\config.json`。**密钥不会出现在日志或任何回包里**，界面回读时只告诉你「已配置」，不回明文。

### ② 放一个 `.env` 到用户目录

后端找 `.env` 的顺序是**当前工作目录**，然后是**用户目录**：

```java
File[] envFiles = { new File(".env"), new File(System.getProperty("user.home"), ".env") };
```

从开始菜单启动的 App，工作目录是安装目录**不是仓库**，所以仓库里那个 `.env` 它看不见。要走这条路，请放到：

```
%USERPROFILE%\.env
```

内容就是 `KEY=VALUE`，一行一条：

```
GLM_API_KEY=你的key
```

### ③ PowerShell 环境变量

⚠ README 快速开始里写的是 `export GLM_API_KEY=...` —— 那是 bash 语法，**在 PowerShell 和 cmd 里都不存在**。Windows 上要这样写：

```powershell
# 只对当前 PowerShell 会话有效（关掉窗口就没了）
$env:GLM_API_KEY = "你的key"

# 永久写入当前用户（新开的进程才读得到，已开的 App 要重启）
[Environment]::SetEnvironmentVariable('GLM_API_KEY', '你的key', 'User')
```

cmd.exe 里则是 `set GLM_API_KEY=你的key`（当前窗口）／`setx GLM_API_KEY "你的key"`（永久）。

> 注意环境变量是**进程启动时**读的。从开始菜单启动的 App 不会看到你之后才设的变量 —— 设完要重启 App。这也是为什么**推荐走 ① 图形界面**：改完即时生效，不牵扯进程环境。

---

## 3. 发第一条消息

回到对话页，首页会给你四组入口：**了解这个项目 / 改进代码 / 排查问题 / 写文档**。点一组会展开三条具体建议，每条都是一句完整、当场能跑的话，点一下填进输入框，回车发送。

想直接打字也行 —— 那四组只是起点，不是限制。

---

## 4. 认识界面

### 左侧栏

顶部是**项目**与**会话列表**；中间是工具，分三组：

| 组 | 里面有什么 | 干嘛的 |
|---|---|---|
| **配置** | MCP、Provider 配置、技能 | 装东西、接东西 |
| **运行** | 自动化、IM 网关、后台任务 | 让它替你跑 |
| **观察** | 记忆、快照、安全、浏览器、代码检索 | 看它做了什么 |

最底下是**账户行**（头像 + 昵称），点进去是整套设置（我 / 界面 / 宠物 / 关于）。

「后台任务」在跑的时候，右边会显示**正在运行的条数**；工具组收起时这个数字会冒到「工具」标题上，不会因为收起就看不见。

### 顶栏那个盾牌

右上角有个小盾。在 Windows 上它显示 **「当前平台无沙箱」** —— **这是正常的，不是故障。**

命令沙箱用的是 macOS 的 Seatbelt（`sandbox-exec`），Windows 和 Linux 没有对应机制。此时 agent 执行的 shell 命令**仍然受命令黑名单（CommandGuard）保护**，但不在沙箱里跑。点盾牌进「安全」面板可以看审批策略和危险操作审计。

> 如果你在 mac 上看到这个盾变**红**并写着「沙箱未启用」，那才是要处理的异常。

### 顶栏右上角三个键

Windows 主窗是**无边框**的，最小化 / 最大化 / 关闭是 wraith 自绘的（位置和行为跟 Windows 一致，字形是 wraith 的单色墨，关闭键悬停变红）。双击顶栏空白处也能最大化 / 还原，拖顶栏空白处移动窗口。

mac 那种半透明磨砂侧栏在 Windows 上是**实色**，这是有意设计，不是缺样式。

---

## 5. 出问题时

| 症状 | 最可能的原因 | 怎么办 |
|---|---|---|
| `git clone` 报 `ssh: connect to host github.com port 22: Connection refused` | 用了 SSH 形式（`git@github.com:`），而 **22 端口被网络挡了**（公司网/校园网/部分 ISP 常见）；且全新机器也还没配 SSH 密钥 | 本仓库是**公开**的，直接用 HTTPS：`git clone https://github.com/JavaLyHn/wraith.git`，零认证配置。非要用 SSH 就走 443 通道，见下 |
| 装的时候被 SmartScreen 拦 | 安装包未签名 | 「更多信息」→「仍要运行」 |
| App 起来了但显示**后端未连接** | 走的是**开发态**（`npm run dev`），主进程 `spawn('java', …)` 找不到 java | 确认 `java` 在 **GUI 进程**的 PATH 里 —— GUI 应用不继承登录 shell 的 PATH，这是 Windows 上的经典坑。装好的 App 用捆绑 JRE，不该出这个问题 |
| 发消息报没有 API Key | 没配 provider，或配了但没「设默认」 | 回第 2 节 ①，注意最后要点**设默认** |
| 设了环境变量但 App 不认 | 环境变量是进程启动时读的 | 重启 App；或直接改用图形界面配 |
| `npm install` ERESOLVE 失败 | react peer 冲突 | 必须带 `--legacy-peer-deps` |
| `npm install` 报 `EPERM: operation not permitted, mkdir '<某盘>\...\_cacache\...'`，且提示「Log files were not written」 | **npm 写不进自己的缓存目录**，与项目无关。常见于把 npm 全局/缓存目录搬到 Node 安装盘（如 `E:\nodejs\node_cache`）——那目录通常归 Administrators，普通终端只能读 | 见下方「npm 缓存目录没有写权限」 |
| `npm install` 结尾一堆 `npm warn cleanup ... EPERM ... rmdir 'node_modules\...'` | 这是**善后失败**不是病因 —— 安装中途挂了，npm 想回滚删半成品但删不动（有进程占用或杀软扫描） | 先解决真正的报错（看 `npm error` 那几行，不是 `npm warn`），再删干净 `node_modules` 重装 |
| 「用应用打开」找不到编辑器 | 只按已知安装路径探测 | 见下方已知限制 |
| 文件操作偶发 `AccessDeniedException` | 杀软 / 索引器短暂占用目标文件 | 已内置 5 次有界重试（20/40/60/80ms）。**若仍失败请记下报错栈** —— 那说明占用超过 200ms，是需要调大退避的真实信号，不要当 flake 重跑了事 |

---

### npm 缓存目录没有写权限（EPERM）

症状是 `npm install` 报 `EPERM ... mkdir` 指向某个 `_cacache` 路径，往往还跟着一句「Log files were not written」——**连日志都落不下，说明是整个缓存目录不可写**。

先看清楚病因在哪：`npm warn cleanup ... rmdir node_modules` 那一大坨是 npm 装到一半、回滚删不掉半成品留下的**次生现象**，别对着它排查。真正的死因在 `npm error` 那几行的 `path`。

```powershell
# ① 看缓存指向哪
npm config get cache
# 若指向 Node 安装盘(如 E:\nodejs\node_cache),那多半就是元凶

# ② 改到用户目录(必定有写权限,写入 %USERPROFILE%\.npmrc,不需要管理员)
npm config set cache "$env:LOCALAPPDATA\npm-cache"
npm config get cache        # 期望 C:\Users\<你>\AppData\Local\npm-cache

# ③ 清掉不一致的半成品,否则后面会出各种怪事
cd D:\wraith\desktop
Remove-Item -Recurse -Force node_modules

# ④ 重装
npm install --legacy-peer-deps
```

第 ③ 步删不动，一般是有进程占着——关掉编辑器、关掉 cwd 在里面的终端。仍然删不掉就用这招（对付海量小文件和超长路径最快）：

```powershell
mkdir empty_tmp
robocopy empty_tmp node_modules /MIR
Remove-Item -Recurse -Force node_modules, empty_tmp
```

**如果你在 cmd 而不是 PowerShell**（提示符是 `D:\...>` 而非 `PS D:\...>`），同一套操作的 cmd 写法：

```cmd
npm config get cache
npm config set cache "%LOCALAPPDATA%\npm-cache"

cd /d D:\wraith\desktop
rmdir /s /q node_modules

npm install --legacy-peer-deps
```

删不动时的兜底：

```cmd
mkdir empty_tmp
robocopy empty_tmp node_modules /MIR
rmdir /s /q node_modules
rmdir /s /q empty_tmp
```

**建议把仓库目录加进 Windows Defender 排除项**（设置 → 隐私和安全性 → Windows 安全中心 → 病毒和威胁防护 → 管理设置 → 排除项）。`node_modules` 是几万个小文件，实时扫描既让安装慢好几倍，也是那些 `EPERM rmdir` 的常见元凶。

> ⚠️ **不要用「以管理员身份运行」来绕过。** 那会在项目里留下一批 Administrator 所有的文件，之后普通身份的 `npm install` / 删除会持续撞同样的 EPERM，坑更深。

---

## 6. 已知不可用 / 降级

这些是**当前明确不支持**的，不用浪费时间排查：

- **Petdex 桌宠在线安装不可用** —— `npxSearchDirs` 按 `:` 切 PATH（Windows 用 `;`）、只找 `${dir}/npx` 不找 `npx.cmd`。表现是点安装后明确报错。**导入本地图片 / 精灵包不受影响。**
- **桌宠跨虚拟桌面常驻** —— Windows 没有官方 API。
- **桌宠点击不抢焦仅 x64 精确** —— 走 koffi FFI 给窗口加 `WS_EX_NOACTIVATE`；ia32 上自动降级为 `focusable:false`，FFI 失败也会降级，不会崩。
- **编辑器探测范围有限** —— 只按已知安装路径找 VS Code / VS Code Insiders / Cursor / Sublime Text / Notepad++；自定义安装目录、注册表安装不覆盖。
- **命令沙箱** —— 见第 4 节，平台不支持。
- **安装包未签名** —— 每次大版本首次运行都会触发 SmartScreen。
- **CLI 没有 `wraith` 短命令** —— mac 上那个是本机 shell 包装脚本，不随仓库分发。Windows 上直接 `java -jar target\wraith-1.0-SNAPSHOT.jar`。

---

## 7. 只想用命令行

不装桌面 App 也能用，CLI 与桌面共用同一套 Java 内核。**只需要 JDK 17 + Maven**，不需要 Node：

```powershell
git clone https://github.com/JavaLyHn/wraith.git
cd wraith
git checkout feat/windows-parity-block1      # 仍然要切,理由见下
mvn clean package -DskipTests
java -jar target\wraith-1.0-SNAPSHOT.jar
```

> **CLI 也要切分支。** Java 内核确实跨平台，但有一处 Windows 专属修复只在这个分支上：`AtomicFileMove` 给 tmp→target 的原子改名加了有界重试（20/40/60/80ms），应对 Windows 上目标文件被杀软/索引器短暂占用时抛的 `AccessDeniedException`。**会话落盘、技能库、QQ 待发**三处都走它。停在 `main` 上，这些写入在 Windows 会偶发失败。
>
> Windows 上没有 mac 那种 `wraith` / `wraith -d` 短命令（那是本机 shell 包装脚本，不随仓库分发），直接 `java -jar`。

CLI 里可以用 `/config` 写配置、`/model` 切模型，配置同样落 `%USERPROFILE%\.wraith\config.json`，与桌面 App **共享同一份**——在哪边配好，另一边都认。
