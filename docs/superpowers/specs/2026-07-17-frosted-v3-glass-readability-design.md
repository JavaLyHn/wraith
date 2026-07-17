# 磨砂 v3:alpha 根修 + 玻璃可读性 + 微动效 设计稿

日期:2026-07-17
状态:方向已与用户确认(盒子=去边框墨感填充;按压=轻微缩放回弹),待审阅
背景:磨砂 v2 眼验反馈——①侧栏"很多白线";②鲜艳壁纸透出后文字难读;③顶行三按钮要点击动效,折叠要滑动。

## 诊断

- **根因(系统性)**:tailwind.config 颜色为裸 `var(--x)`,无 `<alpha-value>` 模板 → **Tailwind 对透明度修饰静默不编译**。全仓 135 处 `/N` 类(`bg-surface/60`×59、`bg-danger/10`×17、`bg-accent/10`×13…)全是死类、从未渲染。编译探针证实:probe 只产出 `.bg-surface`,`/60`/`/90` 无输出。
- 白线 = 盒子(新对话/项目选择器)`bg-surface/60` 填充失效只剩白描边;sticky 表头 `bg-bg/90` 无底致下层文字透叠("你好"叠"对话");footer `border-t` 白线。
- 字难读 = 壁纸直透(v2 玻璃无纱)+ fg-muted/subtle 灰阶浅,叠加。
- 动效:终端抽屉/右侧面板已有 300ms 滑动;缺按钮按压反馈;侧栏**收起有滑动、展开瞬跳**(`dockInnerClass` 展开态是流内静态类,无 transform 过渡可言)。

## 目标

修 alpha 根因让 135 处设计原意落地;磨砂上加纱+加墨保证可读;白线全灭(盒子去边框、发丝线换半透明墨、sticky 给真底);折叠双向滑动 + 四个 chrome 按钮(折叠/展开/终端/右侧面板)缩放回弹。纯 renderer,无 main 改动。

## 改动设计

### A. alpha 根修(T1)

1. `tokens.css`:`:root` 与 `[data-theme="dark"]` 为每个主题色增设 RGB 三元组变量(与 hex 并存、注释注明同步义务):
   - light:`--bg-rgb: 247 248 250; --bg-elevated-rgb: 255 255 255; --fg-rgb: 28 36 48; --fg-muted-rgb: 91 102 117; --fg-subtle-rgb: 152 162 179; --border-rgb: 226 230 236; --accent-fg-rgb: 255 255 255; --danger-rgb: 192 57 43; --warn-rgb: 230 126 34; --ok-rgb: 31 157 99;`
   - dark:`--bg-rgb: 15 20 25; --bg-elevated-rgb: 22 27 34; --fg-rgb: 230 237 243; --fg-muted-rgb: 154 167 180; --fg-subtle-rgb: 107 118 132; --border-rgb: 43 49 56; --accent-fg-rgb: 255 255 255; --danger-rgb: 240 100 90; --warn-rgb: 232 161 60; --ok-rgb: 63 185 132;`
   - `--accent-rgb` 不写死(动态,见 3)。
2. `tailwind.config.js`:十个颜色全部改 `'rgb(var(--x-rgb) / <alpha-value>)'` 形态(bg/surface/fg/fg-muted/fg-subtle/border/accent/accent-fg/danger/warn/ok)。
3. `theme.ts`:新增导出纯函数 `hexToRgbTriplet(hex: string): string`('#0ea5b7'→'14 165 183');`resolveThemeVars` 的 vars 增 `'--accent-rgb': hexToRgbTriplet(ACCENTS[ui.accent].value)`。配套单测(新增,基线 675→+N)。
4. 效果:`bg-surface` 等价不变;135 处死类复活为设计原意(全 app 悬停/淡底浮现——属修 bug)。tokens.css 内部样式继续用 hex 变量,不受影响。

### B. 玻璃可读性(T2,依赖 A)

1. **纱(scrim)**:替换 v2 的 `html.is-mac .sidebar-gradient { background: transparent }` 为:
   ```css
   html.is-mac .sidebar-gradient { background: linear-gradient(180deg, rgba(255,255,255,.42), rgba(255,255,255,.30)); }
   html.is-mac[data-theme="dark"] .sidebar-gradient { background: linear-gradient(180deg, rgba(15,20,25,.50), rgba(13,17,23,.42)); }
   ```
   压住壁纸饱和度、保住玻璃感(浓度=眼验可调点)。
2. **墨字**(仅 mac+侧栏子树,scoped 三元组覆盖,亮暗各一):
   ```css
   html.is-mac [data-testid="sidebar"] { --fg-muted-rgb: 56 66 79; --fg-muted: #38424f; --fg-subtle-rgb: 91 102 117; --fg-subtle: #5b6675; }
   html.is-mac[data-theme="dark"] [data-testid="sidebar"] { --fg-muted-rgb: 182 194 207; --fg-muted: #b6c2cf; --fg-subtle-rgb: 139 152 165; --fg-subtle: #8b98a5; }
   ```
   (即各提亮/加深一档;hex 与 rgb 并改保持一致。)
3. **发丝线换墨**(蚀刻不发光;覆盖 aside 自身 border-r、footer border-t、ProjectSwitcher 菜单分隔线):
   ```css
   html.is-mac :is([data-testid="sidebar"], [data-testid="sidebar"] *).border-border { border-color: rgba(28,36,48,.16); }
   html.is-mac[data-theme="dark"] :is([data-testid="sidebar"], [data-testid="sidebar"] *).border-border { border-color: rgba(230,237,243,.14); }
   ```
4. **sticky 表头真底**:`Sidebar.tsx` 的 headerCls/groupLabelCls 里 `bg-bg/90` 换语义类 `sidebar-sticky`(backdrop-blur-sm 保留),tokens.css:
   ```css
   .sidebar-sticky { background: rgb(var(--bg-rgb) / .92); }
   html.is-mac .sidebar-sticky { background: rgba(255,255,255,.55); }
   html.is-mac[data-theme="dark"] .sidebar-sticky { background: rgba(22,27,34,.55); }
   ```
5. **盒子去边框墨感填充**(用户已选;双平台统一,依赖 A 的 `bg-fg/N`):
   - 新对话(Sidebar:232):`border border-border bg-surface/60 … hover:border-accent hover:text-accent` → `bg-fg/5 … hover:bg-fg/10 hover:text-accent`;
   - 项目选择器触发钮(ProjectSwitcher:46):`border border-border bg-surface/60 … hover:border-accent` → `bg-fg/5 … hover:bg-fg/10`。
   (fg 墨随主题翻转:浅色=深墨 5%,暗色=亮墨 5%,即 macOS 原生手法。)

### C. 微动效(T3)

1. **折叠双向滑动**:`sidebarDock.ts` 的 `dockInnerClass` 改"恒绝对定位+transform":
   - 展开:`absolute left-0 top-0 h-full w-60 translate-x-0 transition-transform duration-200 ease-out motion-reduce:transition-none`(占位 240 提供推挤,视觉与流内等价);
   - 折叠+peek:现 base + `translate-x-0`(z-50/shadow/rounded 仅 peek 保留);
   - 折叠无 peek:现 base + `-translate-x-full pointer-events-none`。
   展开/收起均得到 200ms 滑动(与占位宽过渡同步);`test/sidebarDock.test.ts` 断言随之更新。
2. **按压回弹**:四个 chrome 按钮(sidebar-collapse、sidebar-expand、terminal-toggle、rightdock-toggle)统一加 `transition duration-150 active:scale-90 motion-reduce:transform-none`(sidebar-collapse 原 `transition-colors` 合并进 `transition`)。

## 门禁与约束

- 纯 renderer;无 main 改动(眼验重启 `npm run dev` 即可——tailwind.config 变更需重启 dev server,非 HMR)。
- typecheck 0;vitest 基线不降(675 + 新增 hexToRgbTriplet/dock 断言更新)。
- testid/行为零变更(样式与动效类;sticky 换类名不动结构)。
- 防漏光不变式不破:纱是"加底"非"去底";内容列不动。
- push 需用户单独点头。

## 眼验(定案点)

1. 白线全灭:盒子无描边、sticky 有真底无透叠、footer 线成淡墨;
2. 侧栏文字在鲜艳壁纸上可读;纱浓度观感(可调);
3. 折叠/展开双向滑动;四按钮按压回弹;
4. 全 app 复活的悬停/淡底(surface/60、accent/10、danger/10…)无违和处——重点扫一眼聊天工具条、面板卡片、危险按钮;
5. 暗色玻璃协调。

## 风险

- **alpha 复活面大**(135 处首渲染):原意样式,但个别地方可能"原设计本身不好看"——眼验第 4 条兜底,发现再点修。
- scrim 浓度主观 → 变量集中一处,调参成本一行。
- `:is(...).border-border` 类名耦合 Tailwind 工具类:局部两条、注释标明,可接受(替代方案是 JSX 全改,churn 更大)。

## 不做(YAGNI)

- 不动内容列/面板/软卡片;不改 vibrancy 材质与窗口参数;不做 Win/Linux 差异化;不引依赖;改名输入框等次级控件不专门重设计(随 token 自然受益)。
