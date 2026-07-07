package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** stdio JSON-RPC app-server 主循环。v1 单会话。 */
public final class AppServer {

    public interface SessionRunnerFactory {
        SessionRunner create(JsonRpcWriter writer, String sessionId, String workspaceDir);
    }

    public interface SessionRunner {
        EventStreamRenderer renderer();
        String runTurn(String input) throws Exception;
        /** 带图片附件的重载；T2 覆写以传递图片给 LLM。默认退化为纯文本 runTurn。 */
        default String runTurn(String input,
                               java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                               java.util.List<String> imageNames) throws Exception {
            return runTurn(input);
        }
        /** 切换审批模式。auto=true → 关闭 HITL（自动放行）。默认 no-op，旧实现无需改动。 */
        default void setApprovalMode(boolean auto) { }
        /** 本项目历史会话(最近在前)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listSessions() {
            return java.util.List.of();
        }
        /** 续接会话:恢复历史进 Agent,返回该会话消息(供 UI 回放)。默认空。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String sessionId) {
            return java.util.List.of();
        }
        /** 落盘当前对话,返回持久化后的真实 sessionId(空对话可能为 null)。默认 no-op。 */
        default String persistTurn() { return null; }
        /** 真回溯:丢弃从第 userOrdinal 条 user 消息(1-based,含)起的全部历史。false=拒绝(超界等)。 */
        default boolean rewind(int userOrdinal) { return false; }
        default boolean setSessionStarred(String sessionId, boolean starred) { return false; }
        default boolean renameSession(String sessionId, String name) { return false; }
        default boolean deleteSession(String sessionId) { return false; }
        /** MCP 操作面。实现可返回 null(表示 mcp 不可用)。默认 null。 */
        default McpOps mcp() { return null; }
        /**
         * 当前可用 provider 列表及当前生效 client 信息。
         * 返回 {@code {current:{provider,model}, default:String, providers:[{name,model,hasKey}]}}。
         * 默认返回 null(-32000)。
         */
        default java.util.Map<String, Object> modelList() { return null; }
        /**
         * 会话级切换 provider(不写 config)。
         * 成功返回 {@code {provider, model}}；无 key/未知 provider → 抛 {@link IllegalArgumentException}(-32602)。
         * 默认抛出。
         */
        default java.util.Map<String, Object> sessionSetModel(String provider) {
            throw new UnsupportedOperationException("sessionSetModel not implemented");
        }
        /**
         * 持久化默认 provider(存 config.json)。
         * 校验存在+有 key → 写盘 → 返回 {@code {ok:true}}。
         * 未知/无 key → 抛 {@link IllegalArgumentException}(-32602)。
         * 默认抛出。
         */
        default java.util.Map<String, Object> configSetDefaultProvider(String provider) {
            throw new UnsupportedOperationException("configSetDefaultProvider not implemented");
        }
        /**
         * 新增或更新一个 provider 配置(写 config.json)。
         * apiKey 为空/null 时保留已有 key(不覆写)。
         * 默认抛出。
         */
        default java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol, String label) {
            throw new UnsupportedOperationException("configSetProvider not implemented");
        }
        /**
         * 删除一个 provider 配置(写 config.json)。
         * 若删除的是默认 provider 则回落到下一个有 key 的 provider。
         * 默认抛出。
         */
        default java.util.Map<String, Object> configRemoveProvider(String id) {
            throw new UnsupportedOperationException("configRemoveProvider not implemented");
        }
        /**
         * 用给定(表单)参数走真实客户端发一条极小对话探连通。
         * apiKey 为空/null → 沿用已存 key。回包只含 {ok, model?, latencyMs?, error?},绝不含 apiKey。
         * 默认抛出。
         */
        default java.util.Map<String, Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
            throw new UnsupportedOperationException("configTestProvider not implemented");
        }
        /** 列出全部技能(含 source 与 enabled)。默认抛出。 */
        default java.util.Map<String, Object> skillsList() {
            throw new UnsupportedOperationException("skillsList not implemented");
        }
        /** 启用/禁用一个技能(写 SkillStateStore + reload)。默认抛出。 */
        default java.util.Map<String, Object> skillsSetEnabled(String name, boolean enabled) {
            throw new UnsupportedOperationException("skillsSetEnabled not implemented");
        }
        /** 取单个技能全字段(含 body,供编辑回填)。默认抛出。 */
        default java.util.Map<String, Object> skillsGet(String name) {
            throw new UnsupportedOperationException("skillsGet not implemented");
        }
        /** 建/改一个用户或项目技能。默认抛出。 */
        default java.util.Map<String, Object> skillsUpsert(String scope, String name, String description,
                String version, String author, java.util.List<String> tags, String body) {
            throw new UnsupportedOperationException("skillsUpsert not implemented");
        }
        /** 删除一个用户或项目技能。默认抛出。 */
        default java.util.Map<String, Object> skillsDelete(String scope, String name) {
            throw new UnsupportedOperationException("skillsDelete not implemented");
        }
        /** 复制任意技能为用户技能(内置定制)。默认抛出。 */
        default java.util.Map<String, Object> skillsFork(String name) {
            throw new UnsupportedOperationException("skillsFork not implemented");
        }
        /** 查某作用域下是否已存在同名技能(移动作用域前的冲突检测)。默认抛出。 */
        default java.util.Map<String, Object> skillsExistsInScope(String scope, String name) {
            throw new UnsupportedOperationException("skillsExistsInScope not implemented");
        }
        /** 云端语音转写:audioBase64=录音字节的 base64,mime=音频 MIME。默认抛出。 */
        default java.util.Map<String, Object> sttTranscribe(String audioBase64, String mime) {
            throw new UnsupportedOperationException("sttTranscribe not implemented");
        }
    }

    private final BufferedReader in;
    private final JsonRpcWriter writer;
    private final SessionRunnerFactory factory;
    private final Map<String, Object> initializeResult;
    private final AtomicLong turnSeq = new AtomicLong();

    private SessionRunner session;
    private volatile String sessionId;
    private volatile Thread turnThread;

    public AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory) {
        this(in, out, factory, Map.of("serverInfo", "wraith-app-server", "protocol", "1"));
    }

    public AppServer(InputStream in, OutputStream out, SessionRunnerFactory factory,
                     Map<String, Object> initializeResult) {
        this.in = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        this.writer = new JsonRpcWriter(out);
        this.factory = factory;
        this.initializeResult = initializeResult;
    }

    public void serve() throws Exception {
        String line;
        while ((line = in.readLine()) != null) {
            JsonRpc.Incoming msg = JsonRpc.parse(line);
            if (msg == null) continue;          // 畸形行跳过
            try {
                if (!dispatch(msg)) break;       // shutdown
            } catch (Exception e) {
                System.err.println("app-server: dispatch error on method "
                        + msg.method() + ": " + e);
            }
        }
    }

    private boolean dispatch(JsonRpc.Incoming msg) {
        switch (msg.method()) {
            case "initialize" -> writer.result(msg.id(), initializeResult);
            case "session.start" -> handleSessionStart(msg);
            case "turn.submit" -> handleTurn(msg);
            case "turn.interrupt" -> {
                Thread t = turnThread;
                if (t != null) t.interrupt();
                writer.result(msg.id(), Map.of("ok", true));
            }
            case "approval.respond" -> handleApprovalRespond(msg);
            case "session.setApprovalMode" -> handleSetApprovalMode(msg);
            case "session.list" -> handleSessionList(msg);
            case "session.resume" -> handleSessionResume(msg);
            case "session.rewind" -> handleSessionRewind(msg);
            case "session.setStarred" -> handleSessionSetStarred(msg);
            case "session.rename" -> handleSessionRename(msg);
            case "session.delete" -> handleSessionDelete(msg);
            case "mcp.list" -> handleMcp(msg, ops -> writer.result(msg.id(), ops.list()));
            case "mcp.enable" -> handleMcpNamed(msg, (ops, name) -> { ops.enable(name); ok(msg); });
            case "mcp.disable" -> handleMcpNamed(msg, (ops, name) -> { ops.disable(name); ok(msg); });
            case "mcp.restart" -> handleMcpNamed(msg, (ops, name) -> { ops.restart(name); ok(msg); });
            case "mcp.logs" -> handleMcpNamed(msg, (ops, name) -> writer.result(msg.id(), Map.of("lines", ops.logs(name))));
            case "mcp.prompts" -> handleMcpNamed(msg, (ops, name) -> writer.result(msg.id(), Map.of("text", ops.prompts(name))));
            case "mcp.resources" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String name = p != null && p.hasNonNull("name") ? p.get("name").asText() : null;
                writer.result(msg.id(), Map.of("resources", ops.resources(name)));
            });
            case "mcp.config.upsert" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String scope = textParam(p, "scope"); String name = textParam(p, "name"); String command = textParam(p, "command");
                if (scope == null || name == null || command == null) { writer.error(msg.id(), -32602, "缺 scope/name/command"); return; }
                List<String> args = new ArrayList<>();
                if (p.has("args") && p.get("args").isArray()) p.get("args").forEach(a -> args.add(a.asText()));
                Map<String, String> env = new LinkedHashMap<>();
                if (p.has("env") && p.get("env").isObject())
                    p.get("env").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
                // IOException 只能在 lambda 内接:Consumer 不声明受检异常;新增会抛 IOException 的 mcp case 需同样内接
                try { ops.configUpsert(scope, name, command, args, env); ok(msg); }
                catch (IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
            });
            case "mcp.config.remove" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String scope = textParam(p, "scope"); String name = textParam(p, "name");
                if (scope == null || name == null) { writer.error(msg.id(), -32602, "缺 scope/name"); return; }
                try {
                    if (!ops.configRemove(scope, name)) { writer.error(msg.id(), -32000, "该层级无此配置: " + name); return; }
                    ok(msg);
                } catch (IOException e) { writer.error(msg.id(), -32000, "配置写入失败: " + e.getMessage()); }
            });
            case "model.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                java.util.Map<String, Object> listResult = session.modelList();
                if (listResult == null) { writer.error(msg.id(), -32000, "model.list unavailable"); return true; }
                writer.result(msg.id(), listResult);
            }
            case "session.setModel" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String provider = textParam(msg.params(), "provider");
                if (provider == null) { writer.error(msg.id(), -32602, "缺 provider"); return true; }
                try {
                    java.util.Map<String, Object> r = session.sessionSetModel(provider);
                    writer.result(msg.id(), r);
                } catch (IllegalArgumentException e) {
                    writer.error(msg.id(), -32602, e.getMessage());
                } catch (UnsupportedOperationException e) {
                    writer.error(msg.id(), -32000, e.getMessage());
                }
            }
            case "config.setDefaultProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String provider = textParam(msg.params(), "provider");
                if (provider == null) { writer.error(msg.id(), -32602, "缺 provider"); return true; }
                try {
                    java.util.Map<String, Object> r = session.configSetDefaultProvider(provider);
                    writer.result(msg.id(), r);
                } catch (IllegalArgumentException e) {
                    writer.error(msg.id(), -32602, e.getMessage());
                } catch (UnsupportedOperationException e) {
                    writer.error(msg.id(), -32000, e.getMessage());
                }
            }
            case "config.setProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                String apiKey = p != null && p.hasNonNull("apiKey") ? p.get("apiKey").asText() : null;
                String model = p != null && p.hasNonNull("model") ? p.get("model").asText() : null;
                String baseUrl = p != null && p.hasNonNull("baseUrl") ? p.get("baseUrl").asText() : null;
                String protocol = p != null && p.hasNonNull("protocol") ? p.get("protocol").asText() : null;
                String label = p != null && p.hasNonNull("label") ? p.get("label").asText() : null;
                try { writer.result(msg.id(), session.configSetProvider(id, apiKey, model, baseUrl, protocol, label)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.removeProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.configRemoveProvider(id)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.testProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                String apiKey = p != null && p.hasNonNull("apiKey") ? p.get("apiKey").asText() : null;
                String model = p != null && p.hasNonNull("model") ? p.get("model").asText() : null;
                String baseUrl = p != null && p.hasNonNull("baseUrl") ? p.get("baseUrl").asText() : null;
                String protocol = p != null && p.hasNonNull("protocol") ? p.get("protocol").asText() : null;
                try { writer.result(msg.id(), session.configTestProvider(id, apiKey, model, baseUrl, protocol)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.skillsList()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.setEnabled" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                boolean enabled = p != null && p.hasNonNull("enabled") ? p.get("enabled").asBoolean() : true;
                try { writer.result(msg.id(), session.skillsSetEnabled(name, enabled)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsGet(name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.upsert" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                String description = p != null && p.hasNonNull("description") ? p.get("description").asText() : "";
                String version = p != null && p.hasNonNull("version") ? p.get("version").asText() : "";
                String author = p != null && p.hasNonNull("author") ? p.get("author").asText() : "";
                String body = p != null && p.hasNonNull("body") ? p.get("body").asText() : "";
                java.util.List<String> tags = new java.util.ArrayList<>();
                if (p != null && p.has("tags") && p.get("tags").isArray()) {
                    p.get("tags").forEach(n -> { if (n.isTextual()) tags.add(n.asText()); });
                }
                try { writer.result(msg.id(), session.skillsUpsert(scope, name, description, version, author, tags, body)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.delete" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsDelete(scope, name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.existsInScope" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsExistsInScope(scope, name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.fork" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsFork(name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "stt.transcribe" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String audioBase64 = textParam(p, "audioBase64");
                String mime = textParam(p, "mime");
                if (audioBase64 == null || audioBase64.isBlank()) { writer.error(msg.id(), -32602, "缺 audioBase64"); return true; }
                try { writer.result(msg.id(), session.sttTranscribe(audioBase64, mime)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "gateway.config.get" -> {
                WraithConfig cfg = WraithConfig.load();
                WraithConfig.GatewayConfig gw = cfg.getGateway();
                WraithConfig.GatewayQqConfig qq = gw == null ? null : gw.getQq();
                boolean hasSecret = qq != null && qq.getClientSecret() != null && !qq.getClientSecret().isBlank();
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("bound", hasSecret);
                r.put("hasSecret", hasSecret);
                r.put("appId", qq == null ? null : qq.getAppId());
                r.put("ownerOpenid", qq == null ? null : qq.getOwnerOpenid());
                r.put("workspace", qq == null ? null : qq.getWorkspace());
                writer.result(msg.id(), r); // 注意:绝不回传 clientSecret 明文，只报 hasSecret
            }
            case "gateway.config.set" -> {
                JsonNode p = msg.params();
                try {
                    WraithConfig cfg = WraithConfig.load();
                    WraithConfig.GatewayConfig gw = cfg.getGateway();
                    if (gw == null) { gw = new WraithConfig.GatewayConfig(); cfg.setGateway(gw); }
                    WraithConfig.GatewayQqConfig qq = gw.getQq();
                    if (qq == null) { qq = new WraithConfig.GatewayQqConfig(); gw.setQq(qq); }
                    if (p != null && p.hasNonNull("clientSecret")) qq.setClientSecret(p.get("clientSecret").asText());
                    if (p != null && p.hasNonNull("workspace")) qq.setWorkspace(p.get("workspace").asText());
                    cfg.save();
                    ok(msg);
                } catch (Exception e) {
                    writer.error(msg.id(), -32000, "gateway 配置写入失败: " + e.getMessage());
                }
            }
            case "automations.list" -> {
                com.lyhn.wraith.automation.AutomationStore aStore = automationStore();
                writer.result(msg.id(), Map.of("tasks", aStore.loadTasks()));
            }
            case "automations.upsert" -> {
                JsonNode p = msg.params();
                if (p == null) { writer.error(msg.id(), -32602, "缺 task 参数"); return true; }
                com.lyhn.wraith.automation.AutomationTask task;
                try {
                    task = JsonRpc.MAPPER.treeToValue(p, com.lyhn.wraith.automation.AutomationTask.class);
                } catch (Exception e) {
                    writer.error(msg.id(), -32602, "task 解析失败: " + e.getMessage());
                    return true;
                }
                if (task.id == null || task.id.isBlank()) {
                    writer.error(msg.id(), -32602, "task 缺 id");
                    return true;
                }
                if (task.schedule != null
                        && task.schedule.kind == com.lyhn.wraith.automation.ScheduleKind.CRON
                        && !com.lyhn.wraith.automation.NextRun.isValidCron(task.schedule.expr)) {
                    writer.error(msg.id(), -32602, "非法 cron 表达式: " + task.schedule.expr);
                    return true;
                }
                com.lyhn.wraith.automation.AutomationStore st = automationStore();
                List<com.lyhn.wraith.automation.AutomationTask> existing = new ArrayList<>(st.loadTasks());
                existing.removeIf(t -> t.id.equals(task.id));
                existing.add(task);
                st.saveTasks(existing);
                ok(msg);
            }
            case "automations.remove" -> {
                JsonNode p = msg.params();
                String taskId = textParam(p, "id");
                if (taskId == null) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                com.lyhn.wraith.automation.AutomationStore st = automationStore();
                List<com.lyhn.wraith.automation.AutomationTask> remaining = new ArrayList<>(st.loadTasks());
                remaining.removeIf(t -> t.id.equals(taskId));
                st.saveTasks(remaining);
                // Note: automation-runs.json and automation-state.json are daemon-owned single-writer files.
                // The app-server must NOT write them to avoid racing the daemon. Orphaned runs age out via
                // RUNS_PER_TASK; the desktop can filter by existing task ids. This intentionally supersedes
                // the "remove its runs" phrasing in the spec which conflicts with §4 single-writer discipline.
                ok(msg);
            }
            case "automations.runs" -> {
                JsonNode p = msg.params();
                String filterTaskId = (p != null && p.hasNonNull("taskId") && !p.get("taskId").asText().isBlank())
                        ? p.get("taskId").asText() : null;
                com.lyhn.wraith.automation.AutomationStore st = automationStore();
                List<com.lyhn.wraith.automation.AutomationRun> runs = st.loadRuns();
                if (filterTaskId != null) {
                    final String fid = filterTaskId;
                    runs = runs.stream().filter(r -> fid.equals(r.taskId)).collect(java.util.stream.Collectors.toList());
                }
                writer.result(msg.id(), Map.of("runs", runs));
            }
            case "automations.runNow" -> {
                JsonNode p = msg.params();
                // Desktop sends { id: taskId }
                String taskId = textParam(p, "id");
                if (taskId == null) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try {
                    java.nio.file.Path reqDir = automationRequestsDir();
                    com.lyhn.wraith.automation.RequestInbox inbox =
                            new com.lyhn.wraith.automation.RequestInbox(reqDir);
                    inbox.write(new com.lyhn.wraith.automation.RequestInbox.Request("run-now", taskId, null));
                    ok(msg);
                } catch (java.io.IOException e) {
                    writer.error(msg.id(), -32000, "写入 run-now 请求失败: " + e.getMessage());
                }
            }
            case "automations.respondApproval" -> {
                JsonNode p = msg.params();
                // Desktop sends { runId, approvalId, decision, ...opts }
                // The inbox consumer keys on approvalId; accept both approvalId and id param names.
                String approvalId = textParam(p, "approvalId");
                if (approvalId == null) approvalId = textParam(p, "id");
                String decision = (p != null && p.hasNonNull("decision")) ? p.get("decision").asText() : null;
                if (approvalId == null) { writer.error(msg.id(), -32602, "缺 approvalId"); return true; }
                if (decision == null || decision.isBlank()) { writer.error(msg.id(), -32602, "缺 decision"); return true; }
                try {
                    java.nio.file.Path reqDir = automationRequestsDir();
                    com.lyhn.wraith.automation.RequestInbox inbox =
                            new com.lyhn.wraith.automation.RequestInbox(reqDir);
                    inbox.write(new com.lyhn.wraith.automation.RequestInbox.Request("approval", approvalId, decision));
                    ok(msg);
                } catch (java.io.IOException e) {
                    writer.error(msg.id(), -32000, "写入 approval 请求失败: " + e.getMessage());
                }
            }
            case "shutdown" -> {
                writer.result(msg.id(), Map.of("ok", true));
                return false;
            }
            default -> {
                if (!msg.isNotification()) writer.error(msg.id(), -32601, "method not found: " + msg.method());
            }
        }
        return true;
    }

    private void handleSessionStart(JsonRpc.Incoming msg) {
        String workspaceDir = null;
        JsonNode p = msg.params();
        if (p != null && p.hasNonNull("workspaceDir")) {
            String wd = p.get("workspaceDir").asText();
            if (wd != null && !wd.isBlank()) {
                if (!java.nio.file.Files.isDirectory(java.nio.file.Path.of(wd))) {
                    writer.error(msg.id(), -32602, "workspaceDir 不是有效目录: " + wd);
                    return;
                }
                workspaceDir = wd;
            }
        }
        sessionId = "sess_" + Long.toHexString(System.nanoTime());
        session = factory.create(writer, sessionId, workspaceDir);
        writer.result(msg.id(), Map.of("sessionId", sessionId));
    }

    private void handleTurn(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        Thread running = turnThread;
        if (running != null && running.isAlive()) {
            writer.error(msg.id(), -32000, "turn in progress");
            return;
        }
        JsonNode params = msg.params();
        String input = (params != null && params.hasNonNull("input")) ? params.get("input").asText() : "";

        // 附件解析与校验（失败走 started→turn.failed 时序，不发 LLM）
        TurnAttachments.Resolved att;
        try {
            att = TurnAttachments.resolve(params == null ? null : params.get("attachments"));
        } catch (IOException e) {
            String turnId = "turn_" + turnSeq.incrementAndGet();
            writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
            writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId));
            writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", "附件错误: " + e.getMessage()));
            return;
        }
        String effectiveInput = att.textPrefix().isEmpty() ? input : att.textPrefix() + input;

        String turnId = "turn_" + turnSeq.incrementAndGet();
        session.renderer().setCurrentTurnId(turnId);
        writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
        writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId));
        final TurnAttachments.Resolved attFinal = att;
        Thread t = new Thread(() -> {
            try {
                session.runTurn(effectiveInput, attFinal.imageParts(), attFinal.imageNames());
                String persisted = session.persistTurn();
                String reported = (persisted != null) ? persisted : sessionId;
                if (persisted != null) sessionId = persisted;
                writer.notify("turn.completed", Map.of("sessionId", reported, "turnId", turnId, "status", "completed"));
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", e.toString()));
            }
        }, "wraith-appserver-turn");
        t.setDaemon(true);
        turnThread = t;
        t.start();
    }

    private void handleApprovalRespond(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        if (msg.params() == null) { writer.error(msg.id(), -32602, "missing params"); return; }
        JsonNode p = msg.params();
        String approvalId = p.path("approvalId").asText("");
        String decision = p.path("decision").asText("REJECTED");
        String modifiedArgs = p.hasNonNull("modifiedArgs") ? p.get("modifiedArgs").asText() : null;
        String reason = p.hasNonNull("reason") ? p.get("reason").asText() : null;
        boolean allowNetwork = p.path("allowNetwork").asBoolean(false);
        ApprovalResult.Decision d;
        try {
            d = ApprovalResult.Decision.valueOf(decision);
        } catch (IllegalArgumentException e) {
            writer.error(msg.id(), -32602, "invalid decision: " + decision);
            return;
        }
        ApprovalResult result = new ApprovalResult(d, modifiedArgs, reason, allowNetwork);
        session.renderer().resolveApproval(approvalId, result);
        writer.result(msg.id(), java.util.Map.of("ok", true));
    }

    private void handleSetApprovalMode(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        boolean auto = p != null && p.path("auto").asBoolean(false);
        session.setApprovalMode(auto);
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionList(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        writer.result(msg.id(), Map.of("sessions", session.listSessions()));
    }

    private void ok(JsonRpc.Incoming msg) { writer.result(msg.id(), Map.of("ok", true)); }

    private static String textParam(JsonNode p, String field) {
        return p != null && p.hasNonNull(field) && !p.get(field).asText().isBlank() ? p.get(field).asText() : null;
    }

    /**
     * 解析 AutomationStore 基目录:
     * 1. 系统属性 wraith.automation.dir(测试可注入 TempDir)
     * 2. 否则 ~/.wraith
     */
    private static com.lyhn.wraith.automation.AutomationStore automationStore() {
        String prop = System.getProperty("wraith.automation.dir");
        java.nio.file.Path dir = (prop != null && !prop.isBlank())
                ? java.nio.file.Path.of(prop)
                : java.nio.file.Path.of(System.getProperty("user.home"), ".wraith");
        return new com.lyhn.wraith.automation.AutomationStore(dir);
    }

    /**
     * 解析 automation-requests 目录（与 automationStore() 同基目录下的 automation-requests 子目录）。
     */
    private static java.nio.file.Path automationRequestsDir() {
        String prop = System.getProperty("wraith.automation.dir");
        java.nio.file.Path base = (prop != null && !prop.isBlank())
                ? java.nio.file.Path.of(prop)
                : java.nio.file.Path.of(System.getProperty("user.home"), ".wraith");
        return base.resolve("automation-requests");
    }

    private void handleMcp(JsonRpc.Incoming msg, java.util.function.Consumer<McpOps> action) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        McpOps ops = session.mcp();
        if (ops == null) { writer.error(msg.id(), -32000, "mcp unavailable"); return; }
        try { action.accept(ops); }
        catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
        catch (java.util.NoSuchElementException | IllegalStateException e) { writer.error(msg.id(), -32000, e.getMessage()); }
        catch (Exception e) { writer.error(msg.id(), -32000, "mcp 操作失败: " + e.getMessage()); }
    }

    private void handleMcpNamed(JsonRpc.Incoming msg, java.util.function.BiConsumer<McpOps, String> action) {
        handleMcp(msg, ops -> {
            String name = textParam(msg.params(), "name");
            if (name == null) { writer.error(msg.id(), -32602, "缺 name"); return; }
            action.accept(ops, name);
        });
    }

    private void handleSessionRewind(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        Thread t = turnThread;
        if (t != null && t.isAlive()) { writer.error(msg.id(), -32000, "turn running"); return; }
        JsonNode p = msg.params();
        int ordinal = p == null ? 0 : p.path("userOrdinal").asInt(0);
        if (ordinal < 1) { writer.error(msg.id(), -32602, "missing userOrdinal"); return; }
        if (!session.rewind(ordinal)) { writer.error(msg.id(), -32000, "rewind failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionSetStarred(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        boolean starred = p.path("starred").asBoolean(false);
        if (!session.setSessionStarred(id, starred)) { writer.error(msg.id(), -32000, "setStarred failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionRename(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        String name = p.hasNonNull("name") ? p.get("name").asText() : null;
        if (!session.renameSession(id, name)) { writer.error(msg.id(), -32000, "rename failed"); return; }
        writer.result(msg.id(), Map.of("ok", true));
    }

    // Idempotency asymmetry: setStarred/rename return -32000 when session no longer exists (operation cannot apply),
    // but delete is idempotent (missing id still returns ok — "gone is gone").
    private void handleSessionDelete(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        session.deleteSession(id);   // 幂等:文件不存在也算删成功(前端只需知道"没了")
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleSessionResume(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = session.resume(id);
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            wire.add(com.lyhn.wraith.session.SessionMessageCodec.toJson(JsonRpc.MAPPER, m));
        }
        sessionId = id; // 活跃会话切到 resume 的
        // 取实际生效的 provider/model(由 runner 的 modelList 提供),以及 modelFallback 标志
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("sessionId", id);
        result.put("messages", wire);
        java.util.Map<String, Object> ml = session.modelList();
        if (ml != null) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> current = (java.util.Map<String, Object>) ml.get("current");
            if (current != null) {
                result.put("provider", current.get("provider"));
                result.put("model", current.get("model"));
            }
            Object fallback = ml.get("modelFallback");
            if (Boolean.TRUE.equals(fallback)) {
                result.put("modelFallback", true);
            }
        }
        writer.result(msg.id(), result);
    }
}
