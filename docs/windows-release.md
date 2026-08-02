# Windows 出包与发布 Runbook

> 在 **Windows 机器**上照着走。每步都给了**预期产出**和**不对时怎么办**。
>
> 相关文档：[`windows-usage.md`](windows-usage.md)（怎么用）· [`windows-dev.md`](windows-dev.md)（102 条验收清单）

---

## 0. 为什么必须在 Windows 上做

不能从 mac 交叉出包，两个硬阻断：

1. **JRE 是宿主 jlink 产的。** `scripts/gen-jre.mjs` 直接调 `jlink`，不带 `--module-path` 交叉目标。mac 上跑出来的是 Mach-O arm64 的 `bin/java`，塞进 Windows 安装包后 `resources\runtime\bin\java.exe` 根本不存在，后端起不来。
2. **`node-pty` 是原生模块**，得在目标平台 `npm install` 才拿到对的二进制。（`koffi` 自带各平台预编译，不受影响。）

另外 mac 上出 NSIS 还需要 wine。

> ⚠️ **已知 footgun（尚未修）**：`scripts/prepare-resources.mjs` 用 **宿主** 平台判断已有 JRE 是否可用（`existsSync(.../java)`），不看**构建目标**。在装了 wine 的 mac 上先 `dist:mac` 再 `dist:win`，它会跳过 jlink、把 macOS 的 JRE 打进 Windows 包，**且不报错**。在 Windows 上做则宿主＝目标，不会触发。

---

## 1. 版本号（已经定好了，别再动）

`desktop/package.json` 已从 `1.3.0` 改为 **`1.4.0-beta.1`**。

为什么必须改：`v1.3.0` 已经从 `main` 发过 mac 版；而这个分支比 main 多 116 个提交。若不改，NSIS 会产出 `Wraith Setup 1.3.0.exe` —— 一个名字叫 1.3.0、内容完全不是 1.3.0 的安装包。

`-beta.1` 是有意的：这是**第一个从未经真机验证的分支出的包**，发布时要标 pre-release，不能占 Latest。

---

## 2. 前置检查

```powershell
java -version      # 期望 17.x（jlink 会用这个 JDK 产 JRE）
mvn -v             # 能输出版本
node -v            # v18+
jlink --version    # 随 JDK 自带
git --version
```

- [ ] 五项齐备，且 `java -version` 是 **17.x**

> `java -version` 若不是 17，产出的捆绑 JRE 版本也会跟着变。仓库按 Java 17 编译，装个 JDK 17 再来。

---

## 3. 拉代码

```powershell
git clone git@github.com:JavaLyHn/wraith.git
cd wraith
git checkout feat/windows-parity-block1
git log -1 --oneline        # 记下这个 commit，后面建 tag 要用
```

- [ ] 分支是 `feat/windows-parity-block1`（**不是 main** —— Windows 的活还没合 main）

---

## 4. 构建

**按顺序跑，每步都确认产出再走下一步。**

### 4.1 后端 jar

```powershell
mvn clean package -DskipTests
```

- [ ] 产出 `target\wraith-1.0-SNAPSHOT.jar`

> `1.0-SNAPSHOT` 是固定产物名，不是版本号，**别去改 pom**（约 30 处引用 + 桌面打包脚本都指着它）。

### 4.2 顺手跑一遍后端测试（强烈建议）

```powershell
mvn -DskipTests=false test
```

- [ ] 全绿。mac 基线 **1661 tests / 0 failures / 0 errors**

> 本仓库测试**默认跳过**，必须显式 `-DskipTests=false`。
> 最可能在 Windows 上露馅的是文件系统语义：`AtomicFileMoveTest`、`AutomationStoreConcurrencyTest`（48 线程压 `writeAtomic`）。目标文件被杀软/索引器占用会抛 `AccessDeniedException`，已内置 5 次有界重试（20/40/60/80ms）。**若仍失败请留栈**——那是要调大退避的真实信号，别当 flake 重跑。

### 4.3 前端依赖

```powershell
cd desktop
npm install --legacy-peer-deps
```

- [ ] 成功，且 `node_modules\node-pty` 里有 Windows 原生二进制

> `--legacy-peer-deps` 不能省：`@lobehub/icons` → `@lobehub/ui` 有 react 18 vs 19 的 peer 冲突，干净 checkout 上普通 `npm install` 直接 ERESOLVE 失败。

### 4.4 桌面测试（可选但便宜）

```powershell
npm test
npx tsc --noEmit -p tsconfig.json
```

- [ ] mac 基线 **1160 passed / 136 files**，tsc **0**

### 4.5 出包

```powershell
npm run dist:win
```

这一步内部依次做：`electron-vite build` → `prepare:resources`（拷 jar + 跑 jlink 产 JRE）→ `electron-builder --win`。

- [ ] 中途能看到 jlink 输出，且 `desktop\resources\runtime\bin\java.exe` **存在**
- [ ] 产出 `desktop\release\Wraith Setup 1.4.0-beta.1.exe`

**产出后立刻验一件事**——这是最容易悄悄出错的地方：

```powershell
desktop\resources\runtime\bin\java.exe -version
```

- [ ] 能跑，输出 17.x。**如果这里报「不是有效的 Win32 应用程序」或文件不存在，说明打进去的是别的平台的 JRE，包是废的，别往下走。**

---

## 5. 冒烟（5 分钟，不过就别发）

```powershell
.\release\"Wraith Setup 1.4.0-beta.1.exe"
```

- [ ] SmartScreen 报「未知发布者」→「更多信息 → 仍要运行」（**预期行为**，未签名）
- [ ] 向导能改安装目录，建了桌面和开始菜单快捷方式
- [ ] 从**开始菜单**启动（不是从 release 目录跑），主窗出现
- [ ] 窗口**无系统标题栏**，右上角是自绘的 最小/最大/关闭 三键
- [ ] 左侧栏「配置 → Provider 配置」能配一个 provider，**「测试连接」通过**
- [ ] 发一条消息**有流式回复** ← 这条过了才说明后端真的起来了
- [ ] 顶栏盾牌是**中性墨色**、写「当前平台无沙箱」。**若是红色「沙箱未启用」= bug**（那是 mac 专属态）

> 任何一条不过就停下，记录后回来改，别发。

---

## 6. 完整验收

冒烟过了之后，照 [`windows-dev.md`](windows-dev.md) 走 **102 勾**。里面每条都带预期和翻车方向。

**发布门槛（must）**——这几节全过才发：

- 第 1 节 后端构建与测试
- 第 3 节 窗口外壳与视觉
- 第 4 节 会话栏 + 11 个面板 + 三模式
- 第 4.1 节 界面新面（首页两级示例 / 账户行 / 后台任务计数 / 沙箱盾）
- 第 5 节 平台专属路径（终端 / 编辑器打开）
- 第 10 节 打包与安装版

**可以延后（记 issue 即可）**：第 8 节 IM 网关（要真账号）、第 9 节 桌宠（第 11 节已列明降级）。

---

## 7. 建 tag 并发布

**验收过了再建 tag** —— tag 要指向真正被验过的那个 commit。

```powershell
# 仓库根
git tag v1.4.0-beta.1
git push origin v1.4.0-beta.1
```

```powershell
gh release create v1.4.0-beta.1 `
  --target feat/windows-parity-block1 `
  --title "Wraith v1.4.0-beta.1 (Windows)" `
  --prerelease `
  --notes-file docs\release-notes-1.4.0-beta.1.md `
  "desktop\release\Wraith Setup 1.4.0-beta.1.exe"
```

要点：

- **`--prerelease` 必须带。** 这是第一个 Windows 包，也是第一个从未合 main 的分支出的包，不能占 Latest（会盖掉给 mac 用户的 v1.3.0）。
- **`--target feat/windows-parity-block1`** —— 这个分支没合 main，不指定的话 gh 会挂到默认分支上。
- **资产名有空格**，命令行里必须加引号。
- **资产上传偶发 i/o timeout**，重试即可：
  ```powershell
  gh release upload v1.4.0-beta.1 "desktop\release\Wraith Setup 1.4.0-beta.1.exe" --clobber
  ```

Release notes 里请如实写明：

- 未签名，首次运行触发 SmartScreen
- 已知不可用：Petdex 在线安装、桌宠跨虚拟桌面、`WS_EX_NOACTIVATE` 仅 x64 精确、编辑器探测不覆盖自定义安装目录
- 这是 pre-release，Windows 首个版本

---

## 8. 出问题怎么记

每条失败请记下：**哪一步 / 完整报错栈 / 是否可复现**。

特别注意区分这两类，别混为一谈：

- **环境问题**（缺 JDK、PATH 没配、杀软拦截）—— 改环境
- **真 bug**（代码在 Windows 上行为不对）—— 这正是这轮要抓的东西，尤其是第 4 节那些**零平台分支**的地方：两端跑的是同一份 React 代码，那里出问题一定是真 bug。
