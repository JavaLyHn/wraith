package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.ChoiceResult;

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
        /** 带执行模式的重载(react|plan);默认忽略 mode,退化到带图重载。桌面覆写以支持 plan。 */
        default String runTurn(String input,
                               java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                               java.util.List<String> imageNames,
                               String mode) throws Exception {
            return runTurn(input, imageParts, imageNames);
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
        /** 只读读取指定会话消息,不切活跃会话/不碰 agent(供预览)。默认空。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Message> peekSession(String sessionId) {
            return java.util.List.of();
        }
        /** 落盘当前对话,返回持久化后的真实 sessionId(空对话可能为 null)。默认 no-op。 */
        default String persistTurn() { return null; }
        /** 轮次开始即为新会话落最小桩,返回其 sessionId(续接会话为原 id;空输入 null)。使会话立刻进侧栏。默认 no-op。 */
        default String beginTurn(String input) { return null; }
        /** 真回溯:丢弃从第 userOrdinal 条 user 消息(1-based,含)起的全部历史。false=拒绝(超界等)。 */
        default boolean rewind(int userOrdinal) { return false; }
        default boolean setSessionStarred(String sessionId, boolean starred) { return false; }
        default boolean renameSession(String sessionId, String name) { return false; }
        default boolean deleteSession(String sessionId) { return false; }
        /**
         * 删会话的带项目重载。path 为 null/空 → 活跃项目(等价旧单参版本)。
         * 「设置 › 归档」是跨项目列表,删别的项目的归档会话必须走这个重载 ——
         * 否则跑在活跃 store 上找不到文件,静默失败。
         */
        default boolean deleteSession(String sessionId, String path) { return deleteSession(sessionId); }
        /** 批量项目概况:每项 {path, sessionCount, lastSessionAt}。默认空。 */
        default java.util.List<java.util.Map<String, Object>> projectSummary(java.util.List<String> paths) {
            return java.util.List.of();
        }
        /** 指定项目的最近未归档会话(只读,不切活跃项目)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listSessionsForProject(String path, int limit) {
            return java.util.List.of();
        }
        /** 加/去归档。path 为 null/空 → 活跃项目。默认 false。 */
        default boolean setSessionArchived(String sessionId, boolean archived, String path) { return false; }
        /** 跨项目已归档会话(按归档时间倒序)。默认空。 */
        default java.util.List<com.lyhn.wraith.session.SessionMeta> listArchivedSessions(
                java.util.List<String> paths, int limit) {
            return java.util.List.of();
        }
        /** 归档某项目下全部未归档会话,返回条数。默认 0。 */
        default int archiveProjectSessions(String path) { return 0; }
        /** 从指定会话创建分支:复制消息到新会话文件,返回新 id;默认 null(不支持)。 */
        default String branchSession(String sourceId) { return null; }
        /** MCP 操作面。实现可返回 null(表示 mcp 不可用)。默认 null。 */
        default McpOps mcp() { return null; }
        /**
         * 当前可用 provider 列表及当前生效 client 信息。
         * 返回 {@code {current:{provider,model}, default:String, providers:[{name,model,hasKey}]}}。
         * 默认返回 null(-32000)。
         */
        default java.util.Map<String, Object> modelList() { return null; }
        /** context.state.get 快照(spec Phase B §6)。默认 null(-32000)。 */
        default java.util.Map<String, Object> contextState() { return null; }
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
        /** 建/改一个用户或项目技能(references = [{path,content}],replace 模式)。默认抛出。 */
        default java.util.Map<String, Object> skillsUpsert(String scope, String name, String description,
                String version, String author, java.util.List<String> tags, String body,
                java.util.List<java.util.Map<String, String>> references) {
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
        /** 列出长期记忆(当前项目可见 + 全局)。默认抛出。 */
        default java.util.Map<String, Object> memoryList() {
            throw new UnsupportedOperationException("memoryList not implemented");
        }
        /** 搜索长期记忆(关键词,limit 由实现定)。默认抛出。 */
        default java.util.Map<String, Object> memorySearch(String query) {
            throw new UnsupportedOperationException("memorySearch not implemented");
        }
        /** 按 id 删除单条长期记忆,返回 {ok}。默认抛出。 */
        default java.util.Map<String, Object> memoryDelete(String id) {
            throw new UnsupportedOperationException("memoryDelete not implemented");
        }
        /** 手动保存一条长期记忆事实,scope ∈ project|global,返回 {ok}。默认抛出。 */
        default java.util.Map<String, Object> memorySave(String fact, String scope) {
            throw new UnsupportedOperationException("memorySave not implemented");
        }
        /** 清空全部长期记忆,返回 {ok}。默认抛出。 */
        default java.util.Map<String, Object> memoryClear() {
            throw new UnsupportedOperationException("memoryClear not implemented");
        }
        /** 生成/重写项目级记忆 WRAITH.md(force 覆盖已存在),返回 {written,path,message}。默认抛出。 */
        default java.util.Map<String, Object> memoryInitProject(boolean force) {
            throw new UnsupportedOperationException("memoryInitProject not implemented");
        }
        /** 待确认候选列表。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingList() {
            throw new UnsupportedOperationException("memoryPendingList not implemented");
        }
        /** 批准候选(ADD)。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingApprove(String id) {
            throw new UnsupportedOperationException("memoryPendingApprove not implemented");
        }
        /** 批准候选并替换旧条(SUPERSEDE)。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingApproveReplacing(String id, String oldId) {
            throw new UnsupportedOperationException("memoryPendingApproveReplacing not implemented");
        }
        /** 驳回候选。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingReject(String id) {
            throw new UnsupportedOperationException("memoryPendingReject not implemented");
        }
        /** 清空当前项目可见候选。默认抛出。 */
        default java.util.Map<String, Object> memoryPendingClear() {
            throw new UnsupportedOperationException("memoryPendingClear not implemented");
        }
        /** 非破坏地扫当前对话短期记忆产候选(不清对话)。默认抛出。 */
        default java.util.Map<String, Object> memoryExtractNow() {
            throw new UnsupportedOperationException("memoryExtractNow not implemented");
        }
        /** 列出 side-git 快照时间线(新→旧,含全相位;每条附 preTurnOffset)。默认抛出。 */
        default java.util.Map<String, Object> snapshotList(int limit) {
            throw new UnsupportedOperationException("snapshotList not implemented");
        }
        /** 恢复工作区到「最近第 offset 个 pre-turn 快照」,返回 {ok,message,…}。默认抛出。 */
        default java.util.Map<String, Object> snapshotRestore(int offset) {
            throw new UnsupportedOperationException("snapshotRestore not implemented");
        }
        /** 按 commitId 恢复到任意一张快照(含 pre-restore,可撤销上次恢复),返回 {ok,message,…}。默认抛出。 */
        default java.util.Map<String, Object> snapshotRestoreCommit(String commitId) {
            throw new UnsupportedOperationException("snapshotRestoreCommit not implemented");
        }
        /** 清理旧快照,返回 {ok,message}。默认抛出。 */
        /**
         * 快照开关的当前状态 {@code {enabled, source, locked}}。
         *
         * <p>{@code source} 是 {@code env}/{@code property}/{@code config}/{@code default}，
         * {@code locked} = 被 env/属性压住了、按钮点了也白点。
         * <b>面板必须据此置灰并说明原因</b>，不能让用户点了没反应 ——
         * 「面板显示的状态与实际生效的不是一回事」这个坑踩过一次了。默认抛出。
         */
        default java.util.Map<String, Object> snapshotSettings() {
            throw new UnsupportedOperationException("snapshotSettings not implemented");
        }

        /**
         * 开 / 关快照：<b>写盘 + 立刻对本会话生效</b>。
         *
         * <p>只写盘的话本次会话仍在照旧存（{@code SideGitManager} 的 config 是构造时捕获的）——
         * 那是本仓库第八次 snapshot-vs-live。默认抛出。
         */
        default java.util.Map<String, Object> snapshotSetEnabled(boolean enabled) {
            throw new UnsupportedOperationException("snapshotSetEnabled not implemented");
        }

        default java.util.Map<String, Object> snapshotClean() {
            throw new UnsupportedOperationException("snapshotClean not implemented");
        }
        /** 手动压缩当前对话历史(把早期消息压成摘要,释放上下文窗口)。默认抛出。 */
        default java.util.Map<String, Object> compactHistory() {
            throw new UnsupportedOperationException("compactHistory not implemented");
        }
        /** 后台任务列表(最近 limit 条,不含 result)。默认抛出。 */
        default java.util.Map<String, Object> taskList(int limit) {
            throw new UnsupportedOperationException("taskList not implemented");
        }
        /** 提交后台任务,返回 {ok,id}。默认抛出。 */
        default java.util.Map<String, Object> taskAdd(String prompt) {
            throw new UnsupportedOperationException("taskAdd not implemented");
        }
        /** 取单个后台任务完整信息(含 result/error),{found,...}。默认抛出。 */
        default java.util.Map<String, Object> taskGet(String id) {
            throw new UnsupportedOperationException("taskGet not implemented");
        }
        /** 取消后台任务,返回 {ok}。默认抛出。 */
        default java.util.Map<String, Object> taskCancel(String id) {
            throw new UnsupportedOperationException("taskCancel not implemented");
        }
        /** 删除一条终态后台任务,返回 {ok,message}。运行中/排队中拒绝。默认抛出。 */
        default java.util.Map<String, Object> taskDelete(String id) {
            throw new UnsupportedOperationException("taskDelete not implemented");
        }
        /** 安全策略状态(项目根/审计目录/危险工具集)。默认抛出。 */
        default java.util.Map<String, Object> policyStatus() {
            throw new UnsupportedOperationException("policyStatus not implemented");
        }
        /** 最近 limit 条危险工具审计记录(按天存)。默认抛出。 */
        default java.util.Map<String, Object> auditList(int limit) {
            throw new UnsupportedOperationException("auditList not implemented");
        }
        /** 命令沙箱状态 {available, networkAllowed}。默认抛出。 */
        default java.util.Map<String, Object> sandboxGet() {
            throw new UnsupportedOperationException("sandboxGet not implemented");
        }
        /** 运行时切换命令沙箱联网(session 级,不持久化),回读新状态。默认抛出。 */
        default java.util.Map<String, Object> sandboxSet(boolean networkAllowed) {
            throw new UnsupportedOperationException("sandboxSet not implemented");
        }
        /** 浏览器状态(模式/连接/CDP 探活)文本。默认抛出。 */
        default java.util.Map<String, Object> browserStatus() {
            throw new UnsupportedOperationException("browserStatus not implemented");
        }
        /** 连接本机 Chrome(port 为空=自动;否则按端口),返回结果文本。默认抛出。 */
        default java.util.Map<String, Object> browserConnect(String port) {
            throw new UnsupportedOperationException("browserConnect not implemented");
        }
        /** 断开、切回隔离模式,返回结果文本。默认抛出。 */
        default java.util.Map<String, Object> browserDisconnect() {
            throw new UnsupportedOperationException("browserDisconnect not implemented");
        }
        /** 列出共享浏览器标签页,返回结果文本。默认抛出。 */
        default java.util.Map<String, Object> browserTabs() {
            throw new UnsupportedOperationException("browserTabs not implemented");
        }
        /** 读 embedding 后端配置(key 不回,只回 hasKey)。默认抛出。 */
        default java.util.Map<String, Object> embeddingGet() {
            throw new UnsupportedOperationException("embeddingGet not implemented");
        }
        /** 写 embedding 后端配置(apiKey 空=保留旧)。默认抛出。 */
        default java.util.Map<String, Object> embeddingSet(String provider, String model, String baseUrl, String apiKey) {
            throw new UnsupportedOperationException("embeddingSet not implemented");
        }
        /** 读索引范围设置 {@code {excludeTests, excludeDocs}}。默认抛出。 */
        default java.util.Map<String, Object> ragScopeGet() {
            throw new UnsupportedOperationException("ragScopeGet not implemented");
        }
        /**
         * 写索引范围设置。<b>只写配置，不动索引</b> —— 改完要重建索引才生效，
         * 面板据 {@code rag.status} 回的索引范围提示「范围不符」。默认抛出。
         */
        default java.util.Map<String, Object> ragScopeSet(boolean excludeTests, boolean excludeDocs) {
            throw new UnsupportedOperationException("ragScopeSet not implemented");
        }
        /**
         * 「测试连接」：用表单值发一次真实 embedding 请求，回
         * {@code {ok, dim, latencyMs, provider, model, baseUrl, warning?}} 或 {@code {ok:false, error, hint?}}。
         *
         * <p>{@code apiKey} 空 = 沿用已存（同 {@code embeddingSet}）—— 测的必须正是保存会落盘的那套。
         * 回包<b>绝不含 key</b>。默认抛出。
         */
        default java.util.Map<String, Object> embeddingTest(String provider, String model, String baseUrl, String apiKey) {
            throw new UnsupportedOperationException("embeddingTest not implemented");
        }

        /**
         * 搜索后端的实时状态 {@code {provider, ready, hasKey, baseUrl, savedProvider}} —— 面板角标 + 表单回显用。
         *
         * <p><b>key 永不回传</b>，只回 {@code hasKey} 布尔：表单要能区分「没配过」和
         * 「配过但不给看」，否则它显示成空的、用户以为清空了，一保存就把好 key 覆盖没了。
         */
        default java.util.Map<String, Object> searchStatus() {
            throw new UnsupportedOperationException("searchStatus not implemented");
        }

        default java.util.Map<String, Object> gitStatus() {
            throw new UnsupportedOperationException("gitStatus not implemented");
        }

        /**
         * 写搜索后端配置（{@code apiKey} 空 = 保留旧，同 {@code embeddingSet}）。
         *
         * <p>回 {@code {ok:true}} 或 {@code {ok:false, error}} —— 错误走回包而不是
         * {@code writer.error}，因为表单要把那句话贴在字段旁边（同 {@code pricingSet}）。
         *
         * <p>校验规则来自 {@code SearchConfigRules}，与 CLI 的 {@code /config search} <b>同一份</b>。默认抛出。
         */
        default java.util.Map<String, Object> searchSet(String provider, String apiKey, String baseUrl) {
            throw new UnsupportedOperationException("searchSet not implemented");
        }

        /**
         * 「测试连接」：用表单值发一次<b>真实搜索请求</b>，回
         * {@code {ok, provider, results, latencyMs, sample?}} 或 {@code {ok:false, error}}。
         *
         * <p>{@code apiKey} 空 = 沿用已存（同 {@code searchSet}）—— 测的必须正是保存会落盘的那套，
         * 否则「测试通过但保存后不工作」（或反之）比没有这个按钮更糟。默认抛出。
         */
        default java.util.Map<String, Object> searchTest(String provider, String apiKey, String baseUrl) {
            throw new UnsupportedOperationException("searchTest not implemented");
        }

        default java.util.Map<String, Object> pricingGet() {
            throw new UnsupportedOperationException("pricingGet not implemented");
        }

        default java.util.Map<String, Object> pricingSet(java.util.List<java.util.Map<String, Object>> entries) {
            throw new UnsupportedOperationException("pricingSet not implemented");
        }
        /** RAG 索引状态 {indexed, chunkCount, relationCount}。默认抛出。 */
        default java.util.Map<String, Object> ragStatus() {
            throw new UnsupportedOperationException("ragStatus not implemented");
        }
        /** 建立/重建当前 workspace 的 RAG 索引(耗时,走后台线程)。默认抛出。 */
        default java.util.Map<String, Object> ragIndex() {
            throw new UnsupportedOperationException("ragIndex not implemented");
        }
        /** 语义+关键词混合检索,返回 {results:[...]}。默认抛出。 */
        default java.util.Map<String, Object> ragSearch(String query, int topK) {
            throw new UnsupportedOperationException("ragSearch not implemented");
        }
        /** 代码关系图谱查询,返回 {relations:[...]}。默认抛出。 */
        default java.util.Map<String, Object> ragGraph(String name) {
            throw new UnsupportedOperationException("ragGraph not implemented");
        }
        /**
         * 读取指定会话的 card 事件列表(供 resume 回放 plan/team 卡片)。
         * 每条记录为 {@code {turnOrdinal, events}} JsonNode。默认空列表(向后兼容)。
         */
        default java.util.List<com.fasterxml.jackson.databind.JsonNode> readCards(String id) {
            return java.util.List.of();
        }
        /** 内置工具目录(= 模型看到的定义:name/description/parameters)。默认空。供 UI 只读展示。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Tool> builtinTools() {
            return java.util.List.of();
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
            case "plan.review.respond" -> handlePlanReviewRespond(msg);
            case "choice.respond" -> handleChoiceRespond(msg);
            case "session.setApprovalMode" -> handleSetApprovalMode(msg);
            case "session.list" -> handleSessionList(msg);
            case "session.resume" -> handleSessionResume(msg);
            case "session.peek" -> handleSessionPeek(msg);
            case "tools.list" -> handleToolsList(msg);
            case "session.rewind" -> handleSessionRewind(msg);
            case "session.setStarred" -> handleSessionSetStarred(msg);
            case "session.rename" -> handleSessionRename(msg);
            case "session.delete" -> handleSessionDelete(msg);
            case "session.projectSummary" -> handleProjectSummary(msg);
            case "session.listForProject" -> handleListForProject(msg);
            case "session.setArchived" -> handleSessionSetArchived(msg);
            case "session.listArchived" -> handleListArchived(msg);
            case "session.archiveProject" -> handleArchiveProject(msg);
            case "session.branch" -> handleSessionBranch(msg);
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
            // mcp.test 在 reader 线程同步执行:最坏阻塞 ≈ initialize 超时 + tools/list 30s。
            // 单用户桌面 + 表单单飞行(测试中按钮禁用)可接受;若未来多会话并发,再 offload 到独立线程。
            case "mcp.test" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String scope = textParam(p, "scope"); String name = textParam(p, "name"); String command = textParam(p, "command");
                if (scope == null || name == null || command == null) { writer.error(msg.id(), -32602, "缺 scope/name/command"); return; }
                List<String> args = new ArrayList<>();
                if (p.has("args") && p.get("args").isArray()) p.get("args").forEach(a -> args.add(a.asText()));
                Map<String, String> env = new LinkedHashMap<>();
                if (p.has("env") && p.get("env").isObject())
                    p.get("env").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
                try { writer.result(msg.id(), ops.test(scope, name, command, args, env)); }
                catch (IOException e) { writer.error(msg.id(), -32000, "测试失败: " + e.getMessage()); }
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
            case "session.compact" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                // 压缩会调一次 LLM 生成摘要,耗时 → 后台线程,避免占用单线程分发循环
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::compactHistory);
            }
            case "context.state.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try {
                    java.util.Map<String, Object> st = session.contextState();
                    if (st == null) writer.error(msg.id(), -32000, "not supported");
                    else writer.result(msg.id(), st);
                } catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "task.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt() : 20;
                try { writer.result(msg.id(), session.taskList(limit)); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "task.add" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String prompt = textParam(msg.params(), "prompt");
                if (prompt == null || prompt.isBlank()) { writer.error(msg.id(), -32602, "缺 prompt"); return true; }
                try { writer.result(msg.id(), session.taskAdd(prompt)); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "task.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.taskGet(id)); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "task.cancel" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.taskCancel(id)); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "task.delete" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.taskDelete(id)); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
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
                // 必须 offload:探测是一次真实 HTTP 调用,而 dispatch 跑在 serve() 那条**唯一的**
                // reader 线程上 —— 同步执行会让整个 app-server 在探测期间处理不了任何 RPC,
                // 表现为「点了测试连接,整个桌面端都没反应」。dispatchAsync 另带 catch(Exception),
                // 所以任何逃逸都会变成正常的 error 帧而不是永不 settle 的 promise。
                final SessionRunner s = session;
                dispatchAsync(msg.id(), () -> s.configTestProvider(id, apiKey, model, baseUrl, protocol));
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
                java.util.List<java.util.Map<String, String>> references = new java.util.ArrayList<>();
                if (p != null && p.has("references") && p.get("references").isArray()) {
                    for (JsonNode n : p.get("references")) {
                        if (n != null && n.isObject()) {
                            java.util.Map<String, String> ref = new java.util.LinkedHashMap<>();
                            ref.put("path", n.hasNonNull("path") ? n.get("path").asText() : "");
                            ref.put("content", n.hasNonNull("content") ? n.get("content").asText() : "");
                            references.add(ref);
                        }
                    }
                }
                try { writer.result(msg.id(), session.skillsUpsert(scope, name, description, version, author, tags, body, references)); }
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
            case "memory.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryList()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.search" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String query = textParam(msg.params(), "query");
                if (query == null || query.isBlank()) { writer.error(msg.id(), -32602, "缺 query"); return true; }
                try { writer.result(msg.id(), session.memorySearch(query)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.delete" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.memoryDelete(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.save" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String fact = textParam(p, "fact");
                if (fact == null || fact.isBlank()) { writer.error(msg.id(), -32602, "缺 fact"); return true; }
                String scope = (p != null && p.hasNonNull("scope")) ? p.get("scope").asText() : "project";
                try { writer.result(msg.id(), session.memorySave(fact, scope)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.clear" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryClear()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.initProject" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                boolean force = p != null && p.hasNonNull("force") && p.get("force").asBoolean();
                try { writer.result(msg.id(), session.memoryInitProject(force)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingList" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryPendingList()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingApprove" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.memoryPendingApprove(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingApproveReplacing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                String oldId = textParam(p, "oldId");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                if (oldId == null || oldId.isBlank()) { writer.error(msg.id(), -32602, "缺 oldId"); return true; }
                try { writer.result(msg.id(), session.memoryPendingApproveReplacing(id, oldId)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingReject" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.memoryPendingReject(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.pendingClear" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryPendingClear()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "memory.extractNow" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::memoryExtractNow);   // 含 LLM 抽取调用(数秒级),后台跑防阻塞
            }
            case "snapshot.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt() : 0;
                try { writer.result(msg.id(), session.snapshotList(limit)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "snapshot.restore" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                int offset = (p != null && p.hasNonNull("offset")) ? p.get("offset").asInt() : 1;
                try { writer.result(msg.id(), session.snapshotRestore(offset)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "snapshot.restoreCommit" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String commitId = textParam(p, "commitId");
                if (commitId == null || commitId.isBlank()) { writer.error(msg.id(), -32602, "缺 commitId"); return true; }
                try { writer.result(msg.id(), session.snapshotRestoreCommit(commitId)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "snapshot.settings" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.snapshotSettings()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "snapshot.setEnabled" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                boolean enabled = p != null && p.hasNonNull("enabled") && p.get("enabled").asBoolean();
                try { writer.result(msg.id(), session.snapshotSetEnabled(enabled)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "snapshot.clean" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.snapshotClean()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "policy.status" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.policyStatus()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "audit.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt() : 20;
                try { writer.result(msg.id(), session.auditList(limit)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "sandbox.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.sandboxGet()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "sandbox.set" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                boolean net = p != null && p.hasNonNull("networkAllowed") && p.get("networkAllowed").asBoolean();
                try { writer.result(msg.id(), session.sandboxSet(net)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            // 浏览器 RPC 走后台线程:tabs/connect 可能触发 HITL 审批或阻塞在 MCP 上,
            // 若占用单线程分发循环会与 approval.respond 死锁(见 dispatchAsync 注释)。
            case "browser.status" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::browserStatus);
            }
            case "browser.connect" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                JsonNode p = msg.params();
                final String port = (p != null && p.hasNonNull("port")) ? p.get("port").asText() : null;
                dispatchAsync(msg.id(), () -> s.browserConnect(port));
            }
            case "browser.disconnect" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::browserDisconnect);
            }
            case "browser.tabs" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::browserTabs);
            }
            case "config.getEmbedding" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.embeddingGet()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.setEmbedding" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String provider = textParam(p, "provider");
                String model = (p != null && p.hasNonNull("model")) ? p.get("model").asText() : "";
                String baseUrl = (p != null && p.hasNonNull("baseUrl")) ? p.get("baseUrl").asText() : "";
                String apiKey = (p != null && p.hasNonNull("apiKey")) ? p.get("apiKey").asText() : "";
                try { writer.result(msg.id(), session.embeddingSet(provider, model, baseUrl, apiKey)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.getRagScope" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.ragScopeGet()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.setRagScope" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                boolean et = p != null && p.hasNonNull("excludeTests") && p.get("excludeTests").asBoolean();
                boolean ed = p != null && p.hasNonNull("excludeDocs") && p.get("excludeDocs").asBoolean();
                try { writer.result(msg.id(), session.ragScopeSet(et, ed)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.testEmbedding" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String provider = textParam(p, "provider");
                String model = (p != null && p.hasNonNull("model")) ? p.get("model").asText() : "";
                String baseUrl = (p != null && p.hasNonNull("baseUrl")) ? p.get("baseUrl").asText() : "";
                String apiKey = (p != null && p.hasNonNull("apiKey")) ? p.get("apiKey").asText() : "";
                // 必须 offload,同 config.testProvider:dispatch 跑在 serve() 那条**唯一的** reader
                // 线程上,同步执行会让整个 app-server 在探测期间处理不了任何 RPC —— 表现为
                // 「点了测试连接,整个桌面端都没反应」。embedding 的时间尺度更糟:ollama 首次请求
                // 要把模型载进内存(大模型 + 慢盘几十秒)。
                final SessionRunner s = session;
                dispatchAsync(msg.id(), () -> s.embeddingTest(provider, model, baseUrl, apiKey));
            }
            case "config.getSearch" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.searchStatus()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "git.status" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                // git.* 读取用户真实仓库，刻意与 Side-Git 的 snapshot.* 分开；
                // reader 自带三秒硬超时，因此这里同步返回，避免引入异步状态竞态。
                try { writer.result(msg.id(), session.gitStatus()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.setSearch" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String provider = textParam(p, "provider");
                String apiKey = (p != null && p.hasNonNull("apiKey")) ? p.get("apiKey").asText() : "";
                String baseUrl = (p != null && p.hasNonNull("baseUrl")) ? p.get("baseUrl").asText() : "";
                try { writer.result(msg.id(), session.searchSet(provider, apiKey, baseUrl)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.testSearch" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String provider = textParam(p, "provider");
                String apiKey = (p != null && p.hasNonNull("apiKey")) ? p.get("apiKey").asText() : "";
                String baseUrl = (p != null && p.hasNonNull("baseUrl")) ? p.get("baseUrl").asText() : "";
                // 必须 offload,同 config.testProvider / config.testEmbedding:dispatch 跑在 serve()
                // 那条**唯一的** reader 线程上,同步执行会让整个 app-server 在探测期间处理不了任何
                // RPC —— 表现为「点了测试连接,整个桌面端都没反应」。搜索请求同样要走网络。
                final SessionRunner s = session;
                dispatchAsync(msg.id(), () -> s.searchTest(provider, apiKey, baseUrl));
            }
            case "config.getPricing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.pricingGet()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.setPricing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                java.util.List<java.util.Map<String, Object>> entries = new java.util.ArrayList<>();
                JsonNode arr = p == null ? null : p.get("entries");
                if (arr != null && arr.isArray()) {
                    for (JsonNode node : arr) {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        row.put("modelPrefix", node.hasNonNull("modelPrefix") ? node.get("modelPrefix").asText() : "");
                        row.put("cacheHitPerM", node.hasNonNull("cacheHitPerM") ? node.get("cacheHitPerM").asDouble() : 0d);
                        row.put("cacheMissPerM", node.hasNonNull("cacheMissPerM") ? node.get("cacheMissPerM").asDouble() : 0d);
                        row.put("outputPerM", node.hasNonNull("outputPerM") ? node.get("outputPerM").asDouble() : 0d);
                        row.put("currency", node.hasNonNull("currency") ? node.get("currency").asText() : "CNY");
                        entries.add(row);
                    }
                }
                try { writer.result(msg.id(), session.pricingSet(entries)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "rag.status" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.ragStatus()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "rag.index" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                dispatchAsync(msg.id(), s::ragIndex);   // 索引耗时(逐块调 embedding),后台跑
            }
            case "rag.search" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                final SessionRunner s = session;
                JsonNode p = msg.params();
                final String query = textParam(p, "query");
                if (query == null || query.isBlank()) { writer.error(msg.id(), -32602, "缺 query"); return true; }
                final int topK = (p != null && p.hasNonNull("topK")) ? p.get("topK").asInt() : 8;
                dispatchAsync(msg.id(), () -> s.ragSearch(query, topK));   // 查询含 1 次 embedding,后台跑防阻塞
            }
            case "rag.graph" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.ragGraph(name)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "gateway.config.get" -> {
                JsonNode p = msg.params();
                String platform = (p != null && p.hasNonNull("platform")) ? p.get("platform").asText() : "qq";
                WraithConfig cfg = WraithConfig.load();
                WraithConfig.GatewayConfig gw = cfg.getGateway();
                Map<String, Object> r = new LinkedHashMap<>();
                if ("feishu".equals(platform)) {
                    WraithConfig.GatewayFeishuConfig fs = gw == null ? null : gw.getFeishu();
                    boolean hasSecret = fs != null && fs.getAppSecret() != null && !fs.getAppSecret().isBlank();
                    r.put("bound", hasSecret);
                    r.put("hasSecret", hasSecret);
                    r.put("appId", fs == null ? null : fs.getAppId());
                    r.put("ownerOpenid", fs == null ? null : fs.getOwnerOpenid());
                    r.put("region", fs == null ? null : fs.getRegion());
                    r.put("workspace", fs == null ? null : fs.getWorkspace());
                } else if ("wecom".equals(platform)) {
                    WraithConfig.GatewayWecomConfig wecom = gw == null ? null : gw.getWecom();
                    boolean hasSecret = wecom != null && wecom.getSecret() != null && !wecom.getSecret().isBlank();
                    r.put("bound", hasSecret);
                    r.put("hasSecret", hasSecret);
                    r.put("botId", wecom == null ? null : wecom.getBotId());
                    r.put("ownerUserid", wecom == null ? null : wecom.getOwnerUserid());
                    r.put("workspace", wecom == null ? null : wecom.getWorkspace());
                    // 注意:绝不 put secret 明文,只报 hasSecret
                } else if ("weixin".equals(platform)) {
                    // 微信:读 wechat 账号店(token/游标高频写,不进 config.json);绝不回 token
                    boolean bound = false; String owner = null; String ws = null;
                    try {
                        var acc = com.lyhn.wraith.wechat.WechatAccountStore.createDefault().loadLatest();
                        if (acc.isPresent()) {
                            bound = acc.get().token() != null && !acc.get().token().isBlank();
                            owner = acc.get().boundUserId();
                            ws = acc.get().workspace();
                        }
                    } catch (Exception e) { /* 账号店缺失/损坏 → 按未绑定视图 */ }
                    r.put("bound", bound);
                    r.put("hasSecret", bound);
                    r.put("ownerUserid", owner);
                    r.put("workspace", ws);
                } else {
                    WraithConfig.GatewayQqConfig qq = gw == null ? null : gw.getQq();
                    boolean hasSecret = qq != null && qq.getClientSecret() != null && !qq.getClientSecret().isBlank();
                    r.put("bound", hasSecret);
                    r.put("hasSecret", hasSecret);
                    r.put("appId", qq == null ? null : qq.getAppId());
                    r.put("ownerOpenid", qq == null ? null : qq.getOwnerOpenid());
                    r.put("workspace", qq == null ? null : qq.getWorkspace());
                }
                writer.result(msg.id(), r); // 注意:绝不回传 secret 明文,只报 hasSecret
            }
            case "gateway.config.set" -> {
                JsonNode p = msg.params();
                String platform = (p != null && p.hasNonNull("platform")) ? p.get("platform").asText() : "qq";
                try {
                    WraithConfig cfg = WraithConfig.load();
                    WraithConfig.GatewayConfig gw = cfg.getGateway();
                    if (gw == null) { gw = new WraithConfig.GatewayConfig(); cfg.setGateway(gw); }
                    if ("feishu".equals(platform)) {
                        WraithConfig.GatewayFeishuConfig fs = gw.getFeishu();
                        if (fs == null) { fs = new WraithConfig.GatewayFeishuConfig(); gw.setFeishu(fs); }
                        if (p != null && p.hasNonNull("appId")) fs.setAppId(p.get("appId").asText());
                        if (p != null && p.hasNonNull("appSecret")) fs.setAppSecret(p.get("appSecret").asText());
                        if (p != null && p.hasNonNull("ownerOpenid")) fs.setOwnerOpenid(p.get("ownerOpenid").asText());
                        if (p != null && p.hasNonNull("region")) fs.setRegion(p.get("region").asText());
                        if (p != null && p.hasNonNull("workspace")) fs.setWorkspace(p.get("workspace").asText());
                    } else if ("wecom".equals(platform)) {
                        WraithConfig.GatewayWecomConfig wecom = gw.getWecom();
                        if (wecom == null) { wecom = new WraithConfig.GatewayWecomConfig(); gw.setWecom(wecom); }
                        if (p != null && p.hasNonNull("botId")) wecom.setBotId(p.get("botId").asText());
                        // secret 仅当非空才写,空则保持已存,不覆盖
                        if (p != null && p.hasNonNull("secret") && !p.get("secret").asText().isBlank())
                            wecom.setSecret(p.get("secret").asText());
                        if (p != null && p.hasNonNull("ownerUserid")) wecom.setOwnerUserid(p.get("ownerUserid").asText());
                        if (p != null && p.hasNonNull("workspace")) wecom.setWorkspace(p.get("workspace").asText());
                    } else if ("weixin".equals(platform)) {
                        // 只允许改 workspace;token/owner 由 bind-weixin 扫码流程写入账号店
                        if (p != null && p.hasNonNull("workspace")) {
                            try {
                                var store = com.lyhn.wraith.wechat.WechatAccountStore.createDefault();
                                store.loadLatest().ifPresent(acc ->
                                        store.save(acc.withWorkspace(p.get("workspace").asText())));
                            } catch (Exception e) { /* 账号店缺失/损坏,忽略 */ }
                        }
                    } else {
                        WraithConfig.GatewayQqConfig qq = gw.getQq();
                        if (qq == null) { qq = new WraithConfig.GatewayQqConfig(); gw.setQq(qq); }
                        if (p != null && p.hasNonNull("clientSecret")) qq.setClientSecret(p.get("clientSecret").asText());
                        if (p != null && p.hasNonNull("workspace")) qq.setWorkspace(p.get("workspace").asText());
                    }
                    cfg.save();
                    ok(msg);
                } catch (Exception e) {
                    writer.error(msg.id(), -32000, "gateway 配置写入失败: " + e.getMessage());
                }
            }
            case "automations.list" -> {
                com.lyhn.wraith.automation.AutomationStore aStore = automationStore();
                // loadTasksForView 而非 loadTasks:后者不含 lastFiredAt(归 automation-state.json),
                // 桌面据此算「下次触发」,拿不到就永远从 enabledAt 推、与真实执行脱节。
                writer.result(msg.id(), Map.of("tasks", aStore.loadTasksForView()));
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
                // load→removeIf→save 是复合操作,必须整段包在 AutomationStore.TASKS_LOCK
                // 里——分别给 loadTasks()/saveTasks() 加锁不足以防止与 agent 工具线程
                // (ToolRegistry automation_upsert)交叠出丢失更新,详见 AutomationStore 的
                // TASKS_LOCK javadoc。
                synchronized (com.lyhn.wraith.automation.AutomationStore.TASKS_LOCK) {
                    com.lyhn.wraith.automation.AutomationStore st = automationStore();
                    List<com.lyhn.wraith.automation.AutomationTask> existing = new ArrayList<>(st.loadTasks());
                    existing.removeIf(t -> t.id.equals(task.id));
                    existing.add(task);
                    st.saveTasks(existing);
                }
                ok(msg);
            }
            case "automations.remove" -> {
                JsonNode p = msg.params();
                String taskId = textParam(p, "id");
                if (taskId == null) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                // 同上:load→removeIf→save 整段包锁,防止与 ToolRegistry automation_remove
                // 交叠出丢失更新。
                synchronized (com.lyhn.wraith.automation.AutomationStore.TASKS_LOCK) {
                    com.lyhn.wraith.automation.AutomationStore st = automationStore();
                    List<com.lyhn.wraith.automation.AutomationTask> remaining = new ArrayList<>(st.loadTasks());
                    remaining.removeIf(t -> t.id.equals(taskId));
                    st.saveTasks(remaining);
                }
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
                // 只有 daemon 有 runner:它没运行就无法本地兜底,必须如实报失败并回收请求文件,
                // 否则界面点了没反应、而网关下次启动时这任务会凭空跑起来。等宽限期故走 dispatchAsync。
                final java.nio.file.Path runReqDir = automationRequestsDir();
                final String runTaskId = taskId;
                dispatchAsync(msg.id(), () -> daemonHandoffResult(
                        runReqDir, new com.lyhn.wraith.automation.RequestInbox.Request("run-now", runTaskId, null)));
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
                // 同 run-now:审批的落地只有 daemon 能做,不能假装成功(否则决定会在网关启动时凭空生效)。
                final java.nio.file.Path apReqDir = automationRequestsDir();
                final String apId = approvalId;
                final String apDecision = decision;
                dispatchAsync(msg.id(), () -> daemonHandoffResult(
                        apReqDir, new com.lyhn.wraith.automation.RequestInbox.Request("approval", apId, apDecision)));
            }
            case "automations.qqPending" -> {
                // 直读快照:store 原子写(tmp→ATOMIC_MOVE)保证跨进程读到完整旧/新文件;
                // 写操作(删/清)必须经 RequestInbox 由 daemon 在其实例锁内执行。
                java.nio.file.Path wraithDir = automationRequestsDir().getParent();
                com.lyhn.wraith.automation.delivery.QqPendingStore qp =
                        new com.lyhn.wraith.automation.delivery.QqPendingStore(wraithDir);
                List<Map<String, Object>> items = new ArrayList<>();
                for (com.lyhn.wraith.automation.delivery.QqPendingStore.Pending pd : qp.snapshot()) {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    if (pd.id != null) m.put("id", pd.id);
                    m.put("taskName", pd.taskName == null ? "" : pd.taskName);
                    String ans = pd.answer == null ? "" : pd.answer;
                    m.put("answerPreview", ans.length() > 120 ? ans.substring(0, 120) + "…" : ans);
                    m.put("ts", pd.ts);
                    m.put("kind", pd.approvalId != null ? "approval" : "result");
                    if (pd.approvalId != null) m.put("approvalId", pd.approvalId);
                    items.add(m);
                }
                writer.result(msg.id(), Map.of("items", items, "count", items.size()));
            }
            case "automations.qqPendingClear" -> {
                JsonNode p = msg.params();
                String pendingId = textParam(p, "id"); // null → 清空全部结果项
                // 经 RequestInbox 交给 daemon(它持有实例锁);daemon 没运行时由本进程兜底,
                // 否则点了「清空」什么都不会发生、下次网关起来那些消息还会照发。
                // 会等待宽限期,故必须走 dispatchAsync —— 分发线程是单线程,阻塞它会卡死整个后端。
                final java.nio.file.Path reqDir = automationRequestsDir();
                dispatchAsync(msg.id(), () -> {
                    com.lyhn.wraith.automation.delivery.QqPendingClearCoordinator.Outcome outcome =
                            com.lyhn.wraith.automation.delivery.QqPendingClearCoordinator.clear(
                                    new com.lyhn.wraith.automation.RequestInbox(reqDir),
                                    new com.lyhn.wraith.automation.delivery.QqPendingStore(reqDir.getParent()),
                                    pendingId);
                    return Map.of("ok", true, "appliedBy",
                            outcome == com.lyhn.wraith.automation.delivery.QqPendingClearCoordinator
                                    .Outcome.APPLIED_LOCALLY ? "app-server" : "daemon");
                });
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

    /**
     * 归一化执行模式。
     *
     * <p>只有 {@code plan} / {@code team} 会走各自的分支（见 Main 里那个四参
     * {@code runTurn} 覆写），其余一切都按 ReAct 跑。此前没有这一步：拼错的、带空格的、
     * 大写的值都会<b>安静地降级成 ReAct</b>，而 {@code turn.started} 又不回声模式，
     * 于是谁都不知道本轮其实没按选的模式跑。
     *
     * <p>宽松地接受 trim + 大小写形式，但认不出来的一律回 {@code react} ——
     * 与实际行为一致，绝不回一个从未生效过的值。
     */
    static String normalizeRunMode(String raw) {
        if (raw == null) {
            return "react";
        }
        String v = raw.trim().toLowerCase(java.util.Locale.ROOT);
        return ("plan".equals(v) || "team".equals(v)) ? v : "react";
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
        // 读取执行模式(react|plan|team),缺省 react。**归一化一次**并把结果回声在
        // turn.started 里 —— 此前这条线是单向的:前端一个 React state → 参数 → 分支,
        // 没有任何回声。用户于是「不能知道 agent 有没有感知到模式的切换」;更糟的是
        // 拼错/带空格/大写的值会安静地按 react 跑而没人知道。
        String mode = normalizeRunMode(params != null && params.hasNonNull("mode")
                ? params.get("mode").asText("react") : "react");

        // 附件解析与校验（失败走 started→turn.failed 时序，不发 LLM）
        TurnAttachments.Resolved att;
        try {
            att = TurnAttachments.resolve(params == null ? null : params.get("attachments"));
        } catch (IOException e) {
            String turnId = "turn_" + turnSeq.incrementAndGet();
            writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
            writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId, "mode", mode));
            writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", "附件错误: " + e.getMessage()));
            return;
        }
        String effectiveInput = att.textPrefix().isEmpty() ? input : att.textPrefix() + input;

        String turnId = "turn_" + turnSeq.incrementAndGet();
        session.renderer().setCurrentTurnId(turnId);
        // 新会话:轮次开始即落桩,使会话立刻出现在侧栏(不必等 turn 末 persist);续接会话返回原 id。
        String beginId = session.beginTurn(input);
        if (beginId != null && !beginId.isBlank()) {
            sessionId = beginId;
            // 渲染器必须一起换,否则它发的 thinking / message / approval.requested 仍带旧 wire id,
            // 同一条流上两种 sessionId 并存 —— 下游任何按会话过滤的逻辑都会误伤。
            session.renderer().setSessionId(sessionId);
        }
        writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
        // mode 是归一化之后的值 = 后端真正要用的那个。原样回传参数只能证明"我收到了字符串",
        // 证明不了"我按它跑"。
        writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId, "mode", mode));
        final TurnAttachments.Resolved attFinal = att;
        final String modeFinal = mode;
        Thread t = new Thread(() -> {
            try {
                String returned = session.runTurn(effectiveInput, attFinal.imageParts(), attFinal.imageNames(), modeFinal);
                EventStreamRenderer renderer = session.renderer();
                boolean silentFailure = shouldEmitFallback(renderer.emittedAssistantContent(), returned);
                if (silentFailure) {
                    // ReAct 静默失败兜底：本轮没有流出任何正文，但 runTurn 返回了非空白文本
                    // （典型如 Agent.runReActLoopInner 捕获 LLM IOException 后返回的 "❌ 调用 LLM 失败: ..."）。
                    // Plan/Team 已经通过流式 emitPlan*/emitTeam* 或 getLastCleanResult 机制把最终答案发出，
                    // emittedAssistantContent() 为 true，这里不会二次发送。
                    renderer.appendAssistantContentDelta(returned);
                    renderer.finishAssistantContent();
                }
                String persisted = session.persistTurn();
                String reported = (persisted != null) ? persisted : sessionId;
                if (persisted != null) {
                    sessionId = persisted;
                    session.renderer().setSessionId(sessionId); // 同上:两处换号点都要同步渲染器
                }
                if (silentFailure) {
                    // 静默失败:该轮次确实异常中断(LLM 调用失败 / budget 耗尽等),但错误文本已兜底发出,
                    // 不算 turn.failed(否则桌面端会误报「空轮次」)。挂一个 error 字段让前端侧栏
                    // 能给对应会话打上感叹号,用户一眼看出哪轮出过问题。
                    writer.notify("turn.completed", Map.of("sessionId", reported, "turnId", turnId, "status", "completed", "error", returned));
                } else {
                    writer.notify("turn.completed", Map.of("sessionId", reported, "turnId", turnId, "status", "completed"));
                }
            } catch (Exception e) {
                writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", e.toString()));
            }
        }, "wraith-appserver-turn");
        t.setDaemon(true);
        turnThread = t;
        t.start();
    }

    /**
     * ReAct 静默失败兜底判定：Agent.runReActLoopInner 捕获 LLM 调用异常（如 402 余额不足）后
     * 不重新抛出，而是把提示串直接 return——本轮不会有任何 message.delta，也不会触发
     * turn.failed，桌面端因此显示"空轮次"。仅当本轮从未流出正文且 runTurn 返回了非空白文本时，
     * 才把该文本当作兜底正文补发；已流式产出内容（含 Plan/Team 的 getLastCleanResult 路径）时
     * 不应重复。纯函数，不触碰 renderer/session，方便脱离整条 AppServer 独立测试。
     */
    static boolean shouldEmitFallback(boolean emittedAssistantContent, String returned) {
        return !emittedAssistantContent && returned != null && !returned.isBlank();
    }

    /**
     * 投递一条需要 gateway daemon 执行的请求,把「有没有人接手」如实回给调用方。
     * ok=false + reason=gateway-not-running 表示没有活着的 daemon,请求已被回收
     * (不留在 inbox 里,避免网关下次启动时凭空补执行)。
     */
    private static Map<String, Object> daemonHandoffResult(
            java.nio.file.Path requestsDir, com.lyhn.wraith.automation.RequestInbox.Request request)
            throws java.io.IOException {
        com.lyhn.wraith.automation.DaemonRequest.Outcome outcome =
                com.lyhn.wraith.automation.DaemonRequest.submit(
                        new com.lyhn.wraith.automation.RequestInbox(requestsDir), request);
        return outcome == com.lyhn.wraith.automation.DaemonRequest.Outcome.CONSUMED_BY_DAEMON
                ? Map.of("ok", true)
                : Map.of("ok", false, "reason", "gateway-not-running");
    }

    /**
     * 在后台守护线程上跑一个会阻塞的 RPC(如浏览器工具触发 HITL 审批),避免占用单线程分发循环
     * —— 否则分发线程卡在工具里等审批,而审批的 approval.respond 又要靠分发线程读取,形成死锁。
     * 结果/错误在完成时通过线程安全的 writer 回给对应请求 id。
     */
    private void dispatchAsync(Object id, java.util.concurrent.Callable<Map<String, Object>> work) {
        Thread t = new Thread(() -> {
            try { writer.result(id, work.call()); }
            catch (UnsupportedOperationException e) { writer.error(id, -32000, e.getMessage()); }
            catch (Exception e) { writer.error(id, -32000, e.getMessage()); }
        }, "wraith-appserver-async");
        t.setDaemon(true);
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

    /** 处理前端的计划复审响应（镜像 handleApprovalRespond）。 */
    private void handlePlanReviewRespond(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String reviewId = (p != null && p.hasNonNull("reviewId")) ? p.get("reviewId").asText() : null;
        if (reviewId == null) { writer.error(msg.id(), -32602, "缺 reviewId"); return; }
        String decision = (p.hasNonNull("decision")) ? p.get("decision").asText("cancel") : "cancel";
        String feedback = p.hasNonNull("feedback") ? p.get("feedback").asText(null) : null;
        session.renderer().resolvePlanReview(reviewId, decision, feedback);
        writer.result(msg.id(), java.util.Map.of("ok", true));
    }

    /** 处理前端的交互式选择器响应（镜像 handleApprovalRespond）。 */
    private void handleChoiceRespond(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        if (p == null) { writer.error(msg.id(), -32602, "missing params"); return; }
        String choiceId = p.path("choiceId").asText("");
        if (choiceId.isBlank()) { writer.error(msg.id(), -32602, "缺 choiceId"); return; }
        boolean cancelled = p.path("cancelled").asBoolean(false);
        int selectedIndex = p.path("selectedIndex").asInt(-1);
        ChoiceResult result = cancelled ? ChoiceResult.cancelled() : ChoiceResult.selected(selectedIndex);
        session.renderer().resolveChoice(choiceId, result);
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
        return com.lyhn.wraith.automation.AutomationStore.openDefault();
    }

    /**
     * 解析 automation-requests 目录（与 automationStore() 同基目录下的 automation-requests 子目录）。
     */
    private static java.nio.file.Path automationRequestsDir() {
        return com.lyhn.wraith.automation.AutomationStore.defaultRequestsDir();
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
        // path 可选:给了就删那个项目的,没给就删活跃项目的(旧调用方零改动)
        session.deleteSession(id, textParam(p, "path"));   // 幂等:文件不存在也算删成功
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleProjectSummary(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        List<String> paths = stringArrayParam(msg.params(), "paths");
        if (paths == null) { writer.error(msg.id(), -32602, "missing paths"); return; }
        writer.result(msg.id(), Map.of("summaries", session.projectSummary(paths)));
    }

    private void handleListForProject(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String path = textParam(p, "path");
        if (path == null) { writer.error(msg.id(), -32602, "missing path"); return; }
        int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt(50) : 50;
        writer.result(msg.id(), Map.of("sessions", session.listSessionsForProject(path, limit)));
    }

    private void handleSessionSetArchived(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        boolean archived = p.path("archived").asBoolean(false);
        // 与 setStarred 同样的幂等不对称:目标会话不存在 = 操作无法施加 → -32000(不是 ok)
        if (!session.setSessionArchived(id, archived, textParam(p, "path"))) {
            writer.error(msg.id(), -32000, "setArchived failed"); return;
        }
        writer.result(msg.id(), Map.of("ok", true));
    }

    private void handleListArchived(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        List<String> paths = stringArrayParam(p, "paths");
        if (paths == null) { writer.error(msg.id(), -32602, "missing paths"); return; }
        int limit = (p != null && p.hasNonNull("limit")) ? p.get("limit").asInt(0) : 0;
        writer.result(msg.id(), Map.of("sessions", session.listArchivedSessions(paths, limit)));
    }

    private void handleArchiveProject(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        String path = textParam(msg.params(), "path");
        if (path == null) { writer.error(msg.id(), -32602, "missing path"); return; }
        writer.result(msg.id(), Map.of("archived", session.archiveProjectSessions(path)));
    }

    /** 读一个字符串数组参数。字段缺失/不是数组 → null(调用方回 -32602);空数组是合法的。 */
    private static List<String> stringArrayParam(JsonNode p, String field) {
        if (p == null || !p.has(field) || !p.get(field).isArray()) {
            return null;
        }
        List<String> out = new ArrayList<>();
        p.get(field).forEach(n -> {
            String s = n.asText();
            if (s != null && !s.isBlank()) {
                out.add(s);
            }
        });
        return out;
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
        result.put("cards", session.readCards(id));
        writer.result(msg.id(), result);
    }

    /** 从指定会话创建分支:复制源会话消息到新会话,返回新会话 id。 */
    private void handleSessionBranch(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String sourceId = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (sourceId.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        String newId = session.branchSession(sourceId);
        if (newId == null || newId.isBlank()) {
            writer.error(msg.id(), -32000, "branch failed: source session not found or empty");
            return;
        }
        writer.result(msg.id(), Map.of("sessionId", newId));
    }

    private void handleSessionPeek(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        String id = (p != null && p.hasNonNull("sessionId")) ? p.get("sessionId").asText() : "";
        if (id.isBlank()) { writer.error(msg.id(), -32602, "missing sessionId"); return; }
        // 纯只读:绝不 sessionId = id,绝不碰 agent/model。
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = session.peekSession(id);
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            wire.add(com.lyhn.wraith.session.SessionMessageCodec.toJson(JsonRpc.MAPPER, m));
        }
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("sessionId", id);
        result.put("messages", wire);
        result.put("cards", session.readCards(id));
        writer.result(msg.id(), result);
    }

    private void handleToolsList(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        // 纯只读:仅回工具定义,不改 sessionId/agent。
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Tool t : session.builtinTools()) {
            com.fasterxml.jackson.databind.node.ObjectNode n = JsonRpc.MAPPER.createObjectNode();
            n.put("name", t.name());
            n.put("description", t.description() == null ? "" : t.description());
            if (t.parameters() != null) {
                n.set("parameters", t.parameters());   // JSON schema;null 时省略该字段
            }
            wire.add(n);
        }
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("tools", wire);
        writer.result(msg.id(), result);
    }
}
