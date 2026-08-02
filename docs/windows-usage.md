# Windows 使用教程

> 这份文档从**装完之后**写起，目标是让你在 Windows 上真正用起来 wraith。
>
> 仓库里另有两份 Windows 文档，分工不同，**别拿错**：
>
> | 文档 | 是什么 | 什么时候看 |
> |---|---|---|
> | 本文 `windows-usage.md` | **使用教程** | 你要用 wraith |
> | [`windows-dev.md`](windows-dev.md) | 开发、打包与**逐条验收清单**（87 勾） | 你要验证这个端口有没有做对 |
> | README「Windows 桌面对等」 | 五块平台专属改动的技术说明 | 你想知道 Windows 与 mac 差在哪 |
>
> **诚实声明**：Windows 端代码已完成，但**尚未在真 Windows 机器上跑过一次**。本文按代码实际行为编写，若你遇到与本文不符的情况，那大概率是真 bug，欢迎照第 5 节的排查方向记录下来。

---

## 1. 装

Releases 目前**只上架了 macOS 版**。Windows 需要自己从源码出一个安装包（一次性，之后就用装好的 App）：

```powershell
# 仓库根。前置：JDK 17 / Maven / Node ≥ 18 都在 PATH
mvn clean package -DskipTests
cd desktop
npm install --legacy-peer-deps      # --legacy-peer-deps 是必须的，见下
npm run dist:win                    # 产物：desktop\release\*.exe
```

> `--legacy-peer-deps` 不能省：`@lobehub/icons` → `@lobehub/ui` 有 react 18 vs 19 的 peer 冲突，干净 checkout 上普通 `npm install` 会 ERESOLVE 直接失败。

双击 `desktop\release\*.exe`：

- SmartScreen 会拦一下，报**「Windows 已保护你的电脑 / 未知发布者」** —— 因为安装包**未签名**（根治需要 Authenticode 证书）。点**「更多信息」→「仍要运行」**。
- 向导式安装，可以改安装目录，会建**桌面快捷方式**和**开始菜单快捷方式**。

### 装完之后不需要再装 Java

安装包里**捆绑了 JRE**（`resources\runtime\bin\java.exe`）和后端 jar。用桌面 App 的人**不需要**系统里有 JDK —— 上面那套 JDK/Maven/Node 只是**出包**时要的。

（仅当你走开发态 `npm run dev` 时，才需要系统 `java` 在 PATH，见第 5 节。）

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
| 装的时候被 SmartScreen 拦 | 安装包未签名 | 「更多信息」→「仍要运行」 |
| App 起来了但显示**后端未连接** | 走的是**开发态**（`npm run dev`），主进程 `spawn('java', …)` 找不到 java | 确认 `java` 在 **GUI 进程**的 PATH 里 —— GUI 应用不继承登录 shell 的 PATH，这是 Windows 上的经典坑。装好的 App 用捆绑 JRE，不该出这个问题 |
| 发消息报没有 API Key | 没配 provider，或配了但没「设默认」 | 回第 2 节 ①，注意最后要点**设默认** |
| 设了环境变量但 App 不认 | 环境变量是进程启动时读的 | 重启 App；或直接改用图形界面配 |
| `npm install` ERESOLVE 失败 | react peer 冲突 | 必须带 `--legacy-peer-deps` |
| 「用应用打开」找不到编辑器 | 只按已知安装路径探测 | 见下方已知限制 |
| 文件操作偶发 `AccessDeniedException` | 杀软 / 索引器短暂占用目标文件 | 已内置 5 次有界重试（20/40/60/80ms）。**若仍失败请记下报错栈** —— 那说明占用超过 200ms，是需要调大退避的真实信号，不要当 flake 重跑了事 |

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

不装桌面 App 也能用，CLI 与桌面共用同一套 Java 内核：

```powershell
mvn clean package -DskipTests
java -jar target\wraith-1.0-SNAPSHOT.jar
```

CLI 里可以用 `/config` 写配置、`/model` 切模型，配置同样落 `%USERPROFILE%\.wraith\config.json`，与桌面 App **共享同一份**。
