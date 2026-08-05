# Windows 快速上手

> **第一次用就看这一份。** 目标：从零到能对话，一次读完。
>
> 每条命令都给 **cmd** 和 **PowerShell** 两种写法 —— 两者不通用的地方（环境变量、路径引号、
> 执行策略）恰好是最容易卡住的地方。
>
> 出了问题、要看更细的对照表和排障：[windows-usage.md](windows-usage.md)。
> 想知道终端里能敲哪些命令：[终端使用手册](cli-manual.md)。

## 目录

- [0. 我该走哪条路](#0-我该走哪条路)
- [1. 要装什么](#1-要装什么)
- [2. 拉代码 —— 必须切分支](#2-拉代码--必须切分支)
- [3. 三条路线](#3-三条路线)
- [4. 配一个模型](#4-配一个模型)
- [5. cmd 与 PowerShell 对照表](#5-cmd-与-powershell-对照表)
- [6. 注意事项（踩过的坑）](#6-注意事项踩过的坑)
- [7. 代码更新后重跑到哪一步](#7-代码更新后重跑到哪一步)

---

## 0. 我该走哪条路

| 你想要 | 走 | 需要 Node 吗 |
|---|---|---|
| 只在终端里用（CLI） | **路线 C** | ❌ 不需要 |
| 用桌面 App，边改边跑 | **路线 A** | ✅ 需要 |
| 出一个能装的 `.exe` 分发 | **路线 B** | ✅ 需要 |

三条路线**都要先装短命令**（第 3 节第一步），装完 `wraith` 就是全局命令，用法与 macOS 一致。

> ⚠️ **Windows 暂无预编译安装包**，Releases 里只有 macOS 的 `.dmg`。Windows 目前必须从源码构建。

---

## 1. 要装什么

### 必装（构建要用）

| 软件 | 版本 | 验证命令 |
|---|---|---|
| **JDK** | **17**（仓库按 17 编译） | `java -version` |
| **Maven** | 任意近版 | `mvn -v` |
| **Git** | 任意近版 | `git --version` |
| **Node** | ≥ 18 —— **只走路线 C 可以不装** | `node -v` |

四项都要在 **PATH** 里。用 winget 装最省事（cmd 与 PowerShell 通用）：

```
winget install --id=EclipseAdoptium.Temurin.17.JDK -e
winget install --id=Apache.Maven -e
winget install --id=Git.Git -e
winget install --id=OpenJS.NodeJS.LTS -e
```

**装完必须新开一个终端**，当前窗口读不到新的 PATH。

> 装好的 App **捆绑了 JRE，不需要系统装 Java**。上面这套只是**构建**时要的。
> Node 是例外：它既是构建依赖，**也可能是运行时依赖** —— 只要你想用 `npx` 起 MCP server，
> 装好的 App 也需要系统里有 Node。

### 可选（两个外部命令，不装也能正常用）

Windows 两个都不自带、安装包也不含。**先看清「不装会失去什么」再决定**：

| 命令 | 谁需要它 | 不装的后果 | 替代 |
|---|---|---|---|
| `ollama` | 本机 embedding：`/index` 建索引、`/search` 语义检索、`search_code` 工具、桌面「代码图谱」 | 建索引/检索报连不上 `11434`。**内置工具里只有 `search_code` 受影响**，读写文件 / grep / 跑命令 / 记忆全都照常 | **有** —— embedding 改用云端（一行配置） |
| `uvx` | 起 Python 生态的 MCP server。推荐清单 10 项里有 3 项用它（Fetch / Git / Time） | 那 3 项起不来，报 `Cannot run program "uvx"` | **有** —— 另外 7 项走 `npx` |

```
winget install --id=Ollama.Ollama -e      # 想要本机 embedding 才装
winget install --id=astral-sh.uv -e       # 想用那 3 个 MCP 才装
```

> `uvx` **不属于 Node**。它是 [uv](https://docs.astral.sh/uv/)（Python 生态的包管理器）自带的命令，
> 装 Node **不会**带来它。这两个命令报错长得很像，别混。

---

## 2. 拉代码 —— 必须切分支

**cmd 与 PowerShell 相同：**

```
git clone https://github.com/JavaLyHn/wraith.git
cd wraith
git checkout feat/windows-parity-block1
```

确认分支对了：

```
git branch --show-current
```

期望输出 `feat/windows-parity-block1`。

> ⚠️ **`git checkout` 那步不能省。** Windows 的活还没合进 `main` —— `main` 上**一个 Windows 专属文件
> 都没有**（没有自绘窗控、没有 `dev-win.ps1`、没有 NSIS 打包配置）。停在 `main` 上照样能构建出东西，
> 但拿到的是**没有任何 Windows 对等**的版本，**而且不会有任何报错提示你走错了**。

再确认一次（这个文件在，就说明分支对了）：

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
dir desktop\scripts\dev-win.ps1
```

</td><td>

```powershell
Test-Path desktop\scripts\dev-win.ps1
```

</td></tr>
</table>

> **用 HTTPS 而不是 SSH。** 本仓库是公开的，HTTPS 不需要任何认证配置。
> 若你用 `git@github.com:...` 报 `ssh: connect to host github.com port 22: Connection refused`，
> 那是 22 端口被网络挡了（公司网 / 校园网常见）——换回 HTTPS，或让 SSH 走 443（见 [windows-usage.md](windows-usage.md)）。

---

## 3. 三条路线

### 第一步（三条路线通用）：装短命令

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
```

</td><td>

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
```

</td></tr>
</table>

它做三件事：`mvn package` 构建 → 把 jar 装到 `%USERPROFILE%\.wraith\wraith.jar` →
把 `wraith` 挂上**用户 PATH**。

**⚠️ 装完必须新开一个终端** —— 当前窗口读不到新 PATH。之后：

| 命令 | 作用 |
|---|---|
| `wraith` | 起终端 CLI |
| `wraith -d` | 起桌面开发态 |
| `wraith -h` | 看用法 |
| `wraith-install` | 改完 Java 后重装 jar |
| `wraith terminal doctor` | 终端诊断（方向键/补全失灵时先跑它） |

> **为什么要写 `-ExecutionPolicy Bypass`**：Windows 默认不允许跑未签名的 `.ps1`。
> 这个参数只对**这一次调用**生效，不改你机器的全局策略。

> `mvn package` **会先清掉旧的 `target\` 再重新构建**，不会越装越占地方。
> jar 装到 `%USERPROFILE%\.wraith\wraith.jar` 是**覆盖**，同样不累积。

### 路线 A：桌面开发态

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
cd desktop
npm install --legacy-peer-deps
npm run dev
```

</td><td>

```powershell
powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
Set-Location desktop
npm install --legacy-peer-deps
npm run dev
```

</td></tr>
</table>

等价于装完短命令后直接 `wraith -d`。

> **`--legacy-peer-deps` 不能省** —— 不加会因 react peer 冲突报 ERESOLVE 直接失败。

### 路线 B：出安装包

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
mvn clean package -DskipTests
cd desktop
npm install --legacy-peer-deps
npm run dist:win
```

</td><td>

```powershell
mvn clean package -DskipTests
Set-Location desktop
npm install --legacy-peer-deps
npm run dist:win
```

</td></tr>
</table>

产物：`desktop\release\Wraith Setup <版本>.exe`

> `npm run dist:win` **必须在 Windows 上跑** —— 捆绑 JRE 由宿主 `jlink` 产出、`node-pty` 是原生模块，
> 交叉出包会被构建脚本硬拦。
>
> 首次运行 SmartScreen 报「未知发布者」→「更多信息 → 仍要运行」（未签名）。

### 路线 C：只用终端 CLI（不需要 Node）

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
mvn clean package -DskipTests
java -jar target\wraith-1.0-SNAPSHOT.jar
```

</td><td>

```powershell
mvn clean package -DskipTests
java -jar target\wraith-1.0-SNAPSHOT.jar
```

</td></tr>
</table>

装了短命令后直接敲 `wraith` 就行。

---

## 4. 配一个模型

三条路，任选其一。**CLI 与桌面共用同一份配置**（`%USERPROFILE%\.wraith\config.json`）。

### ① 桌面图形界面（推荐）

起 App → 首页「去配置」→ 填 API Key → 保存。**不用重启**，密钥只落本地且不回显。

### ② 终端命令

```
wraith
/config provider deepseek --api-key sk-xxx --model deepseek-chat --default
```

用中转站 / 自建网关：

```
/config provider myrelay --base-url https://relay.example.com/v1 --api-key sk-xxx --model gpt-4o --default
```

### ③ 环境变量 —— **cmd 与 PowerShell 写法完全不同**

<table>
<tr><th>cmd（当前窗口）</th><th>PowerShell（当前会话）</th></tr>
<tr><td>

```bat
set DEEPSEEK_API_KEY=sk-xxx
```

</td><td>

```powershell
$env:DEEPSEEK_API_KEY = "sk-xxx"
```

</td></tr>
<tr><th>cmd（永久，需新开窗口）</th><th>PowerShell（永久，需新开窗口）</th></tr>
<tr><td>

```bat
setx DEEPSEEK_API_KEY "sk-xxx"
```

</td><td>

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "sk-xxx", "User")
```

</td></tr>
</table>

> ⚠️ **别在 cmd 里写 PowerShell 的语法。** 把 `"$env:LOCALAPPDATA\..."` 粘进 cmd，
> 那串字面量会被当成普通字符串用掉 —— 曾有人因此把 npm 缓存目录设成了项目目录下一个怪路径。
> cmd 里引用环境变量是 `%LOCALAPPDATA%`。

也可以放一个 `.env` 到用户目录（`%USERPROFILE%\.env`），格式 `DEEPSEEK_API_KEY=sk-xxx`。

---

## 5. cmd 与 PowerShell 对照表

真正会绊倒人的就这几行：

| 做什么 | cmd | PowerShell |
|---|---|---|
| 引用环境变量 | `%USERPROFILE%` | `$env:USERPROFILE` |
| 设临时环境变量 | `set K=V`（**等号两边不要空格**） | `$env:K = "V"` |
| 设永久环境变量 | `setx K "V"` | `[Environment]::SetEnvironmentVariable("K","V","User")` |
| 切目录 | `cd desktop` | `cd desktop` 或 `Set-Location desktop` |
| 看文件是否存在 | `dir path\to\file` | `Test-Path path\to\file` |
| 找命令在哪 | `where.exe npx` | `Get-Command npx` 或 `where.exe npx` |
| 串联两条命令 | `a && b` | `a; b`（**PowerShell 5.1 不支持 `&&`**） |
| 跑 `.ps1` 脚本 | `powershell -ExecutionPolicy Bypass -File x.ps1` | `.\x.ps1`（若被策略拦就用左边那句） |
| 看 PATH | `echo %PATH%` | `$env:PATH -split ';'` |
| 结束进程 | `taskkill /IM java.exe /F` | `Stop-Process -Name java -Force` |

> **`&&` 那一行值得单独记。** PowerShell 5.1（Windows 自带那个）不支持 `&&`；
> PowerShell 7+ 支持。文档里的 `a && b` 若在 PowerShell 里报错，换成 `a; b`。

---

## 6. 注意事项（踩过的坑）

按「会不会让你卡住」排序：

### ① 装完短命令必须新开终端

否则 `wraith` 会报 `无法将"wraith"项识别为 cmdlet、函数、脚本文件或可运行程序的名称`。
那不是 bug —— PATH 是进程启动时读的。

### ② 改了 Java 后端，只跑 `mvn package` 等于没改

桌面 dev 态起的是 `%USERPROFILE%\.wraith\wraith.jar`，**不是 `target\`**。
必须重跑 `dev-win.ps1`（或 `wraith-install`）把 jar 拷过去，再重启 App。
**这一步漏了不会报错**，只会让你以为代码没生效。对照表见 [第 7 节](#7-代码更新后重跑到哪一步)。

### ③ 中文 Windows 上 `.ps1` / `.cmd` 的编码坑

- 含中文的 `.ps1` **必须带 UTF-8 BOM**。没有 BOM 时 Windows PowerShell 5.1 按 **GBK** 解码，
  中文的 UTF-8 三字节被错拆，GBK 的 lead byte 会**吞掉后面一个字节** —— `}` 正好在可被吞的范围内。
  于是花括号凭空消失，报错却指向一个看起来毫无问题的 `{`。仓库里有测试守这条。
- `.cmd` 同理：本仓库的 `.cmd` 全部写成**纯 ASCII + CRLF**，中文提示交给一个单独的 `.ps1` 输出。
  这不是洁癖 —— GBK 吞字节会把 `^` 转义和换行一起吃掉，导致脚本静默少执行几行。

### ④ 终端方向键 / Tab 补全失灵 → 先跑 `wraith terminal doctor`

最常见的根因：JLine 的 `jni` provider 被 `Module.isNativeAccessEnabled()` 挡住
（JDK 21 也回移了这个检查，**Oracle JDK 21 实测就会**）。
修法是启动时加 `--enable-native-access=ALL-UNNAMED` —— `wraith.cmd` 会**自动探测一次**并缓存到
`%USERPROFILE%\.wraith\java-flags.txt`。**换过 JDK 就删掉那个文件**（或重跑 `wraith-install`，它会自动清）。

### ⑤ emoji 变成 `??` 或 `?`

中文 Windows 控制台码页是 GBK，表示不了 emoji。**这不是乱码** —— 乱码是编码解释错位，
而这是「目标编码根本没有这个字符」。已自动降级成 `[!]` / `[ok]` 这类 ASCII。

### ⑥ `npm install` 报 ERESOLVE

必须带 `--legacy-peer-deps`。

### ⑦ 加 MCP 报 `Cannot run program "npx"` 或 `"uvx"`

两个原因共用一句错：机器上没装（Windows 不自带），或者装了但 `CreateProcess` 不做 `PATHEXT` 补全
（Windows 上 npx 实际是 `npx.cmd`）。先 `where.exe npx` 分诊。**`uvx` 不属于 Node**，见第 1 节。

### ⑧ 交互式 CLI 不套命令沙箱

桌面 / IM 网关 / 定时任务里 `execute_command` 走 AppContainer；**你在终端里手动跑的那一轮不套**。
所以终端里更该把审批打开：`/hitl on`（默认是关的）。

---

## 7. 代码更新后重跑到哪一步

`git pull` 之后按**改了什么**决定：

| 改了什么 | 要做什么 | 漏了会怎样 |
|---|---|---|
| **Java 后端** | 重跑 `dev-win.ps1`（或 `wraith-install`）+ **重启 App** | 调新 RPC 报 `method not found`，或改动完全不生效，**且不报错** |
| **渲染层**（`.tsx` / `.css`） | 什么都不用做，热更新 | — |
| **preload / 主进程** | **完全重启 App**（Ctrl+C 后重跑 `npm run dev`） | 报 `window.wraith.X is not a function` |
| **只用 CLI** | 重跑 `wraith-install` | 敲 `wraith` 跑的还是旧 jar |

全部推倒重来：

<table>
<tr><th>cmd</th><th>PowerShell</th></tr>
<tr><td>

```bat
mvn clean package -DskipTests
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
cd desktop
rmdir /s /q node_modules
npm install --legacy-peer-deps
npm run dev
```

</td><td>

```powershell
mvn clean package -DskipTests
powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
Set-Location desktop
Remove-Item -Recurse -Force node_modules
npm install --legacy-peer-deps
npm run dev
```

</td></tr>
</table>

---

## 还有问题？

- **完整排障对照表**（30+ 条症状 → 根因 → 怎么办）：[windows-usage.md](windows-usage.md)
- **终端里能敲什么**：[终端使用手册](cli-manual.md)
- **出包与发布**：[windows-release.md](windows-release.md)
- **逐条验收清单**（给验证这个端口的人）：[windows-dev.md](windows-dev.md)
