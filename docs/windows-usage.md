# Windows 使用教程

> 从 **`git clone` 一路到能对话**的完整步骤。每步都给了**预期产出**，不对就停下看第 6 节。
>
> 仓库里另有两份 Windows 文档，分工不同，**别拿错**：
>
> | 文档 | 是什么 | 什么时候看 |
> |---|---|---|
> | 本文 `windows-usage.md` | **从零到跑起来 + 怎么用** | 你要用 wraith |
> | [`windows-release.md`](windows-release.md) | 出包与发布 runbook | 你要出一个可分发的安装包 |
> | [`windows-dev.md`](windows-dev.md) | 逐条**验收清单**（124 勾） | 你要验证这个端口有没有做对 |
>
> **诚实声明**：Windows 端代码已完成，但**尚未在真 Windows 机器上跑过一次**。本文按代码实际行为编写，若你遇到与本文不符的情况，那大概率是真 bug，欢迎照第 6 节的排查方向记录下来。

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
前置(JDK17/Maven[/Node])  →  git clone  →  ⚠ 切到 feat/windows-parity-block1
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
        路线 A 开发态                    路线 B 装包                    路线 C 只用命令行
        (最快看到桌面)                 (要一个能分发的 exe)            (不需要 Node)
        dev-win.ps1                     mvn package                    mvn package
        npm install                     npm install                    java -jar …
        npm run dev                     npm run dist:win → 装          (第 8 节)
              └───────────────────────────────┼───────────────────────────────┘
                                              ↓
                                    配一个模型(第 2 节)
                                     三条路线共用同一份配置
                                              ↓
                                        发第一条消息
                                              ↓
                              wraith sandbox doctor  ← 建议早跑(第 6.5 节)
                              四条探针,确认沙箱真在拦
```

只想跑起来看看 → **路线 A**。想要一个能给别人的安装包 → **路线 B**。只在终端里用、不想装 Node → **路线 C(第 8 节)**。

> **想要 `wraith` / `wraith -d` 这两条短命令**(而不是每次手打 `java -jar …` / `npm run dev`):
> 在仓库根跑一次 `powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1`,
> 然后**新开一个终端**。三条路线都适用,详见 [§1 A4](#a4-装上-wraith-短命令)。
> 装完 `wraith -h` 能看到全部用法。

> **为什么建议早跑 doctor**：沙箱起不来时 wraith 是 **fail-open** 的 ——
> 命令照常执行、不会报错，只是没有围栏。也就是说**你不主动查，是不会知道的**。
> 顶栏盾会变红，但那容易被忽略。

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
>
> ⚠️ **Node 是个例外：它既是构建依赖，也可能是运行时依赖。** 安装包捆绑 JRE，但**不捆绑 Node**。
> 只要你打算用 `npx` 起 MCP server，装好的 App 也需要系统里有 Node —— 详见第 6 节「加 MCP server 报 `Cannot run program "npx"`」。不用 MCP 则完全不需要。

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

改完 Java 代码要重跑 A1（dev 态起的是 `%USERPROFILE%\.wraith\wraith.jar`，不是 `target\` 里那个）。改前端代码则热更新，不用管。**完整的「改了什么 → 重跑到哪一步」对照表见第 5 节。**

#### A4. 装上 `wraith` 短命令

> 这一步严格说可跳过（`java -jar …` / `npm run dev` 一样能用），但**跳过之后就没有 `wraith` 命令**——
> 直接敲会看到 `无法将"wraith"项识别为 cmdlet、函数、脚本文件或可运行程序的名称`。
> 这一条同时服务路线 A / B / C，建议装。

mac 上有 `wraith`（终端 CLI）和 `wraith -d`（桌面 dev）两条短命令。Windows 也有，装一次：

```powershell
# 必须在仓库根跑（脚本靠自身位置反推仓库）
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
```

它做两件事：构建并安装 jar 到 `%USERPROFILE%\.wraith\wraith.jar`（内部**复用 `dev-win.ps1`**，不是另一套构建逻辑），然后把 `scripts\windows` 加进**用户级** PATH（不需要管理员）。

**必须新开一个终端**，当前窗口读不到新 PATH。之后：

```powershell
wraith              # 终端 CLI（交互式对话）
wraith -d           # 桌面端 dev
wraith -h           # 全部用法（不需要 jar 就能看）
wraith-install      # 改完 Java 后端后重新构建装 jar

wraith -c                    # 接着上一次会话
wraith -r                    # 列出历史会话挑一个恢复
wraith sandbox doctor        # 沙箱体检
```

- [ ] 新终端里 `wraith -h` 打印用法（不打印 = PATH 没生效，见 §6「`wraith` 不是内部或外部命令」）
- [ ] `wraith-install` 结尾打印 `已安装 -> C:\Users\<你>\.wraith\wraith.jar`

> **`-d` 和 `-h` 是启动器截走的，其余参数原样透传给 Java CLI。** 这样安全是因为
> Java CLI 自己只认 `-c/--continue` 和 `-r/--resume`，没有 `-d` 也没有 `-h`。

> 装了短命令后，第 5 节那句「改完 Java 重跑 `dev-win.ps1`」就简化成一句 `wraith-install`。
>
> 与 mac 版的一点差别：mac 那个脚本把仓库路径**写死**在里面（换台机器就废）。Windows 这版从脚本自身位置反推仓库根，仓库挪到哪都能用；真要把 `wraith.cmd` 复制到仓库外，设 `WRAITH_REPO` 指向仓库根即可。

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

#### 装完之后不需要再装 Java（但 MCP 可能需要 Node）

安装包**捆绑了 JRE**（`resources\runtime\bin\java.exe`）和后端 jar。用装好的 App 的人**不需要**系统里有 JDK —— 前面那套 JDK/Maven 只是**构建**时要的。也因此路线 B 装完后不会遇到路线 A 那个 PATH 坑。

**Node 不在捆绑之列。** 装好的 App 里，除非你要加 `npx` 形式的 MCP server，否则用不到 Node；一旦要加，就得系统里有。判断方法和三条替代路线见第 6 节「加 MCP server 报 `Cannot run program "npx"`」。

---

## 2. 首次启动：配一个模型

启动后 wraith 还不能对话 —— 它不知道用哪个模型、拿什么密钥。

**全新装机直接在应用里配就行**：首页会显示一条「还没有配置模型 · 去配置」，点它直达 Provider 面板；填完保存即可用，**不需要重启**。

> **历史说明（已修复）**：更早的版本存在一个首次运行死锁 —— 后端在没有任何 API Key 时 `System.exit(1)`，而「Provider 配置」面板又要通过后端 RPC 写配置，于是「想配 key 得先有 key」，全新装机在应用内无路可走，控制台狂刷 `app-server: 未找到可用 API Key` + 满屏 `Backend not connected`。
>
> 现在后端**无模型也照常启动**：配置类 RPC 全部可用，发起对话才会被拒绝并给出提示；配好 provider 后就地热装。若你仍看到上面那串报错，说明**跑的是旧 jar** —— 见第 5 节「代码更新后怎么重新跑」。

### ① 图形界面配（推荐）

1. 左侧栏找到 **配置 → Provider 配置**
2. 搜索或在列表里挑一个 provider（GLM / DeepSeek / Kimi / StepFun / 讯飞星辰 …），点 **＋配置**
3. 多数 provider 卡片右上角有 **「获取密钥 →」** 链接，直接跳该家控制台去申请
4. 填 **API Key**（必填）、**模型**、**Base URL**（多数有默认值，不用改）
5. 点 **「测试连接」** —— 成功显示 `✓ 连接成功 · 模型名 · 延迟ms`；失败显示 `✗` 加后端原文错误
6. 点 **「保存」**。回到列表后，若这张卡片上有 **「设默认」** 就点一下（已经是默认的卡片不显示这个按钮）

配置落到 `%USERPROFILE%\.wraith\config.json`。**密钥不会出现在日志或任何回包里**，界面回读时只告诉你「已配置」，不回明文。

### ② 放一个 `.env` 到用户目录（不想开界面时用）

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
DEEPSEEK_API_KEY=你的key
```

可用的 key 名（挑你有的那家）：`GLM_API_KEY`、`DEEPSEEK_API_KEY`、`STEP_API_KEY`、`KIMI_API_KEY`、`FREELLMAPI_API_KEY`、`XFYUN_MAAS_API_KEY`。

cmd 里一条命令建好：

```cmd
echo DEEPSEEK_API_KEY=你的key> "%USERPROFILE%\.env"
type "%USERPROFILE%\.env"
```

> `>` **前面不要留空格** —— cmd 会把空格一起写进值里。写完 `type` 一下确认。

配好后重启 `npm run dev`。控制台不再出现「尚未配置任何模型」、首页也不再显示引导条，就说明装上了。

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

面板里每条记录行尾的按钮按状态给：

| 状态 | 有什么键 |
|---|---|
| 运行中 / 排队中 | **✕ 取消**（此时不给删 —— worker 还在改你的文件，删了行它照样在跑，只是你看不见了） |
| 失败 / 已取消 | **⟲ 重试** + **🗑 删除** |
| 已完成 | **🗑 删除** |

**重试 = 用同样的指令新建一条，并把原来那条删掉**，列表里只留最新的。
（反过来说，如果重试提交本身失败了，原记录会原地不动 —— 否则你的指令就跟着一起没了。）

### 顶栏那个盾牌

右上角有个小盾，它同时表达两件事：**有没有沙箱**、以及**网络出口开没开**。三态：

| 图标 | 墨色 | 悬停文案 | 含义 |
|---|---|---|---|
| 打勾盾 | 浅墨 | 沙箱: AppContainer · 已断网 | 正常态。命令关在 AppContainer 里，断网 + 写围栏 |
| **半盾** | **橙** | 沙箱: AppContainer · 已放行网络 | 你在安全面板打开了「命令沙箱联网」。文件系统仍被关着，只是网络出口开了 |
| 警告盾 | **红** | 沙箱未启用 | AppContainer 没起来 —— 要处理的异常 |

盾会**跟着面板里的开关实时变**：拨「命令沙箱联网」，松手就能看见打勾盾变成橙色半盾。
（这在 2026-08-02 之前是坏的：盾只在开机时读过一次状态，且压根不看联网位，
所以拨开关顶栏纹丝不动。用户报的「不管有没有开启沙箱护盾始终不变」就是它。）

红盾时点盾牌进「安全」面板会显示具体缺哪一项，或者命令行跑 `wraith sandbox doctor` 逐项体检。详见 [6.5 命令沙箱](#65-命令沙箱appcontainer)。

> 沙箱没起来时命令照常执行（仍受命令黑名单和 HITL 审批保护），只是没有围栏——不会把你卡住。

### 顶栏右上角三个键

Windows 主窗是**无边框**的，最小化 / 最大化 / 关闭是 wraith 自绘的（位置和行为跟 Windows 一致，字形是 wraith 的单色墨，关闭键悬停变红）。双击顶栏空白处也能最大化 / 还原，拖顶栏空白处移动窗口。

mac 那种半透明磨砂侧栏在 Windows 上是**实色**，这是有意设计，不是缺样式。

---

## 5. 代码更新后怎么重新跑

```powershell
git pull
```

**然后按「改了什么」决定重跑到哪一步** —— 不是每次都要全套。最容易踩的是第一行：

| 改动落在 | 要做什么 | 不做会怎样 |
|---|---|---|
| **Java 后端**（`src/main/java/**`、`src/main/resources/**`） | 重跑 `dev-win.ps1`（装了短命令则一句 `wraith-install`）+ **重启 App** | ⚠️ **改动完全不生效，且没有任何报错**。dev 态起的是 `%USERPROFILE%\.wraith\wraith.jar`，不是 `target\` 里那个 —— 光跑 `mvn package` 等于没改 |
| **渲染层**（`desktop/src/renderer/**`） | 什么都不用做 | — 热更新，存盘即刷新 |
| **主进程 / preload**（`desktop/src/main/**`、`desktop/src/preload/**`） | **完全重启 App**（Ctrl+C 后重跑 `npm run dev`） | 报 `window.wraith.X is not a function` —— preload **不热更新**，这是陈旧进程，不是代码 bug |
| **`desktop/package.json` 依赖变动** | `npm install --legacy-peer-deps` | 起不来或缺模块 |
| **已装的安装包**（路线 B） | 重新 `npm run dist:win` 再装一次 | 装好的 App 用的是打包时的 jar，`git pull` 对它没有任何影响 |

拿不准改了哪些，看一眼：

```powershell
git log --oneline -10
git diff --stat HEAD@{1} HEAD      # 上一次 pull 到现在动了哪些文件
```

### 最常用的一条（改了 Java 之后）

```powershell
# 仓库根
git pull
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
# 然后到跑着 npm run dev 的窗口 Ctrl+C，重新 npm run dev
cd desktop
npm run dev
```

确认新 jar 真的装上了 —— 时间戳应该是刚才：

```powershell
dir "%USERPROFILE%\.wraith\wraith.jar"
```

> **这个坑值得单独记住**：`dev-win.ps1` 干的事是「`mvn package` + 把产物拷到 `%USERPROFILE%\.wraith\wraith.jar`」。桌面 dev 态的主进程固定从那个位置 `spawn('java', ['-jar', ...])`。所以只跑 `mvn package` 不拷贝，App 会继续用旧 jar —— 表现是你明明改了后端却毫无变化，或者调用新加的 RPC 报「method not found」。

### 全部推倒重来

改动很多、或者状态混乱到说不清时：

```powershell
git pull
cd desktop
rmdir /s /q node_modules            # cmd；PowerShell 用 Remove-Item -Recurse -Force node_modules
npm install --legacy-peer-deps
cd ..
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
cd desktop
npm run dev
```

> 配置和会话都在 `%USERPROFILE%\.wraith\` 里，**不会**被上面这套清掉。真想连配置一起重置才动那个目录。

---

## 6. 出问题时

| 症状 | 最可能的原因 | 怎么办 |
|---|---|---|
| **`无法将"wraith"项识别为 cmdlet、函数、脚本文件或可运行程序的名称`** | 没装短命令，或装了但**没新开终端** | 见下方「`wraith` 不是内部或外部命令」 |
| `git clone` 报 `ssh: connect to host github.com port 22: Connection refused` | 用了 SSH 形式（`git@github.com:`），而 **22 端口被网络挡了**（公司网/校园网/部分 ISP 常见）；且全新机器也还没配 SSH 密钥 | 本仓库是**公开**的，直接用 HTTPS：`git clone https://github.com/JavaLyHn/wraith.git`，零认证配置。非要用 SSH 就走 443 通道，见下 |
| 装的时候被 SmartScreen 拦 | 安装包未签名 | 「更多信息」→「仍要运行」 |
| App 起来了但显示**后端未连接** | 走的是**开发态**（`npm run dev`），主进程 `spawn('java', …)` 找不到 java | 确认 `java` 在 **GUI 进程**的 PATH 里 —— GUI 应用不继承登录 shell 的 PATH，这是 Windows 上的经典坑。装好的 App 用捆绑 JRE，不该出这个问题 |
| 控制台刷 `app-server: 未找到可用 API Key` + 满屏 `Backend not connected` | **跑的是旧 jar。** 这是已修复的首次运行死锁 —— 旧版后端没 key 就 `System.exit(1)`，后面每个 IPC 都是连带反应 | 重跑 `dev-win.ps1` 再重启 App（第 5 节）。新版会打「尚未配置任何模型,已以「无模型」状态启动」并**照常服务** |
| 改了 Java 却毫无变化 / 调新 RPC 报 method not found | 只跑了 `mvn package`，没把 jar 拷到 `%USERPROFILE%\.wraith\wraith.jar` | 重跑 `dev-win.ps1` 再重启 App —— 见第 5 节，这是本项目最容易踩的一个坑 |
| `window.wraith.X is not a function` | preload **不热更新**，这是陈旧进程 | 完全重启 App（Ctrl+C 后重跑 `npm run dev`），不是代码 bug |
| 首页显示「还没有配置模型」 | 正常的全新状态 | 点「去配置」填一个 API Key，保存即可用，**不用重启** |
| 发消息报没有 API Key | 配了但没生效 | 回第 2 节 ①；若卡片上有**设默认**就点一下 |
| 设了环境变量但 App 不认 | 环境变量是进程启动时读的 | 重启 App；或直接改用图形界面配 |
| `npm install` ERESOLVE 失败 | react peer 冲突 | 必须带 `--legacy-peer-deps` |
| 加 MCP server 报 `Cannot run program "npx"` / `CreateProcess error=2` | **两个原因共用同一句错**：① 机器上没装 Node（Windows 不自带，安装包也不含）；② Node 有，但 Windows 上 npx 实际是 `npx.cmd`，`CreateProcess` 不做 `PATHEXT` 补全 | 先 `where.exe npx` 分诊：找不到 = ①，去装 Node 或改用 HTTP transport；列出两行 = ②，已修复，**重跑 `wraith-install`** 即可。见下方「加 MCP server 报 …」 |
| `npm install` 报错末尾有「**Log files were not written** ... `_logs`」 | **npm 缓存目录不可用**，与项目无关。连日志都落不下就是这个病的指纹，不管上面报 `EPERM` 还是 `ENOENT` | 见下方「npm 缓存目录不可用」——先 `npm config get cache` |
| `EPERM ... mkdir '<某盘>\...\_cacache\...'` | 缓存目录**存在但不可写**。常见于把 npm 缓存搬到 Node 安装盘（如 `E:\nodejs\node_cache`），该目录归 Administrators | 同上，把 cache 改到 `%LOCALAPPDATA%` |
| `ENOENT ... mkdir '<项目路径>\$env:...\_cacache\tmp'` | 缓存路径**不存在**，且被拼在了项目目录后 → 存进 `.npmrc` 的是个相对路径 | 在 cmd 里跑了 PowerShell 写法 `"$env:LOCALAPPDATA\..."`。改用 `"%LOCALAPPDATA%\..."`，并删掉误建的怪目录 |
| `npm warn cleanup ... rmdir 'node_modules\...'` / `npm warn tar TAR_ENTRY_ERROR ...` | 都是**次生现象**不是病因 —— 安装中途挂了，回滚删不掉半成品 / 解压到一半断了 | 别对着它排查。看 `npm error` 那几行的 `path`，解决后删干净 `node_modules` 重装 |
| `npm error path ...\node_modules\electron` + `RequestError: unable to verify the first certificate` | npm 包已下完，卡在 **electron postinstall 下载 Electron 二进制**（约 100MB，不走 registry，直连 GitHub Releases）。TLS 证书链验证失败，通常是杀软/企业网关拆 HTTPS | 见下方「Electron 二进制下载失败」——先设 `ELECTRON_MIRROR` |
| 「用应用打开」找不到编辑器 | 只按已知安装路径探测 | 见下方已知限制 |
| 文件操作偶发 `AccessDeniedException` | 杀软 / 索引器短暂占用目标文件 | 已内置 5 次有界重试（20/40/60/80ms）。**若仍失败请记下报错栈** —— 那说明占用超过 200ms，是需要调大退避的真实信号，不要当 flake 重跑了事 |

---

### `wraith` 不是内部或外部命令

```
wraith : 无法将"wraith"项识别为 cmdlet、函数、脚本文件或可运行程序的名称。
```

`wraith` / `wraith -d` / `wraith-install` 是**要装一次**的短命令，不是 clone 下来就有。按顺序查：

**① 装过没有？** 在**仓库根**（不是 `desktop\` 子目录）跑：

```powershell
cd D:\wraith                # 仓库根
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
```

结尾应打印 `已把 ...\scripts\windows 加入用户 PATH`。

**② 新开终端了吗？** —— 最常见的原因。PATH 是进程启动时读的，**装完的那个窗口读不到**。
关掉重开一个 PowerShell，再敲 `wraith -h`。

**③ PATH 到底进去没有？** 新终端里：

```powershell
$env:Path -split ';' | Select-String wraith
where.exe wraith
```

第一条应列出 `...\scripts\windows`，第二条应指到 `wraith.cmd`。都空 = 装的那步没成功，看 ① 的输出有没有报错。

**④ 不想装也行。** 短命令只是省事，等价的长写法一直可用：

| 短命令 | 等价长写法 |
|---|---|
| `wraith` | `java -jar %USERPROFILE%\.wraith\wraith.jar` |
| `wraith -d` | `cd desktop` + `npm run dev` |
| `wraith-install` | `powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1` |

> **`wraith: 还没安装 jar`** 是另一回事——PATH 好了，但 `%USERPROFILE%\.wraith\wraith.jar` 不在。
> 跑一次 `wraith-install` 补上（它构建后端并装到那个位置）。

---

### npm 缓存目录不可用（EPERM / ENOENT）

**一句话指纹**：报错末尾出现

```
npm error Log files were not written due to an error writing to the directory: <某路径>\_logs
```

**连日志都落不下**，说明整个缓存目录用不了。不管上面报的是 `EPERM` 还是 `ENOENT`，都是同一类病，直接查 `npm config get cache`。

两种变体：

| 报错 | 含义 | 典型成因 |
|---|---|---|
| `EPERM ... mkdir '<某盘>\...\_cacache\...'` | 目录**存在但不可写** | 把 npm 缓存搬到了 Node 安装盘（如 `E:\nodejs\node_cache`），该目录归 Administrators，普通终端只能读 |
| `ENOENT ... mkdir '<项目路径>\$env:...\_cacache\tmp'` | 缓存路径**根本不存在** —— 注意它被拼在了项目目录后面，说明存进去的是个**相对路径** | 在 **cmd** 里执行了 PowerShell 写法 `npm config set cache "$env:LOCALAPPDATA\npm-cache"`。cmd 不展开 `$env:`，字面量被原样写进 `.npmrc` |

**别对着这两类噪音排查**，它们都是安装中断后的次生现象：

- `npm warn cleanup ... EPERM ... rmdir node_modules\...` —— npm 想回滚删半成品，删不动
- `npm warn tar TAR_ENTRY_ERROR ENOENT ...` —— 解压到一半断了

真正的死因永远在 **`npm error`** 那几行的 `path`。

#### 修复（PowerShell）

```powershell
# ① 看缓存指向哪
npm config get cache

# ② 改到用户目录(必定有写权限;写入 %USERPROFILE%\.npmrc,不需要管理员)
npm config set cache "$env:LOCALAPPDATA\npm-cache"

# ③ ⚠ 必须验证 —— 输出要是以盘符开头的绝对路径
npm config get cache
#   ✅ C:\Users\<你>\AppData\Local\npm-cache
#   ❌ 含 $env: 或 %...%,或不以盘符开头 → 别往下走,回 ② 用对应 shell 的写法

# ④ 若之前误建过怪目录,删掉(它就在项目里,名字真的叫 $env:LOCALAPPDATA)
cd D:\wraith\desktop
Remove-Item -Recurse -Force '$env:LOCALAPPDATA' -ErrorAction SilentlyContinue

# ⑤ 清掉不一致的半成品
Remove-Item -Recurse -Force node_modules

# ⑥ 重装
npm install --legacy-peer-deps
```

> ④ 里的单引号不能少 —— PowerShell 双引号会把 `$env:LOCALAPPDATA` 展开，单引号才取字面量。

#### 修复（cmd）

提示符是 `D:\...>` 而非 `PS D:\...>` 就用这套。**注意 ② 用的是 `%...%` 不是 `$env:`**：

```cmd
npm config get cache
npm config set cache "%LOCALAPPDATA%\npm-cache"
npm config get cache

cd /d D:\wraith\desktop
rmdir /s /q "$env:LOCALAPPDATA"
rmdir /s /q node_modules

npm install --legacy-peer-deps
```

### 加 MCP server 报 `Cannot run program "npx"`

典型报错：

```
连接失败: Cannot run program "npx" (in directory "C:\Users\你"):
CreateProcess error=2, 系统找不到指定的文件。
```

> ⚠️ **这一句错有两个完全不同的原因，先分诊再动手。**
>
> 后端解析不到 `npx` 时会把原名原样交给操作系统，让它报自己的错——所以「机器上压根没有 Node」和「Node 有但 Windows 不补扩展名」**报出来的是同一句话**。
> 按错的那个原因去修，会一路走进死胡同。
>
> 一条命令就能分开：
>
> ```powershell
> where.exe npx
> ```
>
> | `where.exe npx` 的输出 | 说明 | 去看 |
> |---|---|---|
> | `信息: 用提供的模式无法找到文件。` | **机器上没有 Node** | 情况 A |
> | 列出 `...\npx` 和 `...\npx.cmd` 两行 | Node 有，是扩展名补全的问题 | 情况 B |

---

#### 情况 A：机器上根本没有 Node（`where.exe npx` 找不到）

> 🔎 **「我根本没加过 MCP server，为什么会报这个？」**
>
> 因为有一份**默认配置是自动创建的**。交互式 CLI（`wraith` / `java -jar …`）首次启动时，
> 若 `%USERPROFILE%\.wraith\mcp.json` 不存在，会自动写入一份默认的 chrome-devtools 配置，
> 而它用的正是 `npx`：
>
> ```json
> { "mcpServers": { "chrome-devtools": {
>     "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest", "--isolated=true"] } } }
> ```
>
> 所以**没装 Node 的机器，什么都没做就会看到这条错**。
> （桌面端自己不创建这份文件，但只要你跑过一次 CLI，它就在那儿了，桌面端也会读到。）
>
> **不想用浏览器 MCP 的话，关掉它最省事**，三种方式任选：
>
> | 方式 | 怎么做 |
> |---|---|
> | 桌面面板 | 「MCP」面板选中 `chrome-devtools` → 点**「停用」** |
> | CLI | `/mcp disable chrome-devtools` |
> | 改文件 | 把 `%USERPROFILE%\.wraith\mcp.json` 里那一项删掉，或整个换成 `{ "mcpServers": {} }` |
>
> **关掉不影响 wraith 的任何内置能力**——38 个内置工具与 MCP 无关。

**Windows 不自带 Node，也不自带 npx。** 而且——

> **装了 wraith 安装包 ≠ 有 Node。** 安装包捆绑的是 **JRE**（所以不用装 Java）和后端 jar，**不含 Node**。
> 第 1.1 节那句「路线 B 装完之后不需要 Java」说的只是 Java。
> **只要你要用 `npx` 起 MCP server，就得自己装 Node**——这是运行时依赖，不是构建时依赖。

三条路，按省事程度排：

**A1. 装 Node（最直接）**

到 [nodejs.org](https://nodejs.org/) 下 LTS 安装包，一路下一步。装完**新开一个终端**（旧终端读不到新 PATH）：

```powershell
node -v      # 期望 v18+
where.exe npx    # 期望列出 npx 与 npx.cmd
```

然后回 MCP 面板重新连一次即可，wraith 侧不用改任何配置。

**A2. 换成不需要 Node 的 MCP server**

`npx` 只是 Node 生态 MCP server 的启动方式。别的形态不需要它：

| server 形态 | 「命令(stdio)」填什么 | 需要什么 |
|---|---|---|
| Python（uv 生态） | `uvx` | 装 [uv](https://docs.astral.sh/uv/)，不需要 Node |
| 独立可执行文件 | 那个 `.exe` 的完整路径 | 什么都不需要 |
| Node，但已全局安装 | `where.exe <命令>` 查到的 `.cmd` 完整路径 | 仍需 Node |

**A3. 换用 HTTP 远程 server（本机什么运行时都不用装）**

wraith 的 MCP 支持两种 transport，`npx` 那条只是其中之一：

- **stdio** —— 把 server 当子进程拉起（需要本机有对应运行时）
- **Streamable HTTP** —— 连一个远程 server（**本机什么都不用装**）

⚠️ **桌面「MCP」面板目前只能加 stdio 的**（表单里只有「命令(stdio)」，没有 URL 字段；而且保存时会主动清掉 `url`——后端要求 transport 二选一）。HTTP server 得**手写配置文件**：

```
%USERPROFILE%\.wraith\mcp.json          用户级(所有项目)
<项目根>\.wraith\mcp.json                项目级
```

```json
{
  "mcpServers": {
    "my-remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${MY_TOKEN}" }
    }
  }
}
```

两个要点：

- **`command` 与 `url` 只能有一个。** 都写或都不写，启动时会直接报
  `MCP server 必须且只能配置 command 或 url`。
- **`${VAR}` 按环境变量展开**，密钥不必明文落盘（另支持 `${HOME}` 与 `${PROJECT_DIR}`）。
  但**变量没设不是留空，是直接失败**：`MCP 配置引用了未设置的环境变量: MY_TOKEN`。

改完**重启后端**才生效（见第 5 节）。

> 三条路都不想走也没关系：**MCP 是可选能力**。不加任何 MCP server，wraith 的 38 个内置工具（读写文件 / 执行命令 / 代码检索 / 联网 / 快照回滚等）照常可用。

---

#### 情况 B：Node 装了、`npx` 在终端里也能敲，但后端起不来

原因是 Windows 与 Linux/macOS 的一个根本差异：

| | Linux / macOS | Windows |
|---|---|---|
| npx 实际是什么 | `npx`（带 shebang 的脚本） | **`npx.cmd`**（批处理） |
| 谁负责补扩展名 | `execvp` 查 PATH，名字就叫 `npx` | 由 **shell** 按 `PATHEXT` 补；`CreateProcess` **不管** |

Java 用 `CreateProcess` 直接拉起进程，中间没有 shell —— 于是「找 `npx`」在 Windows 上必然落空。注意错误码是 **`error=2`（文件未找到）**，不是格式错误，这正说明卡在**找不到**而不是跑不动。

**已修复**：后端现在会按 `PATH` × `PATHEXT` 把 `npx` 解析成 `npx.cmd` 的完整路径再启动。拉最新代码并**重跑 `wraith-install`**（或 `dev-win.ps1`）即可 —— 改的是 Java，只 `git pull` 不生效，见第 5 节。

**手动绕过**（不想更新、或者用的是旧包）：把「命令(stdio)」直接填成完整路径。

```powershell
where.exe npx        # 找出真身,通常有 npx 和 npx.cmd 两行
```

把输出里 **`.cmd` 结尾的那一行**整条粘进「命令(stdio)」，参数不变：

```
命令(stdio)    C:\Program Files\nodejs\npx.cmd
参数           -y
               chrome-devtools-mcp@latest
               --isolated=true
```

> 同类问题也会出现在别的 npm 系命令上（`pnpm`、`yarn`、`bunx`…）—— 它们在 Windows 上一律是 `.cmd`。修复对它们同样生效。

---

#### 情况 C：npx 能解析了，MCP server 还是起不来

以 `chrome-devtools` 为例（它是**内建**的那个，不需要你配就在）。**原生 Windows 是官方支持的**
（[官方 troubleshooting](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md) 明确说 WSL 下 Chrome 反而起不来，建议用原生 Windows / PowerShell），
所以起不来一定有具体原因。三个常见的：

| 现象 | 原因 | 处理 |
|---|---|---|
| `MCP error -32000: Connection closed` | server 进程起来了又立刻死 | 看面板的**「日志」**页签，里面是 server 的 stderr 原文 |
| 加完之后一直「启动中…」，约一分钟后失败 | **首次运行 `npx -y` 要下载整个包**，默认 60 秒初始化超时不够 | 见下方「调超时」 |
| 日志里报找不到 Chrome | Chrome 没装，或装在非标准路径 | 装 Chrome；仍不行就按官方建议在参数里加一行 `--executablePath=C:\Program Files\Google\Chrome\Application\chrome.exe` |

**调超时**（首次装包慢的话）：

```powershell
$env:WRAITH_MCP_INITIALIZE_TIMEOUT_SECONDS = "180"
npm run dev
```

也可以先在终端手动跑一次，把包**预热**到 npx 缓存里，之后就快了：

```powershell
npx -y chrome-devtools-mcp@latest --version
```

> **官方给的两个 Windows 解法，wraith 已经自动做了第二个**（用 npx 的绝对路径，
> 扩展名可能是 `.cmd` / `.bat` / `.exe`）。所以正常情况下你**不需要**把命令改成
> `cmd /c npx …` 那种写法。
>
> ⚠️ 顺带一提，**不建议**手动改成 `cmd /c` —— 那样参数会经过 cmd 再解析一层，
> 而 MCP 配置可以来自项目里的 `.wraith\mcp.json`（也就是**从别人仓库 clone 来的**）。
> 参数里一个 `&` 就能变成命令注入。走绝对路径没有这一层。

**工具数量对不对得上？** 工具列表是 server 启动后自己报的（`tools/list`），
所以**要么全有、要么一个没有**，不存在少几个。两台机器数量不同只有一种可能：
`@latest` 解析到了不同版本（各自 npx 缓存不同）。想完全对齐就把 `@latest` 换成固定版本号。

---

#### 情况 D：能起来，但**每次开机都要等很久**

这是最常被当成 bug 的一类，其实全部时间都花在 wraith 之外。一次冷启动依次是：

```
npx 解析 npx.cmd 绝对路径     ← wraith 做的,毫秒级
  → npm 去 registry 问 chrome-devtools-mcp 的 latest 是哪个版本   ← 网络
  → 缓存里没有就下整个包(含 puppeteer-core,几十 MB)              ← 网络
  → 起 Node 进程 + 拉起一个全新的 Chrome(--isolated=true 每次新 profile)  ← 磁盘/CPU
  → MCP initialize 握手 + tools/list
```

**`@latest` 意味着即使包已经在缓存里，npm 每次仍要去 registry 问一次「最新是谁」。**
国内直连 registry.npmjs.org 的话，这一问经常就是十几秒起步。

按收益从大到小：

| 做法 | 命令 | 说明 |
|---|---|---|
| ① 换 npm 镜像 | `npm config set registry https://registry.npmmirror.com` | 国内收益最大，且对所有 npx 系 server 都生效 |
| ② 钉死版本 | 在 `~\.wraith\mcp.json` 写同名条目，args 用 `chrome-devtools-mcp@0.23.0` | 跳过 dist-tag 解析；顺带解决两台机器工具数不一致 |
| ③ 复用已开的 Chrome | args 换成 `--browser-url=http://127.0.0.1:9222` 或 `--autoConnect` | 省掉「每次拉一个全新 Chrome」；代价是 Agent 会驱动你**真实登录态**的浏览器 |
| ④ 不需要浏览器就关掉 | `WRAITH_MCP_BUILTIN_BROWSER=off` | 启动瞬间干净 |

②③ 的写法（用户级 `mcp.json` 里的同名条目会**完全覆盖**内建项）：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@0.23.0", "--browser-url=http://127.0.0.1:9222"]
    }
  }
}
```

> **启动慢不阻塞对话。** MCP server 在后台线程并行启动（最多 8 个并发），
> 每个 server 各自就绪、各自注册工具 —— 慢的那个只是自己慢，
> 不会拖住聊天、也不会拖住别的 server。面板上它停在「启动中」，好了自己会变。

---

### Electron 二进制下载失败（证书 / 网络）

典型报错：

```
npm error path D:\wraith\desktop\node_modules\electron
npm error command ... node install.js
npm error RequestError: unable to verify the first certificate
```

**注意这跟缓存那类病无关**：npm 包其实已经下完了，卡的是 `electron` 的 postinstall —— 它要去下 Electron 运行时二进制（约 100MB），**不走 npm registry，直连 GitHub Releases**。所以 registry 通不代表这一步能通。

`unable to verify the first certificate` = TLS 证书链验不过，通常是杀软或企业网关在中间拆 HTTPS 塞了自己的根证书，而 Node 不认它。

#### ① 换镜像（首选，国内还快得多）

```cmd
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install --legacy-peer-deps
```

`set` 只对当前窗口有效；要永久生效用 `setx`（**需新开窗口**）：

```cmd
setx ELECTRON_MIRROR "https://npmmirror.com/mirrors/electron/"
```

PowerShell 对应写法：`$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"`

#### ② 让 Node 认那张根证书（换镜像仍报同样错时）

说明拦截覆盖所有 HTTPS。先确认是谁在拦：

```cmd
npm config get proxy
npm config get https-proxy
npm config get strict-ssl
```

拿到根证书（企业 IT 提供，或从浏览器证书管理器导出为 .pem）后：

```cmd
set NODE_EXTRA_CA_CERTS=C:\path\to\root-ca.pem
npm install --legacy-peer-deps
```

#### ③ 关闭 TLS 校验（最后手段，不推荐）

```cmd
npm config set strict-ssl false
set NODE_TLS_REJECT_UNAUTHORIZED=0
```

> ⚠️ 这等于对所有下载不设防，装完请立刻 `npm config set strict-ssl true` 改回来。

#### 顺带：出安装包时还会撞一次

`npm run dist:win` 阶段 `electron-builder` 要下 `winCodeSign` / `nsis` 等二进制，同样直连 GitHub，同样会被拦。建议现在一起设了：

```cmd
setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

---

#### node_modules 删不动

一般是有进程占着——关掉编辑器、关掉 cwd 在里面的终端。仍然删不掉就用 robocopy 镜像一个空目录（对付海量小文件和超长路径最快）：

```powershell
mkdir empty_tmp
robocopy empty_tmp node_modules /MIR
Remove-Item -Recurse -Force node_modules, empty_tmp
```

```cmd
mkdir empty_tmp
robocopy empty_tmp node_modules /MIR
rmdir /s /q node_modules
rmdir /s /q empty_tmp
```

**建议把仓库目录加进 Windows Defender 排除项**（设置 → 隐私和安全性 → Windows 安全中心 → 病毒和威胁防护 → 管理设置 → 排除项）。`node_modules` 是几万个小文件，实时扫描既让安装慢好几倍，也是那些 `EPERM rmdir` 的常见元凶。

> ⚠️ **不要用「以管理员身份运行」来绕过。** 那会在项目里留下一批 Administrator 所有的文件，之后普通身份的 `npm install` / 删除会持续撞同样的 EPERM，坑更深。

---

## 6.5 命令沙箱（AppContainer）

### 它是什么

agent 执行的每条命令会被关进一个 **AppContainer**——Windows 自带的进程级隔离，免管理员。两条围栏：

| 围栏 | 效果 |
|---|---|
| **断网** | 沙箱 profile 不带 `internetClient` 能力，**内核直接拒绝 socket**。面板上的「命令沙箱联网」开关就是切这个 |
| **写围栏** | 只有工作区和沙箱专用临时目录可写；`.git` 显式拒写（防止 agent 改你的提交历史） |

这是 macOS Seatbelt 在 Windows 上的对等物，语义一致。

### 先体检

```cmd
wraith sandbox doctor
```

它会真跑四条探针，**不是只看配置**：

```
沙箱种类  : windows-appcontainer

AppContainer 前置条件
  ✔ 平台           Windows 11
  ✔ Windows 版本   10.0
  ✔ powershell.exe C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
  ✔ 发射器脚本      C:\Users\LyHn\.wraith\sandbox\appcontainer-run.ps1

探针（工作区 D:\wraith-test）
  ✔ stdio 管道               通过
  ✔ 工作区内可写                 通过
  ✔ 工作区外拒写（期望失败）           已被拦截（符合预期）
  ✔ 断网（期望失败）               已被拦截（符合预期）
```

**后两条「期望失败」才是重点。** 前两条只说明沙箱没碍事；只有后两条被拦住，才说明它真在拦。若它们显示「本应被拦截却成功了」，说明对应围栏没生效——请把整段输出发出来。

### 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `✘ stdio 管道` 且提示「退出码 0 但没拿到输出」 | 管道未授权给 AppContainer（DACL 不够） | 这是最可能翻车的一环，请反馈 |
| `✘ powershell.exe` | 被组策略移除/禁用 | 沙箱自动降级为无，命令照常跑 |
| 命令大面积失败、报找不到文件 | 工具链装在用户目录下（如 `%APPDATA%\npm`），AppContainer 读不到 | 见下方「手工授权工具链」 |
| 面板顶栏红盾 + 「沙箱未启用」 | 前置条件缺项 | 跑 doctor 看是哪一项 |

> **降级不阻断。** 沙箱起不来时命令照常执行，只是没有围栏——面板会显示具体原因，顶栏盾变红。这是刻意的：一个「因为没授权 npm 缓存目录就默默掐掉 `npm install`」的沙箱，排查成本远高于它的安全收益。

### 手工授权工具链

`C:\Windows` 和 `C:\Program Files` 默认已对 AppContainer 开放读+执行，装在那儿的工具链开箱可用。装在用户目录下的需要手工加：

```cmd
:: 先从 doctor 输出里拿到 sid=S-1-15-2-... 那一行
icacls "%APPDATA%\npm" /grant *<那个SID>:(OI)(CI)(RX)
```

### 撤销（重要）

**在面板里关掉沙箱不会撤销已经授出去的 ACL。** 想彻底还原：

```cmd
:: 撤销工作区授权(<SID> 从 doctor 输出里取)
icacls "D:\wraith-test" /remove *<SID> /T
icacls "D:\wraith-test\.git" /remove:d *<SID> /T

:: 删掉沙箱临时目录
rd /s /q "%LOCALAPPDATA%\wraith\sandbox-temp"
```

profile 本身留在系统里不占资源，也不影响别的程序；真要删用 PowerShell 的 `Remove-AppContainerProfile`（需 `-Name wraith-sandbox-nonet` / `wraith-sandbox-net`）。

---

## 7. 已知不可用 / 降级

这些是**当前明确不支持**的，不用浪费时间排查：

- ~~**Petdex 桌宠在线安装不可用**~~ —— **2026-08-02 已修**（PATH 按 `;` 切、认 `npx.cmd`、批处理经 `cmd.exe /c` 起）。仍需机器上装有 Node/npx；`where.exe npx` 找不到的话面板会明确告诉你去哪找过了。
- **桌宠跨虚拟桌面常驻** —— Windows 没有官方 API。
- **桌宠点击不抢焦仅 x64 精确** —— 走 koffi FFI 给窗口加 `WS_EX_NOACTIVATE`；ia32 上自动降级为 `focusable:false`，FFI 失败也会降级，不会崩。
- **编辑器探测范围有限** —— 只按已知安装路径找 VS Code / VS Code Insiders / Cursor / Sublime Text / Notepad++；自定义安装目录、注册表安装不覆盖。
- **安装包未签名** —— 每次大版本首次运行都会触发 SmartScreen。
- **`npx` 形式的 MCP server 需要自己装 Node** —— Windows 不自带，wraith 安装包也只捆绑 JRE 不捆绑 Node。不是 bug；三条替代路线（装 Node / 换 `uvx` 等非 Node server / 改用 HTTP transport）见第 6 节。

---

## 8. 只想用命令行（路线 C）

CLI 与桌面 App **共用同一套 Java 内核**：同一份配置、同一份会话历史、同一套工具、同一个后台任务队列。区别只在外壳。

**只需要 JDK 17 + Maven，不需要 Node。**

> ⚠️ 一个例外：**内建的 `chrome-devtools` MCP server 用 `npx` 启动**。
> 没装 Node 的话，启动时会看到 `Cannot run program "npx"` —— 这不影响 CLI 本身和 38 个内置工具，
> 关掉即可：环境变量 `WRAITH_MCP_BUILTIN_BROWSER=off`（永久），或 `/mcp disable chrome-devtools`（本次会话）。
> 详见第 6 节「加 MCP server 报 `Cannot run program "npx"`」。

### 8.1 装

```powershell
git clone https://github.com/JavaLyHn/wraith.git
cd wraith
git checkout feat/windows-parity-block1      # 仍然要切,理由见下

# 二选一 ——
# ① 装短命令(推荐):构建 + 装 jar + 把 wraith 挂上 PATH,一步到位
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
# ② 不装短命令:自己构建,之后每次手打 java -jar
mvn clean package -DskipTests
```

走 ① 的话**必须新开一个终端**，当前窗口读不到新 PATH。

- [ ] 新终端里 `wraith -h` 打印用法
- [ ] `java -version` 是 17+

> **CLI 也要切分支。** Java 内核确实跨平台，但有一处 Windows 专属修复只在这个分支上：`AtomicFileMove` 给 tmp→target 的原子改名加了有界重试（20/40/60/80ms），应对 Windows 上目标文件被杀软/索引器短暂占用时抛的 `AccessDeniedException`。**会话落盘、技能库、QQ 待发**三处都走它。停在 `main` 上，这些写入在 Windows 会偶发失败。

### 8.2 配一个模型

**配置与桌面 App 共享同一份** `%USERPROFILE%\.wraith\config.json`——在哪边配好，另一边都认。所以：

- 已经在桌面 App 里配过 → **什么都不用做**，直接跳到 8.3
- 只用 CLI → 第 2 节的三种方式（`.env` / 环境变量 / 进 CLI 后 `/config`）都行

> **CLI 没配模型是硬失败**，跟桌面不一样。桌面会以「无模型」状态起来并引导你去配；
> CLI 会直接退出：
>
> ```
> ❌ 错误: 未找到可用的 API Key
> 请在 .env 文件中添加 GLM_API_KEY、DEEPSEEK_API_KEY、…
> ```
>
> 这句话只提了 `.env`，但 `config.json` 同样有效（读取顺序是 config.json → 环境变量 → `.env`）。

### 8.3 起 + 冒烟验一遍

```powershell
wraith
# 没装短命令就是:  java -jar target\wraith-1.0-SNAPSHOT.jar
```

- [ ] 出现开场动画 + banner，底部是输入提示符
- [ ] 敲 `/` 弹出命令列表（Tab 补全可用）
- [ ] 发一句「你好」，有流式回复
- [ ] 发「读一下 README.md 的前 20 行」→ 工具调用 → **弹 HITL 审批** → 批准后有内容
- [ ] `/model` 显示当前模型
- [ ] `/context` 显示 token 用量与上下文模式
- [ ] `/exit` 能退出（`/quit` 同义）

会话自动落盘。退出后 `wraith -c` 接着上一次，`wraith -r` 列出历史挑一个。

### 8.4 ⚠ CLI 与桌面的一处**安全**差异

**交互式 CLI 不套命令沙箱。** `CommandSandbox` 只在 **app-server（桌面）/ IM 网关 / 定时任务** 三条路径注入；CLI 的 `ToolRegistry` 沙箱是 `null`。

也就是说在 CLI 里 agent 执行的命令：

| | 桌面 | CLI |
|---|---|---|
| AppContainer 围栏（断网 / 写限工作区 / `.git` 只读） | ✅ | ❌ **没有** |
| 命令黑名单（`rd /s /q C:\`、`format C:` …） | ✅ | ✅ |
| HITL 审批弹窗 | ✅ | ✅ |
| 危险工具审计（`~/.wraith/audit/`） | ✅ | ✅ |

`wraith sandbox doctor` 体检的是**沙箱本身能不能用**（给桌面/网关/定时任务用的），
它报「就绪」**不代表你正在 CLI 里跑的命令被关起来了**。这是刻意的设计
（交互式终端里你本来就在自己的 shell 上下文里作业），但得知道。

### 8.5 不进对话的子命令

```powershell
wraith sandbox doctor        # 沙箱体检(四条探针,见 §6.5)
wraith gateway bind <平台>   # 绑定 IM 账号(qq / feishu / wecom / weixin)
wraith app-server            # 桌面端用的 JSON-RPC 后端(一般不用手敲)
wraith wechat <...>          # 个人微信 iLink 通道
wraith serve --http          # Runtime HTTP API
```

> ⚠️ `wraith wechat` 与桌面里的微信网关**不能同跑**（同一个 iLink 通道）。

### 8.6 对话内命令一览

敲 `/` 加 Tab 就能补全，这里按用途列一遍（不是全部参数形态）：

| 用途 | 命令 |
|---|---|
| 会话 | `/clear` `/compact` `/history clear` `/export` `/resume` `/cancel` `/exit`(`/quit`) |
| 模型与配置 | `/model` `/config` `/context`(`/ctx`) `/hitl on\|off` |
| 记忆 | `/memory`(`/mem`) `list` `search <词>` `delete <id>` `pending` `approve <id>` `reject <id>` `clear`、`/save [内容]` |
| 检索 | `/index` `/search <词>` `/graph` |
| 编排 | `/plan <目标>` `/team <目标>` `/skill` `/task` |
| 安全 | `/policy` `/audit` |
| 快照 | `/snapshot` `/restore` |
| 外部 | `/mcp`（`restart`/`logs`/`disable`/`enable`/`resources`/`prompts`）`/browser` `/wechat` |
| 工程 | `/init`（生成项目记忆） |

### 8.7 改了代码之后

| 改了什么 | CLI 怎么重来 |
|---|---|
| Java 后端 | `wraith-install`（或 `mvn clean package -DskipTests`），然后重开 `wraith` |
| 只改前端 | 与 CLI 无关 |

> 装了短命令后 `wraith-install` 一条搞定：它内部复用 `dev-win.ps1`，
> 构建产物同时供 CLI 和桌面 dev 使用（两者读的是同一个 `%USERPROFILE%\.wraith\wraith.jar`）。
