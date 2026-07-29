# 在 Windows 上跑 wraith 桌面 dev

> 状态:块 1(可跑 dev + 平台守卫兜底)。已知降级见文末。

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

- [ ] App 起动,主窗出现(标准系统窗框)
- [ ] 状态显示后端已连接
- [ ] 发一条消息,有回复
- [ ] 终端面板能打开、能敲命令(PowerShell / cmd)
- [ ] 记忆面板能搜索、能保存
- [ ] (若开启桌宠)开启后 App 不崩、宠物出现

## 已知降级(后续块处理)

- 窗口是**系统标准边框**(mac 的无边框 + 红绿灯视觉对等 → 块 2)。
- "用应用打开"文件走**系统默认程序**(Windows 编辑器探测 → 块 3)。
- 桌宠**不跨虚拟桌面**、点击**可能抢焦**(原生插件对等 → 块 5)。
- 无 Windows 安装包(打包 → 块 4)。
