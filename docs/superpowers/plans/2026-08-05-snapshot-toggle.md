# 快照开关：启动参数 + 运行期 + 桌面按钮（2026-08-05）

> **起因**（用户）：「能不能在 wraith 启动终端时加上一个命令保持不开启快照功能……
> 桌面端也加上一个按钮，表示为开启和关闭快照功能。」

## 现状核查

| 关快照的路 | 有吗 |
|---|---|
| 环境变量 `WRAITH_SNAPSHOT_ENABLED=false` | ✅ 已有，且 `docs/cli-manual.md` §7 已写 |
| 系统属性 `-Dwraith.snapshot.enabled=false` | ✅ 已有 |
| **CLI 启动参数** | ❌ |
| **运行期开关**（进了 REPL 之后再关） | ❌ |
| **持久化**（下次启动仍然关着） | ❌ |
| **桌面开关按钮** | ❌（`SnapshotPanel.tsx` 只有列表 / 恢复 / 清理） |

**最后三条是同一个障碍**：`SnapshotConfig.fromEnvironment()` 只读 env 与系统属性，
**没有任何持久化位置**。桌面按钮点完要存到某处，而那个「某处」不存在。

## 决策

### D1. 新增 `snapshot` 配置节，取值链 env → 属性 → config.json → 默认开

`WraithConfig` 加一个 `snapshot` 小节（与 `search` / `embedding` 同构）。

**顺序必须是 env/属性优先**，与 `SearchProviderFactory` 的既有约定一致：
显式设了环境变量的人是在做「本次运行的临时覆盖」，配置文件不该压过它。

> **代价要说清**：于是 shell profile 里写死了 `WRAITH_SNAPSHOT_ENABLED=false` 的人，
> **点桌面按钮不会生效**。那不是 bug，但按钮**不能装作生效了** —— 见 D4。

### D2. 启动参数 `--no-snapshot`

只做一件事：在 `main()` 最前面把 `wraith.snapshot.enabled` 系统属性设成 `false`。

**刻意不新开一条配置通道** —— `SnapshotConfig` 已经在读这个属性了，
所以这个参数是「一行解析 + 零新增管道」。而且它天然对所有子命令生效
（`app-server` / `gateway` / `serve` 都走同一个 `main`）。

**是「本次运行」而不是「记住」**：参数不写盘。要持久化用 `/snapshot off` 或桌面按钮。

### D3. 运行期 `/snapshot on|off`

桌面有按钮，CLI 就该有对等的命令 —— 否则「聊天↔面板对等」又破一个口子。
它**写盘**（存进 config.json），并立刻对本次会话生效。

### D4. 生效必须立刻，且按钮不许说谎

两件事各有陷阱：

**① 立刻生效。** `SideGitManager` 在构造时就把 `SnapshotConfig` 捕获成字段了，
改了 config.json 不会影响正在跑的那个实例 —— 那是本仓库第八次 snapshot-vs-live
（前七次：沙箱护盾、动作卡、pet 窗口、补全、搜索 provider、计价表、搜索后端）。
所以加一个运行期覆盖字段 + `enabled()` 取代所有内部的 `config.enabled()` 直读。

**② 按钮不许说谎。** 状态回包要带 `source`（`env` / `property` / `config` / `default`）。
被 env 覆盖时按钮**置灰并说明原因**，而不是让用户点了没反应。
这正是「网页搜索与抓取」那张卡片踩过的坑：面板显示的状态与实际生效的不是一回事。

## 落地顺序

1. `WraithConfig.SnapshotSettings` + getter/setter
2. `SnapshotConfig`：取值链 + `EnabledSource`
3. `Main`：`--no-snapshot` 解析
4. `SideGitManager`：运行期覆盖 `enabled()`
5. `/snapshot on|off`（parser + 提示表 + 执行）
6. app-server：`snapshot.settings` / `snapshot.setEnabled`
7. 桌面：types / preload / ipc / `SnapshotPanel` 开关
8. 文档：`cli-manual.md` §1 启动参数、§5.7 快照；`windows-quickstart` 开关表
   （**§7 环境变量那条已经写了，不重复**）

## 不做

- **不做 `--snapshot on`**。参数只用来关，不用来开 —— 默认就是开的，
  一个「打开一个默认已经打开的东西」的参数只会让人怀疑自己漏了什么。
- **不动 `WRAITH_SNAPSHOT_ENABLED` 的语义**。它已经在文档里、也在失败提示里被引用，
  改语义会让那些提示变成假话。
