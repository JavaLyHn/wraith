# 在 Windows 上跑 wraith 桌面 dev

> 状态:块 1(可跑 dev + 平台守卫兜底)+ 块 2 窗口 chrome(无边框自绘窗控)+ 块 3(Windows 编辑器探测+打开)已完成。已知降级见文末。

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
   npm install
   ```

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

## 已知降级(后续块处理)

- (块 2 已完成)Windows 现为无边框自绘窗 + 右上角自绘窗控,视觉与 mac 对齐。
- (块 3 已完成)"用应用打开"在 Windows 探测已知编辑器(VS Code / Insiders / Cursor / Sublime Text / Notepad++,默认安装路径)并直接打开;自定义目录/注册表安装暂不覆盖。
- 桌宠**不跨虚拟桌面**、点击**可能抢焦**(原生插件对等 → 块 5)。
- 无 Windows 安装包(打包 → 块 4)。
