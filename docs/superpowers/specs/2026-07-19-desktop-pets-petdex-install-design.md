# 桌宠 · Petdex 应用内安装 设计

状态:已批准,实施中(2026-07-19)

## 目标

设置页「宠物库」除了「导入图片 / 导入精灵包」,新增**应用内直接安装**:输入宠物名 → 应用后台执行
`npx petdex@latest install <名>` → 实时显示日志 → 装完自动刷新宠物库。省去手动下载+导入精灵包。

## 决策(与用户确认)

- **安装方式**:应用内直接执行(非"只给命令手动跑")。
- **落地目录**:`~/.codex/pets`(= 现有 petdexRoot),petdex 自身默认目标,`listPets` 自动识别。

## 安全边界(核心)

执行外部命令是信任面扩张,以下四道闸缺一不可:

1. **名字白名单**:`^[a-z0-9][a-z0-9-]{0,63}$`。不过闸不执行(前端禁用按钮 + 主进程再校验)。
2. **固定命令模板**:参数恒为 `['petdex@latest','install', name]`,用户只能改 `name`。
3. **不经 shell**:`spawn(npx, args, { shell:false })`,args 数组传参 → 无 shell 注入面。
4. **超时**:120s,防挂死;输出只展示、绝不 eval。

npx 路径:GUI app 不继承登录 shell 的 PATH,故在 `PATH` + `/opt/homebrew/bin`、`/usr/local/bin`、
`~/.volta/bin` 等常见目录里解析绝对路径;找不到 → 明确报「未找到 Node/npx」,不静默失败。

## 组件与接口

- `shared/petInstall.ts`(纯,可单测):
  - `isValidPetName(name): boolean`
  - `npxSearchDirs(pathEnv, homedir): string[]`(PATH 优先 + 常见目录,去重保序)
  - `resolveNpx(dirs, existsFn): string | null`
- `main/petInstall.ts`:`runPetdexInstall(name, { cwd, onOutput, spawnFn?, npxPath? }): Promise<PetInstallResult>`
  - 名字非法 / npx 未找到 → 不 spawn,直接返回带文案的失败。
  - `spawnFn`/`npxPath` 为测试注入点。
- `shared/pets.ts`:`interface PetInstallResult { ok: boolean; error: string | null }`
- IPC:
  - `wraith:petsInstall(name)` invoke → `PetInstallResult`;成功后照 `petsImportPackage` 收尾(`syncPetWindow` + `pushCurrentPetPreview`)。
  - `wraith:petsInstall-output`(main→renderer)流式推 stdout/stderr 字符串块。
- preload:照 `petsImportPackage` 窄接口模式加 `petsInstall` + `onPetInstallOutput`,不改 contextIsolation。
- `PetsSettings.tsx`:名字输入框 + 「从 Petdex 安装」按钮 + 将执行命令的明示 + 流式日志 `<pre>`;
  in-flight 守卫;成功 `refresh()` + 清空,失败显示 error。

## 测试

- `test/petInstall.test.ts`:`isValidPetName` 合法/非法边界;`npxSearchDirs` 含 PATH+常见目录且去重;
  `resolveNpx` 命中首个存在项 / 全不存在返回 null(注入假 existsFn);`runPetdexInstall` 用假 spawn 覆盖
  非法名不 spawn、npx 缺失、close 0 成功、非 0 失败、输出流转。
- `test/petsSettings.test.tsx`:mock 补 `petsInstall`/`onPetInstallOutput`;输入名字点安装 → 断言
  `petsInstall(name)` 被调。

## 非目标

- 不支持自由命令输入(只 petdex install)。
- 不做卸载/升级(现有删除按钮已覆盖导入宠物;petdex 宠物走库列表)。
- packaged 环境的 Node 分发不在本次范围,仅做路径解析 + 清晰报错。
