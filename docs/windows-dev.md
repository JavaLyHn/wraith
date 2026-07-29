# 在 Windows 上跑 wraith 桌面 dev

> 状态:块 1(可跑 dev + 平台守卫兜底)+ 块 2 窗口 chrome(无边框自绘窗控)+ 块 3(Windows 编辑器探测+打开)+ 块 4(打包生成安装包)已完成。已知降级见文末。

## 前置(均需在 PATH)

- JDK 17:`java -version`
- Maven:`mvn -v`
- Node(建议 ≥ 18):`node -v`

## 步骤

1. **备后端 jar**(仓库根):
   ```powershell
   powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
   ```
   产物落到 `%USERPROFILE%\.wraith\wraith.jar`。

2. **装桌面依赖**(取 node-pty 的 Windows 原生二进制):
   ```powershell
   cd desktop
   npm install --legacy-peer-deps
   ```
   仓库存在 `@lobehub/icons`→`@lobehub/ui` 的 peer 依赖冲突(react 18 vs 要求 19),干净 checkout 上普通 `npm install` 会 ERESOLVE 失败,需 `--legacy-peer-deps` 绕过。

3. **起 dev**:
   ```powershell
   npm run dev
   ```
   dev 后端由 Electron 主进程 `spawn('java', ['-jar', %USERPROFILE%\.wraith\wraith.jar, 'app-server'])` 拉起。

## 验收清单(在 Windows 实机逐条打勾)

- [ ] App 起动,主窗出现
- [ ] 状态显示后端已连接
- [ ] 发一条消息,有回复
- [ ] 终端面板能打开、能敲命令(PowerShell / cmd)
- [ ] 记忆面板能搜索、能保存
- [ ] (若开启桌宠)开启后 App 不崩、宠物出现
- [ ] 主窗无系统标题栏(无边框),整窗为自绘表面
- [ ] 顶条右上角有 最小化 / 最大化 / 关闭 三键,点击各生效
- [ ] 最大化后按钮图标变"还原",还原后变回"最大化"
- [ ] 双击顶条空白处 最大化 / 还原
- [ ] 关闭键悬停变红
- [ ] 拖顶条空白处可移动窗口
- [ ] 文件的「用应用打开」能列出已装编辑器(VS Code 等),点击用该编辑器打开文件
- [ ] `npm run dist:win` 能产出 `desktop/release/*.exe`
- [ ] 双击安装包能装(可选安装目录)、装完能从开始菜单/桌面快捷方式启动
- [ ] 安装版启动后核心功能(聊天/终端/记忆/窗控/编辑器打开)通

## 打包:生成 Windows 安装包(在 Windows 机器上)

前置(均在 PATH):JDK(供 jlink,建议 17+)、Node、Maven。

```powershell
# 1) 仓库根:构建后端 jar
mvn -q clean package -DskipTests
# 2) 桌面依赖(含原生 node-pty)
cd desktop
npm install --legacy-peer-deps
# 3) 打包(向导式 NSIS,未签名)
npm run dist:win
```

产物:`desktop/release/` 下的 `*.exe` NSIS 安装包。

**未签名说明**:安装包未做代码签名,首次运行 Windows SmartScreen 会提示「Windows 已保护你的电脑 / 未知发布者」——点「更多信息 → 仍要运行」即可(与 macOS 版的 xattr 绕过同性质)。根治需 Authenticode 证书,暂未做。

## 已知降级(后续块处理)

- (块 2 已完成)Windows 现为无边框自绘窗 + 右上角自绘窗控,视觉与 mac 对齐。
- (块 3 已完成)"用应用打开"在 Windows 探测已知编辑器(VS Code / Insiders / Cursor / Sublime Text / Notepad++,默认安装路径)并直接打开;自定义目录/注册表安装暂不覆盖。
- 桌宠**不跨虚拟桌面**、点击**可能抢焦**(原生插件对等 → 块 5)。
- (块 4 已完成)Windows 安装包已可产出(`npm run dist:win`);未签名,首次运行触发 SmartScreen 提示,见上「打包」一节。
