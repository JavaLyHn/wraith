# Wraith Desktop 全局桌面宠物窗口设计

日期: 2026-07-19
状态: 规格评审中

## 背景

`2026-07-18-desktop-pets-design.md`（状态：已实施）把宠物实现为**聊天视图内的一个悬浮浮件**——一个绝对定位的 renderer `<div>`，天然被限制在应用主窗口内、且只在 `view === 'chat'` 时出现。真机验收后用户明确要求把宠物改为**独立于应用窗口、浮在整个桌面之上的全局桌宠**：切到别的应用/别的界面也常驻可见、全身可拖、在宠物身上滚轮缩放、右键菜单开关。

本规格是对 07-18 设计的**演进**：保留宠物的发现/导入/校验/注册表/状态映射等全部后端能力，只把**展示表面**从"聊天内 overlay"替换为"全局桌宠窗口"。除非本文另有说明，07-18 规格的来源与注册表、资产格式、状态映射、导入安全、减少动态效果等约定继续有效。

平台前提：Wraith Desktop 仅分发 macOS（`dist:mac` / electron-builder --mac），故本设计按 macOS 的置顶/透明/穿透/跨 Space 行为设计与验收。

## 目标

- 宠物作为**全局桌面挂件**常驻，与应用主窗口焦点无关：切换到任何其他应用、主窗口最小化或关闭时都保持可见（退出应用才消失）。
- **全身可拖动**（不再是只有顶部窄带），拖动即移动整个桌宠窗口。
- **在宠物身上滚轮缩放**，缩放持久化。
- **右键宠物**弹原生菜单，至少可"关闭宠物"，并可选择宠物 / 设缩放预设 / 重置位置。
- 透明区域**点击穿透**到下面的桌面与其他应用；只有指针真正压在宠物不透明像素上才捕获鼠标。
- 桌宠**继续跟随 Wraith 运行状态**（idle/thinking/tool/approval/success/error 六态）。
- 三条安全红线（路径穿越 / 资产校验 / 上下文隔离）在迁移中**逐字节不变**。

## 范围

本期交付：

- 独立的无边框、透明、置顶、跨 Space、不抢焦点的桌宠 `BrowserWindow`；
- 逐像素 alpha 命中测试驱动的点击穿透（`setIgnoreMouseEvents(forward)` 动态切换）；
- 全身拖动（事件驱动移窗，落屏幕坐标）；
- 宠物身上滚轮缩放（resize 窗口 + 持久化，范围 0.5–2.0）；
- 原生右键菜单（选择宠物 / 缩放预设 / 重置位置 / 关闭宠物）；
- 主进程转发派生宠物状态信号到桌宠窗，复用现有动效与精灵帧逻辑；
- 宠物运行态配置迁到主进程单一事实源，设置面板与桌宠窗经 IPC 共享；
- 移除聊天视图内的浮件挂载；设置面板保留（库/选择/导入/删除/动态风格/缩放/开关）。

本期不做：

- Windows / Linux 支持（应用本身只分发 macOS）；
- 多只宠物同时在桌面上、宠物行走/物理/掉落等行为动画；
- 07-18 规格已列的所有不做项（自动下载 Petdex、跑 `npx`/第三方代码、AI 生成姿势、市场/账号/云同步、重绘 Noir 美术）继续不做。

## 体验

### 桌宠窗

- 宠物是一枚浮在所有窗口之上的挂件，出现在所有 Space、并盖在全屏应用之上；不进 ⌘-Tab、不进 Dock/任务栏、永不抢走当前应用的键盘焦点。
- 指针不在宠物身上时，点击/滚动**穿透**到下面的桌面或其他应用，宠物不阻挡任何操作。
- 指针压在宠物不透明像素上时：可**全身拖动**移动位置、**滚轮缩放**、**右键**弹菜单。
- 桌宠随 Wraith 运行状态播六态动作（沿用 07-18 状态映射与短暂 success/error 复位）；不发文案、气泡、Toast、错误信息。
- 系统启用"减少动态效果"时，桌宠停在静态姿势，仍可见、可拖、可缩放、可右键。

### 设置页

设置"宠物"页保留并调整：库/选择/导入/删除/动态风格照旧；缩放滑块范围由 0.75–1.5 放宽为 **0.5–2.0**；"位置"不再是聊天列内偏移，新增"重置位置"入口（与右键菜单一致）。工作中预览继续展示选中宠物。总开关语义变为"是否创建桌宠窗口"：关闭即销毁窗口、不解码宠物图片。

## 架构

### 桌宠窗口（主进程）

以 splash 窗口（`src/main/index.ts` `createSplash`）为蓝本创建 `petWindow`：

```
frame:false, transparent:true, backgroundColor:'#00000000', hasShadow:false,
alwaysOnTop:true（setAlwaysOnTop(true,'floating')）, resizable:false, movable:false,
skipTaskbar:true, focusable:false, fullscreenable:false,
webPreferences: 与主窗一致（contextIsolation:true, sandbox, 同一 preload 白名单, 无 nodeIntegration）
petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true })
petWindow.setIgnoreMouseEvents(true, { forward:true })
```

`focusable:false` 保证桌宠永不抢焦点，同时仍能接收 mousemove/wheel/contextmenu/pointer 事件。窗口内容加载**独立轻量 renderer 入口 `pet.html`**（electron.vite `renderer.build.rollupOptions.input` 改为多入口 `{ index, pet }`），只渲染宠物，不加载聊天 app、Monaco 等重资源。

### 点击穿透 + 逐像素命中测试

默认 `setIgnoreMouseEvents(true,{forward:true})`——穿透但仍向 renderer 转发 mousemove。桌宠 renderer：

1. 复用为帧检测已解码的精灵 `ImageData`，按当前帧的 cell 偏移 + 指针坐标（除以 `scale` 反算）查该像素 alpha；
2. 纯函数 `isOpaqueAt(imageData, cell, point, threshold)` 判命中；
3. 命中态翻转时才发 IPC：命中→`pet:setIgnoreMouse(false)`（捕获），移开→`pet:setIgnoreMouse(true)`（穿透，仍 forward）。

单图宠物同理用其 alpha（无 alpha 的不透明 JPEG 则整框捕获）。

### 拖动（全身）

`movable:false`，事件驱动：宠物身上 `pointerdown` 记录 `screenX/screenY` 与窗口当前位置；`pointermove` 用屏幕坐标增量计算新窗口原点，`pet:moveTo(x,y)` 让主进程 `setBounds`（按屏幕坐标算，窗随宠物移不抖）；`pointerup` 落盘。不用 `-webkit-app-region:drag`（它会吞掉滚轮与右键）。

### 缩放（滚轮）

宠物身上 `wheel` → 按 `deltaY` 调 `scale`，纯函数 `stepScale(current, deltaY)` 夹到 **[0.5, 2.0]**；随即 resize 窗口到"缩放后精灵尺寸 + 命中留白"，并调整窗口原点使宠物视觉锚点不跳；落盘 `scale`。右键菜单提供 50/100/150/200% 预设走同一路径。

### 右键菜单（原生）

宠物身上 `contextmenu` → `pet:contextMenu` → 主进程 `Menu.buildFromTemplate(...).popup()`：

- 选择宠物 ▸（可用宠物列表，选中项打勾）
- 缩放 ▸（50% / 100% / 150% / 200%，当前值打勾）
- 重置位置（回到当前显示器右下角默认位）
- ──
- 关闭宠物（销毁窗口 + 配置 `enabled=false`）

菜单项经 IPC 回主进程更新配置/窗口。纯函数 `buildPetMenuTemplate(pets, config)` 产模板，便于单测。

### 状态联动

主进程已中转后端事件。把 `petStateFromEvent` / `nextPetState` / `TRANSIENT_MS` 抽到 `src/shared/`（renderer 与 main 共用），主进程对每个后端事件跑 `petStateFromEvent`，非空则 `pet:signal` 推派生信号给桌宠窗（**不灌原始事件流**）。桌宠 renderer 复用 `motionFor`/`spriteRowFor`/帧检测与短暂态计时播放。

### IPC 通道

- 主 → 桌宠窗：`pet:config`（selectedId/motion/scale/position/enabled 变更）、`pet:signal`（派生状态信号）、`pet:preview`（选中宠物 dataURL + 精灵元数据）。
- 桌宠窗 → 主：`pet:ready`、`pet:setIgnoreMouse(ignore)`、`pet:moveTo(x,y)`、`pet:setScale(scale)`、`pet:contextMenu`。
- 设置面板 ↔ 主：复用 `petsList/petsImportImage/petsImportPackage/petsRemove/petsPreview`；新增 `pet:getConfig` / `pet:setConfig(patch)`；主向所有 renderer 广播 `pet:config` 保持同步。

所有新 IPC 经 preload contextBridge 白名单暴露，renderer 不获得任何文件系统或路径能力；`toPetView` 出边界 strip 绝对 `assetPath` 的约定不变。

### 生命周期与多显示器

app ready 且 `enabled` 且有可用宠物 → 建窗；`enabled=false` 或右键关闭 → 销毁；换宠物/缩放 → 重载内容 / resize；桌宠随 app 进程存活，主窗最小化或关闭都不影响（macOS 关主窗不退应用），退出应用才关。位置用**屏幕全局坐标**，`setBounds` 前夹到目标显示器工作区内（纯函数 `clampToDisplay(bounds, workArea)`）。

## 复用 / 新增 / 移除

- 复用：`petStore`（发现/导入/校验/复制/dataURL）、preload pet IPC（扩展）、`petMotion`（motionFor/spriteRowFor/detectFrameCounts/clampPoint）、`petState`（迁 shared）、PetAvatar 的精灵/单图渲染标记。
- 新增：主进程 `petWindow` 管理模块、`pet.html` + `PetWindowApp.tsx`、命中/拖/滚/右键处理、上列 IPC、主进程 pet 配置 store、electron.vite 多入口、纯函数 `isOpaqueAt/stepScale/clampToDisplay/buildPetMenuTemplate`。
- 移除：`App.tsx` 中聊天内 `PetAvatar` 的挂载与相关 App 级状态（`petSignal`/`petPreviewUrl`/瞬态计时随渲染逻辑一并迁入桌宠窗；主进程只跑 `petStateFromEvent` 推派生信号，短暂 success/error→idle 的计时在桌宠窗侧用 `TRANSIENT_MS` 完成）。

## 安全

- 三红线在 `petStore`/preload，**本期不动**：迁移完成后 `git diff` 在这些文件上应为空或仅纯迁移（无逻辑变更）。
- 桌宠窗与主窗同级隔离：`contextIsolation:true`、无 `nodeIntegration`、同一 preload 白名单；`pet.html` 内容为本地打包资源，不加载远端。
- 拖/移的 `setBounds`、缩放的 resize 在主进程侧夹到显示器工作区，越界输入被夹取而非照单执行。
- `setIgnoreMouseEvents` 只切换穿透，不提升任何权限。

## 持久化

宠物运行态配置（enabled / selectedId / motion / scale / position）**由主进程持有为单一事实源**（扩 `settings.ts` 或新建 pet 配置 store），设置面板与桌宠窗经 IPC 读写，主进程广播变更。`position` 语义改为屏幕全局坐标；从旧 renderer localStorage 的聊天列相对偏移迁移时**忽略旧 position**，首次显示落到当前显示器右下角默认位。每个宠物记录仍保存来源/导入时间/能力/相对资源目录/校验结果，不保存图像外用户内容。

## 测试与验收

单元测试（纯函数）：

- `isOpaqueAt`：给定 ImageData + cell + 点 + 阈值，命中/不命中/边界；
- `stepScale`：滚轮增量夹到 [0.5, 2.0]、预设值；
- `clampToDisplay`：窗口 bounds 夹到显示器工作区（含跨屏、部分越界）；
- `buildPetMenuTemplate`：菜单项、打勾态、关闭项存在；
- pet 配置 normalize 与旧 localStorage 位置迁移（旧偏移 → 默认屏幕位）；
- 沿用 07-18 的 `detectFrameCounts`/`spriteRowFor`/状态 reducer / 导入拒绝规则测试。

E2E（Playwright，可断言项）：

- 开启宠物后应用出现第二个 `BrowserWindow`，且 frameless / transparent；
- 关闭宠物（配置 `enabled=false`）后第二个窗口销毁；
- reduced-motion 下桌宠无 active 动效 class。

手工验收（**无头 E2E 不可断言，必须真机眼验**）：

- 置顶：桌宠盖在其他应用、Finder、全屏应用之上；切换 Space 后仍在；
- 穿透：指针在宠物外点击/滚动作用于下面的应用；指针在宠物上可拖/滚/右键；
- 拖动：全身任意不透明处都能拖，拖动不抢焦点、当前应用仍保持输入焦点；
- 缩放：宠物身上滚轮平滑缩放，重启后保留；
- 右键：原生菜单出现，选择宠物 / 缩放预设 / 重置位置 / 关闭宠物均生效；
- 状态联动：Wraith thinking/tool/approval/success/error 时桌宠播对应动作；
- 减少动态效果时桌宠静止；关闭宠物后重启应用不再出现桌宠窗、不加载宠物资源；
- 多显示器：桌宠可在副显示器停留，`setBounds` 不把它甩出可视区。

## 风险与决策

- macOS 无边框透明 + `focusable:false` + `setIgnoreMouseEvents(forward)` + 逐像素命中是社区成熟的"可交互透明挂件"组合，但焦点/穿透/跨 Space 的细节强依赖真机行为，故列为手工验收重点、并在 E2E 诚实标注其不可断言。
- 桌宠窗为独立顶层窗口，其崩溃/异常不应影响主窗与后端会话；窗口创建/销毁异常需被吞掉并降级为"宠物不可用"，绝不阻塞应用启动或退出。
- 配置从 renderer localStorage 迁到主进程是必要的架构变更（跨窗单一事实源），代价是设置面板改经 IPC 读写；旧 position 语义作废，明确迁移为默认屏幕位而非试图换算。
