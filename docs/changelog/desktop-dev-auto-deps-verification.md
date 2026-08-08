# Windows 真机验证：桌面 dev 自动补齐依赖

> 对应设计：`docs/superpowers/specs/2026-08-07-desktop-dev-auto-deps-design.md`
> 分支：`codex/desktop-dev-auto-deps`

## 前置条件

- Windows 10/11，已安装 Node.js 18+ 和 npm
- 已 checkout `codex/desktop-dev-auto-deps` 分支
- 后端 jar 已构建（`mvn package -DskipTests`）或用 `dev-win.ps1`

## 验证一：依赖已就绪时直接启动（不访问网络）

**目的**：确认 `predev` 钩子在依赖存在时立即退出，不触发 `npm install`。

1. 打开 PowerShell，进入 `desktop` 目录
2. 确认 `node_modules\.bin\electron-vite.cmd` 存在：
   ```powershell
   Test-Path node_modules\.bin\electron-vite.cmd
   # 应输出 True
   ```
3. 运行：
   ```powershell
   npm run dev
   ```
4. **预期**：
   - 控制台**不出现** `[ensure-deps] node_modules 缺失，自动安装依赖…`
   - 直接进入 `electron-vite dev` 启动流程（看到 Vite 构建输出）
   - 桌面应用窗口正常弹出

## 验证二：依赖缺失时自动安装再启动

**目的**：确认干净 checkout 上 `npm run dev` 会先装依赖再启动 Electron。

1. 进入 `desktop` 目录
2. 把 electron-vite 入口改名（模拟缺失）：
   ```powershell
   Rename-Item node_modules\.bin\electron-vite.cmd electron-vite.cmd.bak
   ```
3. 运行：
   ```powershell
   npm run dev
   ```
4. **预期**：
   - 控制台出现 `[ensure-deps] node_modules 缺失，自动安装依赖…`
   - 随后出现 `npm install --legacy-peer-deps` 的完整输出
   - 安装完成后自动进入 `electron-vite dev`，应用窗口弹出
5. 恢复验证用的改名文件（如果安装没自动重建）：
   ```powershell
   if (!(Test-Path node_modules\.bin\electron-vite.cmd)) {
       Rename-Item node_modules\.bin\electron-vite.cmd.bak electron-vite.cmd
   }
   ```

## 验证三：安装失败时不启动 Electron

**目的**：确认 `npm install` 失败时 `predev` 透传非零退出码，`npm run dev` 中止。

1. 进入 `desktop` 目录
2. 改名 electron-vite 入口（模拟缺失）：
   ```powershell
   Rename-Item node_modules\.bin\electron-vite.cmd electron-vite.cmd.bak
   ```
3. 临时破坏 `package.json` 让 `npm install` 必失败（改完记得改回来）：
   ```powershell
   # 备份
   Copy-Item package.json package.json.bak
   # 在 dependencies 里塞一个不存在的包名
   # 用记事本打开 package.json，在 dependencies 里加一行 "nonexistent-pkg-xyz": "999.0.0"
   ```
4. 运行：
   ```powershell
   npm run dev
   ```
5. **预期**：
   - 出现 `[ensure-deps] node_modules 缺失，自动安装依赖…`
   - `npm install` 报错退出（exit code 非 0）
   - 出现 `[ensure-deps] npm install 失败 (exit N)`
   - **不进入** `electron-vite dev`，`npm run dev` 整体退出
6. 恢复：
   ```powershell
   Move-Item package.json.bak package.json -Force
   if (Test-Path node_modules\.bin\electron-vite.cmd.bak) {
       Rename-Item node_modules\.bin\electron-vite.cmd.bak electron-vite.cmd
   }
   ```

## 验证四：全新 worktree 首次启动

**目的**：模拟真实使用场景——新 worktree 完全没有 `node_modules`。

1. 创建新 worktree：
   ```powershell
   cd d:\wraith
   git worktree add ..\wraith-test-auto-deps codex/desktop-dev-auto-deps
   cd ..\wraith-test-auto-deps\desktop
   ```
2. 确认没有 `node_modules`：
   ```powershell
   Test-Path node_modules
   # 应输出 False
   ```
3. 运行：
   ```powershell
   npm run dev
   ```
4. **预期**：
   - `[ensure-deps] node_modules 缺失，自动安装依赖…`
   - `npm install --legacy-peer-deps` 完整输出
   - 安装完成后 Electron 正常启动
5. 验证完毕清理：
   ```powershell
   cd d:\wraith
   git worktree remove ..\wraith-test-auto-deps --force
   ```

## 检查清单

| # | 场景 | 预期 | 通过 |
|---|------|------|------|
| 1 | 依赖已就绪 | 不调 npm install，直接启动 | ☐ |
| 2 | 依赖缺失 | 自动安装后启动 | ☐ |
| 3 | 安装失败 | 透传错误码，不启动 Electron | ☐ |
| 4 | 全新 worktree | 首次 `npm run dev` 一键跑通 | ☐ |
