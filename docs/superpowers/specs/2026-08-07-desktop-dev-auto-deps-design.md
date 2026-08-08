# Desktop dev 自动补齐 npm 依赖设计

## 目标

在新的 Git worktree 或首次 checkout 后，用户进入 `desktop` 执行 `npm run dev` 即可启动桌面开发环境。`node_modules` 仍然不提交到 Git；只有在本地依赖缺失时才自动安装。

## 范围

- 修改 `desktop/package.json`，为 `dev` 增加 `predev` 生命周期钩子。
- 新增一个跨平台 Node 脚本，检查 `electron-vite` 是否可执行；缺失时调用当前平台对应的 `npm` 安装依赖。
- 保留现有安装参数 `--legacy-peer-deps`，兼容仓库已知的 React peer 冲突。
- 更新 Windows 开发文档，说明首次 `npm run dev` 可能自动安装依赖，以及网络失败时的手动命令。

## 行为

1. `npm run dev` 先执行 `predev`。
2. 若 `node_modules/.bin/electron-vite`（Windows 为 `.cmd`）存在，脚本立即成功退出，不访问网络。
3. 若入口缺失，脚本执行 `npm install --legacy-peer-deps`：
   - Windows 使用 `npm.cmd`，其他平台使用 `npm`；
   - 继承当前工作目录、环境变量和标准输入输出；
   - 安装失败时返回非零状态并保留 npm 原始错误，禁止继续启动 Electron。
4. 安装完成后由 npm 继续执行原有的 `electron-vite dev`。

## 非目标与安全边界

- 不提交 `node_modules`，不改变 lockfile 之外的依赖版本。
- 不自动运行 Maven、`dev-win.ps1` 或下载 Java 运行时；后端 jar 仍由现有脚本负责。
- 不覆盖用户现有依赖；只有入口缺失时才调用安装。

## 验证

- 单元/脚本验证：入口存在时不调用安装；入口缺失时使用正确的 npm 命令；安装非零时向上传递失败。
- `cd desktop && npm run typecheck`。
- `cd desktop && npx vitest run`。
- Windows 手工验证：删除或改名 `desktop/node_modules/.bin/electron-vite.cmd` 后执行 `npm.cmd run dev`，确认先安装再启动；依赖已恢复后再次执行确认直接启动。
