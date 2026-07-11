# 桌面「浏览器」面板(roadmap #5)

**日期:** 2026-07-11 **状态:** 设计定稿(基于 Explore 深度测绘) **依赖:** roadmap #5

## 目标

补齐 CLI 的 `/browser status|connect|disconnect|tabs` —— 桌面新增「浏览器」视图(收进「工具」组),管理 agent 用哪个浏览器:**隔离(isolated)** ↔ **共享(shared,复用本机已登录 Chrome via CDP)**,让 agent 能访问需登录态的页面。

## 关键事实(已测绘)

- `handleBrowserCommand(payload, BrowserSession, BrowserConnectivityCheck, McpServerManager, HitlToolRegistry, HitlHandler)` + 5 子方法(browserStatus/AutoConnect/ConnectByPort/Disconnect/Tabs)+ parseBrowserPort —— **全 static,零 CLI 依赖,原样复用**。
- 它靠 `mcpServerManager.server("chrome-devtools")` 操作 chrome-devtools MCP(restartWithArgs 切 isolated/shared/autoConnect);`connectivityCheck.probe(port)` 探 CDP 端口;`browserSession` 记模式;tabs 走 `registry.executeTool("mcp__chrome-devtools__list_pages")`。
- **app-server 现状**:未 wire 浏览器(browserConnector=null → 三个 browser_* 工具空转);但 `appServerMcp.manager()` 已有 McpServerManager,chrome-devtools 若在 mcp 配置中会自动加载。
- app-server lambda 现有可复用变量:`appServerMcp`(1126)、`renderer`(1131)、`hitl`(SwitchableHitlHandler,1136)、`registry`(HitlToolRegistry,1139)、`agent`(1160);SessionRunner 匿名类返回于 1204。
- ⚠️ `appServerMcp.manager()` 可能 null(MCP 未就绪)→ 调 handleBrowserCommand 前必须 null-guard,否则 NPE。

## 实现

### 后端(Main.java + AppServer.java)

1. **static helper**(Main.java):`appServerBrowserCmd(payload, bs, cc, mgr, reg, hitl)` —— mgr==null 返回「MCP 尚未就绪,请稍候」,否则转 `handleBrowserCommand`。
2. **lambda 装配**(1202 后、return 前):
   ```java
   final BrowserSession browserSession = new BrowserSession();
   final BrowserConnectivityCheck browserConnectivityCheck = new BrowserConnectivityCheck();
   registry.setBrowserGuard(new BrowserGuard(browserSession, new SensitivePagePolicy()));
   registry.setBrowserConnector(new BrowserConnector() {  // 让 agent 的 browser_* 工具生效
     status()→appServerBrowserCmd("status",…); connectDefault()→("connect"); disconnect()→("disconnect");
   });
   ```
   (browserSession/connectivityCheck 声明为 lambda 局部,供下方 SessionRunner 的 RPC 方法复用,effectively-final。)
3. **SessionRunner 4 个 RPC 方法**(near sandboxSet):`browserStatus()`/`browserConnect(port)`/`browserDisconnect()`/`browserTabs()` → `{text: appServerBrowserCmd(payload,…)}`;connect 有 port 则 payload="connect <port>"。
4. **AppServer.Session 接口**:4 个 default(抛 UnsupportedOperationException)。
5. **dispatch**:`browser.status`/`browser.connect{port?}`/`browser.disconnect`/`browser.tabs`。

### 桌面

6. IPC:`browserStatus/browserConnect/browserDisconnect/browserTabs`;preload 4 方法;shared `BrowserCmdResult { text }`。
7. 侧栏「工具」组加第 9 项「浏览器」(lucide `Globe`);`BrowserPanel.tsx`:
   - 挂载即 browser.status;输出区 `<pre>` 显示最近命令文本(handleBrowserCommand 原样文本)。
   - 按钮:刷新状态 / 连接本机 Chrome / 按端口连接(端口输入,默认 9222)/ 断开 / 列出标签页。
   - 前置提示卡:「① 本机 Chrome 需以 `--remote-debugging-port=9222` 启动;② MCP 配置里需有 chrome-devtools(去「MCP」面板添加,npx 自动装)。未满足时连接会提示未配置。」

## 边界与降级

- chrome-devtools 未配置 → status 显示「未配置」,connect 优雅失败(返回文本,不崩)。**本切片不自动注入 chrome-devtools MCP 配置**(避免动用户 mcp 配置);引导用户去 MCP 面板加。
- 文本直通(不解析结构化状态)—— 忠实复用 CLI 输出,鲁棒;面板即「按钮 + 输出台」。
- setBrowserGuard 新增的敏感页保护:仅在 chrome 工具激活时生效,未连接时零影响。

## 测试隔离铁律

RPC 委托既有 static 逻辑;Java 侧不写触碰真实浏览器/MCP 的单测(靠 mvn package + 用户带 Chrome 眼验)。桌面无新增纯函数。

## 验证

`mvn -q clean package` ✓ + 同步 `~/.wraith/wraith.jar` · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:配好 chrome-devtools MCP + Chrome 远程调试 → 「浏览器」→ 连接 → 标签页。
