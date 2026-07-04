# 常驻 cron + 多 IM 投递(v1)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把定时调度从 Electron 主进程迁进常驻 Java daemon,跑完 agent 回合按 `deliverTo` 经投递抽象送达(QQ pull/被动 + 桌面观察式),支持四种 schedule(含 cron 表达式)、有界并发、三模式审批(deny/auto-approve/ask)+ 按工具 allowlist,并迁移现有 automations。

**Architecture:** daemon(现 `wraith gateway`)新增 `Scheduler`(30s tick + 有界池)、`AutomationRunner`(进程内跑回合,复刻 `GatewaySession` 装配但换成策略化 renderer)、`Deliverer`(平台适配器分发)。两进程用 `~/.wraith/` 下单写者文件当接口(桌面经 app-server RPC 读写定义、daemon 读定义/写状态与历史)。桌面 `AutomationsPanel` 退化为配置编辑器。

**Tech Stack:** Java 17 / Maven / Jackson / OkHttp / JUnit5 / Mockito / MockWebServer;cron-utils(`CronType.UNIX`);Electron + React + TypeScript + vitest。

## Global Constraints

- 包名 `com.lyhn.wraith`;Java 17;Maven。
- 密钥只存 `~/.wraith/config.json`,绝不进日志/入库;每次提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 测试默认跳过,需 `-DskipTests=false`;门禁 = Java 全量 0F/0E + 桌面 `npm run typecheck` + `npm test` + `npm run build` 全绿。
- 审批默认 `deny`(deny-all 基线);QQ 单聊 only;push 是对外操作需用户点头;中文回答。
- 新依赖:`com.cronutils:cron-utils`(UNIX 5 段)。
- 存储:原子写(temp+rename)+ 单写者/文件;本机时区;`maxConcurrent` 默认 3;`askTimeoutMinutes` 默认 30;daily/weekly 宽限 `GRACE_MS=90_000`。
- 分支:`feat/cron-delivery`(spec 已在此分支)。

---

## File Structure

**Java 新包 `com.lyhn.wraith.automation`:**
- `automation/Schedule.java` — POJO:`ScheduleKind kind` + `Integer everyMinutes / String time / Integer weekday / String expr`。
- `automation/ApprovalPolicy.java` — POJO:`ApprovalMode default_` + `Map<String,ApprovalMode> tools` + `Integer askTimeoutMinutes`;`ApprovalMode resolve(String tool)`。
- `automation/DeliveryTarget.java` — POJO:`String platform` + `String chatId`(nullable)。
- `automation/AutomationTask.java` — POJO:id/name/prompt/workspace/schedule/enabled/deliverTo/approval/createdAt/enabledAt。
- `automation/AutomationRun.java` — POJO:runId/taskId/startedAt/endedAt/status/sessionId/summary/miss。
- `automation/NextRun.java` — `static long computeNextRun(Schedule,long now,Long lastFiredAt,long enabledAt)` + `static boolean isValidCron(String)`。
- `automation/AutomationStore.java` — 读定义 / 读写状态(lastFiredAt) / 读写历史;原子写。
- `automation/ScheduledRunRenderer.java` — `implements Renderer`,策略化 `promptApproval`。
- `automation/AutomationRunner.java` — 复刻 `GatewaySession` 装配跑一轮,返回 `RunResult`。
- `automation/Scheduler.java` — tick + 有界池 + 到点触发 + per-task 去重 + miss。
- `automation/RequestInbox.java` — 轮询 `~/.wraith/automation-requests/`(run-now / 审批响应)。
- `automation/delivery/DeliveryAdapter.java` — 接口。
- `automation/delivery/Deliverer.java` — 分发器。
- `automation/delivery/QqDeliveryAdapter.java` / `DesktopDeliveryAdapter.java`。
- `automation/delivery/QqPendingStore.java` — `qq-pending.json`。
- Modify `gateway/GatewayDaemon.java`、`runtime/appserver/AppServer.java`、`pom.xml`。

**Desktop:**
- Modify `desktop/src/shared/types.ts`(扩类型)。
- Create `desktop/src/main/automationMigration.ts`(纯映射 + 一次性迁移)。
- Modify `desktop/src/main/index.ts`(IPC→app-server RPC;移除本地 scheduler;启动时迁移)。
- Modify `desktop/src/preload/index.ts`(暴露方法)。
- Modify `desktop/src/renderer/components/AutomationForm.tsx`(cron 输入 + 审批配置 + deliverTo)与 `AutomationsPanel.tsx`(走 RPC)。
- Retire `desktop/src/main/automationScheduler.ts / automationRunner.ts / automationsStore.ts / automationRunState.ts / automationSchedule.ts` 及其测试(调度逻辑移到 Java)。

---

# Phase 1 — Java 自动化核心(daemon 常驻调度 + 进程内跑回合 + 历史)

产出可测增量:daemon 到点触发任务、进程内跑一轮、写运行历史(尚未投递,尚未接桌面)。

### Task 1: 依赖 + 数据模型(POJO + Jackson 往返)

**Files:**
- Modify: `pom.xml`
- Create: `src/main/java/com/lyhn/wraith/automation/Schedule.java`, `ApprovalPolicy.java`, `DeliveryTarget.java`, `AutomationTask.java`, `AutomationRun.java`
- Test: `src/test/java/com/lyhn/wraith/automation/ModelJsonTest.java`

**Interfaces:**
- Produces:
  - `enum ScheduleKind { INTERVAL, DAILY, WEEKLY, CRON }`
  - `class Schedule { ScheduleKind kind; Integer everyMinutes; String time; Integer weekday; String expr; }`(公有字段 + 无参构造,Jackson 友好)
  - `enum ApprovalMode { DENY, AUTO_APPROVE, ASK }`(Jackson 值 `"deny"|"auto-approve"|"ask"` 用 `@JsonValue`/`@JsonCreator`)
  - `class ApprovalPolicy { ApprovalMode default_; Map<String,ApprovalMode> tools; Integer askTimeoutMinutes; ApprovalMode resolve(String tool); int askTimeoutMinutesOr(int fallback); }`
  - `class DeliveryTarget { String platform; String chatId; }`
  - `class AutomationTask { String id,name,prompt,workspace; Schedule schedule; boolean enabled; List<DeliveryTarget> deliverTo; ApprovalPolicy approval; long createdAt, enabledAt; }`
  - `class AutomationRun { String runId,taskId; long startedAt; Long endedAt; String status; String sessionId; String summary; boolean miss; }`

- [ ] **Step 1: 加依赖**（`pom.xml` 的 `<dependencies>` 内）

```xml
<dependency>
  <groupId>com.cronutils</groupId>
  <artifactId>cron-utils</artifactId>
  <version>9.2.1</version>
</dependency>
```

- [ ] **Step 2: 写失败测试**（`ModelJsonTest.java`）

```java
package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ModelJsonTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void taskRoundTrips() throws Exception {
        AutomationTask t = new AutomationTask();
        t.id = "t1"; t.name = "日报"; t.prompt = "跑日报"; t.workspace = "/w";
        t.schedule = new Schedule(); t.schedule.kind = ScheduleKind.CRON; t.schedule.expr = "0 9 * * 1-5";
        t.enabled = true;
        DeliveryTarget qq = new DeliveryTarget(); qq.platform = "qq";
        t.deliverTo = List.of(qq);
        t.approval = new ApprovalPolicy();
        t.approval.default_ = ApprovalMode.ASK;
        t.approval.tools = Map.of("run_shell", ApprovalMode.DENY);
        t.createdAt = 1L; t.enabledAt = 1L;

        String json = M.writeValueAsString(t);
        assertTrue(json.contains("\"kind\":\"CRON\""));
        assertTrue(json.contains("\"default\":\"ask\""), json);       // ApprovalMode @JsonValue
        AutomationTask back = M.readValue(json, AutomationTask.class);
        assertEquals(ScheduleKind.CRON, back.schedule.kind);
        assertEquals("0 9 * * 1-5", back.schedule.expr);
        assertEquals("qq", back.deliverTo.get(0).platform);
    }

    @Test void approvalResolvePerToolThenDefault() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.ASK;
        p.tools = Map.of("run_shell", ApprovalMode.DENY, "read_file", ApprovalMode.AUTO_APPROVE);
        assertEquals(ApprovalMode.DENY, p.resolve("run_shell"));
        assertEquals(ApprovalMode.AUTO_APPROVE, p.resolve("read_file"));
        assertEquals(ApprovalMode.ASK, p.resolve("write_file"));       // 未列 → default
    }

    @Test void approvalDefaultsToDenyWhenNull() {
        ApprovalPolicy p = new ApprovalPolicy();     // default_ 未设
        assertEquals(ApprovalMode.DENY, p.resolve("anything"));
        assertEquals(30, p.askTimeoutMinutesOr(30));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=ModelJsonTest test`
Expected: 编译失败(类不存在)。

- [ ] **Step 4: 实现模型**

`ScheduleKind.java`:`public enum ScheduleKind { INTERVAL, DAILY, WEEKLY, CRON }`(可置于 `Schedule.java` 内)。

`Schedule.java`:
```java
package com.lyhn.wraith.automation;
public class Schedule {
    public ScheduleKind kind;
    public Integer everyMinutes;   // INTERVAL
    public String time;            // DAILY/WEEKLY 'HH:mm'
    public Integer weekday;        // WEEKLY 0-6,周日=0
    public String expr;            // CRON 标准 5 段
}
```

`ApprovalMode.java`:
```java
package com.lyhn.wraith.automation;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
public enum ApprovalMode {
    DENY("deny"), AUTO_APPROVE("auto-approve"), ASK("ask");
    private final String wire;
    ApprovalMode(String w) { this.wire = w; }
    @JsonValue public String wire() { return wire; }
    @JsonCreator public static ApprovalMode of(String s) {
        for (ApprovalMode m : values()) if (m.wire.equals(s)) return m;
        return DENY;   // 未知 → 最安全
    }
}
```

`ApprovalPolicy.java`:
```java
package com.lyhn.wraith.automation;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;
public class ApprovalPolicy {
    @JsonProperty("default") public ApprovalMode default_;
    public Map<String, ApprovalMode> tools;
    public Integer askTimeoutMinutes;
    public ApprovalMode resolve(String tool) {
        if (tools != null && tool != null) {
            ApprovalMode m = tools.get(tool);
            if (m != null) return m;
        }
        return default_ != null ? default_ : ApprovalMode.DENY;
    }
    public int askTimeoutMinutesOr(int fallback) {
        return askTimeoutMinutes != null ? askTimeoutMinutes : fallback;
    }
}
```

`DeliveryTarget.java`:`public class DeliveryTarget { public String platform; public String chatId; }`

`AutomationTask.java`:
```java
package com.lyhn.wraith.automation;
import java.util.List;
public class AutomationTask {
    public String id, name, prompt, workspace;
    public Schedule schedule;
    public boolean enabled;
    public List<DeliveryTarget> deliverTo;
    public ApprovalPolicy approval;
    public long createdAt, enabledAt;
}
```

`AutomationRun.java`:
```java
package com.lyhn.wraith.automation;
public class AutomationRun {
    public String runId, taskId;
    public long startedAt;
    public Long endedAt;
    public String status;      // running|waiting_approval|success|failed|interrupted
    public String sessionId, summary;
    public boolean miss;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=ModelJsonTest test`
Expected: PASS(3 tests)。

- [ ] **Step 6: 提交**

```bash
git add pom.xml src/main/java/com/lyhn/wraith/automation/ src/test/java/com/lyhn/wraith/automation/ModelJsonTest.java
git commit -m "feat(automation): cron-utils 依赖 + 自动化数据模型(POJO+Jackson)"
```

---

### Task 2: `NextRun.computeNextRun`(四种 schedule + cron 校验)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/NextRun.java`
- Test: `src/test/java/com/lyhn/wraith/automation/NextRunTest.java`

**Interfaces:**
- Consumes: `Schedule`, `ScheduleKind`(Task 1)
- Produces: `static long NextRun.computeNextRun(Schedule s, long now, Long lastFiredAt, long enabledAt)`;`static boolean NextRun.isValidCron(String expr)`。语义严格对齐 `desktop/src/main/automationSchedule.ts`(GRACE_MS=90_000,interval 单步,daily/weekly 宽限窗)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class NextRunTest {
    private static long epoch(int y,int mo,int d,int h,int mi) {
        return ZonedDateTime.of(y,mo,d,h,mi,0,0, ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
    private static Schedule interval(int m){ Schedule s=new Schedule(); s.kind=ScheduleKind.INTERVAL; s.everyMinutes=m; return s; }
    private static Schedule daily(String t){ Schedule s=new Schedule(); s.kind=ScheduleKind.DAILY; s.time=t; return s; }
    private static Schedule weekly(int wd,String t){ Schedule s=new Schedule(); s.kind=ScheduleKind.WEEKLY; s.weekday=wd; s.time=t; return s; }
    private static Schedule cron(String e){ Schedule s=new Schedule(); s.kind=ScheduleKind.CRON; s.expr=e; return s; }

    @Test void intervalIsSingleStepFromAnchor() {
        long now = epoch(2026,7,5,12,0);
        assertEquals(now + 5*60_000L, NextRun.computeNextRun(interval(5), now, now, now));   // lastFired 锚点
        assertEquals(now + 5*60_000L, NextRun.computeNextRun(interval(5), now, null, now));  // 无 lastFired → enabledAt
    }

    @Test void dailyWithinGraceReturnsToday_elsePushesTomorrow() {
        long today9 = epoch(2026,7,5,9,0);
        long now = today9 + 30_000;                              // 9:00:30,宽限窗内
        assertEquals(today9, NextRun.computeNextRun(daily("09:00"), now, null, today9-1));
        long late = today9 + 120_000;                            // 9:02,超 90s 宽限 → 明天
        assertEquals(today9 + 24*3_600_000L, NextRun.computeNextRun(daily("09:00"), late, null, today9-1));
        // 本时刻已触发过 → 明天
        assertEquals(today9 + 24*3_600_000L, NextRun.computeNextRun(daily("09:00"), today9+10_000, today9, today9-1));
    }

    @Test void weeklyPicksNextWeekdayOccurrence() {
        // 2026-07-05 是周日(getDay=0)。目标 weekday=3(周三)→ 本周三 7-08。
        long sundayNoon = epoch(2026,7,5,12,0);
        long wed10 = epoch(2026,7,8,10,0);
        assertEquals(wed10, NextRun.computeNextRun(weekly(3,"10:00"), sundayNoon, null, sundayNoon));
    }

    @Test void cronNextAfterNow() {
        long now = epoch(2026,7,6,8,0);       // 周一 08:00
        long expect = epoch(2026,7,6,9,0);    // 0 9 * * 1-5 → 当天 09:00
        assertEquals(expect, NextRun.computeNextRun(cron("0 9 * * 1-5"), now, null, now));
    }

    @Test void cronValidation() {
        assertTrue(NextRun.isValidCron("0 9 * * 1-5"));
        assertTrue(NextRun.isValidCron("*/5 * * * *"));
        assertFalse(NextRun.isValidCron("not a cron"));
        assertFalse(NextRun.isValidCron("0 9 * *"));   // 段数不足
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=NextRunTest test`
Expected: 编译失败(`NextRun` 不存在)。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.automation;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;

import java.time.*;

/** 下次触发计算,严格对齐 desktop/src/main/automationSchedule.ts(GRACE_MS=90s;interval 单步;daily/weekly 宽限窗)。 */
public final class NextRun {
    private static final long GRACE_MS = 90_000L;
    private static final CronParser CRON =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private NextRun() {}

    public static long computeNextRun(Schedule s, long now, Long lastFiredAt, long enabledAt) {
        switch (s.kind) {
            case INTERVAL: {
                long anchor = (lastFiredAt != null) ? lastFiredAt : enabledAt;
                return anchor + s.everyMinutes * 60_000L;
            }
            case DAILY: {
                long t = atTimeOnDate(now, /*deltaDays*/0, s.time);
                if ((lastFiredAt != null && lastFiredAt >= t) || t < now - GRACE_MS) t += 24L * 3_600_000L;
                return t;
            }
            case WEEKLY: {
                ZonedDateTime base = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
                int jsDow = base.getDayOfWeek().getValue() % 7;      // Mon=1..Sat=6,Sun=0(对齐 JS getDay)
                int delta = (s.weekday - jsDow + 7) % 7;
                long t = atTimeOnDate(now, delta, s.time);
                if ((lastFiredAt != null && lastFiredAt >= t) || t < now - GRACE_MS) t += 7L * 24L * 3_600_000L;
                return t;
            }
            case CRON: {
                ZonedDateTime from = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
                return ExecutionTime.forCron(CRON.parse(s.expr)).nextExecution(from)
                        .map(z -> z.toInstant().toEpochMilli()).orElse(Long.MAX_VALUE);
            }
        }
        throw new IllegalStateException("unknown ScheduleKind: " + s.kind);
    }

    public static boolean isValidCron(String expr) {
        if (expr == null || expr.isBlank()) return false;
        try { CRON.parse(expr).validate(); return true; }
        catch (RuntimeException e) { return false; }
    }

    /** now 所在日期 + deltaDays 天的 HH:mm(本机时区),秒/纳秒清零 → epoch ms。 */
    private static long atTimeOnDate(long now, int deltaDays, String hhmm) {
        String[] p = hhmm.split(":");
        int h = Integer.parseInt(p[0]), mi = Integer.parseInt(p[1]);
        ZonedDateTime base = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
        ZonedDateTime at = base.toLocalDate().plusDays(deltaDays)
                .atTime(h, mi).atZone(ZoneId.systemDefault());
        return at.toInstant().toEpochMilli();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=NextRunTest test`
Expected: PASS(5 tests)。若 weekly 断言因本机时区偏差失败,确认测试用 `ZoneId.systemDefault()` 构造期望值(已如此)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/NextRun.java src/test/java/com/lyhn/wraith/automation/NextRunTest.java
git commit -m "feat(automation): NextRun 四种 schedule 下次触发 + cron 校验(移植 TS 语义)"
```

---

### Task 3: `AutomationStore`(定义读 / 状态读写 / 历史读写,原子写)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/AutomationStore.java`
- Test: `src/test/java/com/lyhn/wraith/automation/AutomationStoreTest.java`

**Interfaces:**
- Consumes: `AutomationTask`, `AutomationRun`(Task 1)
- Produces:
  - `AutomationStore(Path dir)` — 根目录(生产传 `~/.wraith`)
  - `List<AutomationTask> loadTasks()` — 读 `automations.json`(`{tasks:[...]}`);缺失/坏 → 空表
  - `Long lastFiredAt(String taskId)` / `void setLastFiredAt(String taskId, long ts)` — 读写 `automation-state.json`(`{lastFiredAt:{id:ts}}`),写线程安全(`synchronized`)
  - `void putRun(AutomationRun run)` — upsert 进 `automation-runs.json`(`{runs:[...]}`),每 taskId 留最近 50 条;`List<AutomationRun> loadRuns()`;`List<AutomationRun> nonTerminalRuns()`
  - 所有写:`temp + Files.move(ATOMIC_MOVE)`

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AutomationStoreTest {
    @TempDir Path dir;

    @Test void loadTasksEmptyWhenMissing() {
        assertTrue(new AutomationStore(dir).loadTasks().isEmpty());
    }

    @Test void stateRoundTripsAndIsIsolatedFromDefs() {
        AutomationStore s = new AutomationStore(dir);
        assertNull(s.lastFiredAt("t1"));
        s.setLastFiredAt("t1", 123L);
        assertEquals(123L, s.lastFiredAt("t1"));
        // 新实例仍读得到(落盘)
        assertEquals(123L, new AutomationStore(dir).lastFiredAt("t1"));
    }

    @Test void putRunKeepsLast50PerTask() {
        AutomationStore s = new AutomationStore(dir);
        for (int i = 0; i < 60; i++) {
            AutomationRun r = new AutomationRun();
            r.runId = "r" + i; r.taskId = "t1"; r.startedAt = i; r.status = "success";
            s.putRun(r);
        }
        List<AutomationRun> runs = s.loadRuns();
        assertEquals(50, runs.stream().filter(r -> r.taskId.equals("t1")).count());
    }

    @Test void nonTerminalRunsFiltered() {
        AutomationStore s = new AutomationStore(dir);
        AutomationRun a = new AutomationRun(); a.runId="a"; a.taskId="t"; a.status="running";
        AutomationRun b = new AutomationRun(); b.runId="b"; b.taskId="t"; b.status="success";
        s.putRun(a); s.putRun(b);
        List<AutomationRun> nt = s.nonTerminalRuns();
        assertEquals(1, nt.size());
        assertEquals("a", nt.get(0).runId);
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn -DskipTests=false -Dtest=AutomationStoreTest test` → 编译失败。

- [ ] **Step 3: 实现**（要点:Jackson `ObjectMapper`;三个文件 `automations.json`/`automation-state.json`/`automation-runs.json`;写走 `writeAtomic(Path,Object)` = 写 `<name>.tmp` 再 `Files.move(...,ATOMIC_MOVE)`;`setLastFiredAt` 与 `putRun` 方法体 `synchronized`;读缺失/异常 → 返回空容器;`putRun` upsert by runId,然后按 taskId 分组保留 startedAt 最大的 50 条)

```java
package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

public final class AutomationStore {
    private static final ObjectMapper M = new ObjectMapper();
    private static final int RUNS_PER_TASK = 50;
    private final Path defs, state, runs;

    public AutomationStore(Path dir) {
        this.defs = dir.resolve("automations.json");
        this.state = dir.resolve("automation-state.json");
        this.runs = dir.resolve("automation-runs.json");
    }

    // --- 定义(只读) ---
    public List<AutomationTask> loadTasks() {
        Map<String,Object> root = readMap(defs);
        Object tasks = root.get("tasks");
        if (tasks == null) return List.of();
        return M.convertValue(tasks, M.getTypeFactory()
                .constructCollectionType(List.class, AutomationTask.class));
    }

    // --- 状态(读写,加锁) ---
    public synchronized Long lastFiredAt(String taskId) {
        Map<String,Object> lf = lastFiredMap();
        Object v = lf.get(taskId);
        return v == null ? null : ((Number) v).longValue();
    }
    public synchronized void setLastFiredAt(String taskId, long ts) {
        Map<String,Object> root = readMap(state);
        @SuppressWarnings("unchecked")
        Map<String,Object> lf = (Map<String,Object>) root.computeIfAbsent("lastFiredAt", k -> new LinkedHashMap<>());
        lf.put(taskId, ts);
        writeAtomic(state, root);
    }
    @SuppressWarnings("unchecked")
    private Map<String,Object> lastFiredMap() {
        Object lf = readMap(state).get("lastFiredAt");
        return lf == null ? Map.of() : (Map<String,Object>) lf;
    }

    // --- 历史(读写,加锁) ---
    public synchronized void putRun(AutomationRun run) {
        List<AutomationRun> all = new ArrayList<>(loadRuns());
        all.removeIf(r -> r.runId.equals(run.runId));
        all.add(run);
        // 每 taskId 保留 startedAt 最大的 RUNS_PER_TASK 条
        Map<String,List<AutomationRun>> byTask = all.stream().collect(Collectors.groupingBy(r -> r.taskId));
        List<AutomationRun> kept = new ArrayList<>();
        for (List<AutomationRun> g : byTask.values()) {
            g.sort(Comparator.comparingLong((AutomationRun r) -> r.startedAt).reversed());
            kept.addAll(g.subList(0, Math.min(RUNS_PER_TASK, g.size())));
        }
        Map<String,Object> root = new LinkedHashMap<>();
        root.put("runs", kept);
        writeAtomic(runs, root);
    }
    public List<AutomationRun> loadRuns() {
        Object rs = readMap(runs).get("runs");
        if (rs == null) return List.of();
        return M.convertValue(rs, M.getTypeFactory()
                .constructCollectionType(List.class, AutomationRun.class));
    }
    public List<AutomationRun> nonTerminalRuns() {
        return loadRuns().stream()
                .filter(r -> "running".equals(r.status) || "waiting_approval".equals(r.status) || "starting".equals(r.status))
                .collect(Collectors.toList());
    }

    // --- 底层 ---
    private Map<String,Object> readMap(Path p) {
        try {
            if (!Files.exists(p)) return new LinkedHashMap<>();
            return M.readValue(Files.readAllBytes(p), M.getTypeFactory()
                    .constructMapType(LinkedHashMap.class, String.class, Object.class));
        } catch (IOException e) { return new LinkedHashMap<>(); }   // 半写/坏 → 降级空
    }
    private void writeAtomic(Path p, Object value) {
        try {
            Files.createDirectories(p.getParent());
            Path tmp = p.resolveSibling(p.getFileName() + ".tmp");
            Files.write(tmp, M.writerWithDefaultPrettyPrinter().writeValueAsBytes(value));
            try { Files.move(tmp, p, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException e) { Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING); }
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — `mvn -DskipTests=false -Dtest=AutomationStoreTest test` → PASS(4)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/AutomationStore.java src/test/java/com/lyhn/wraith/automation/AutomationStoreTest.java
git commit -m "feat(automation): AutomationStore(定义读/状态读写/历史读写,原子写+单写者)"
```

---

### Task 4: `ScheduledRunRenderer`(策略化审批)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/ScheduledRunRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/automation/ScheduledRunRendererTest.java`

**Interfaces:**
- Consumes: `com.lyhn.wraith.hitl.ApprovalRequest` / `ApprovalResult`(现有;`ApprovalResult.approveOnce()` 或 `.reject(String)`,`Decision {APPROVED,APPROVED_ALL,APPROVED_ALL_BY_SERVER,REJECTED}`)、`Renderer` 接口(现有,`GatewayRenderer` 所实现)、`ApprovalPolicy`(Task 1)
- Produces:
  - `ScheduledRunRenderer(ApprovalPolicy policy, long askTimeoutMs, AskSurface askSurface)` implements `Renderer`
  - `interface AskSurface { java.util.concurrent.CompletableFuture<ApprovalResult> surface(String runId, ApprovalRequest req); }` — ask 模式把审批顶给桌面/QQ 并返回一个待 resolve 的 future(Phase 3 接线;Phase 1 传一个直接超时/拒绝的桩)
  - `promptApproval(ApprovalRequest)`:按 `policy.resolve(req.toolName())` → DENY 立即 `reject`;AUTO_APPROVE 立即 `approveOnce`;ASK 调 `askSurface.surface(...).get(askTimeoutMs)`,超时/异常 → reject
  - `setRunId(String)`;记录本轮被拒工具名 `List<String> deniedTools()`(供结果注明)

> 注:先读 `com.lyhn.wraith.hitl.Renderer` 与 `GatewayRenderer` 确认 `Renderer` 接口的全部方法(stream/appendDiff/appendToolOutputDelta/appendToolResult/promptApproval 等),`ScheduledRunRenderer` 对非审批方法可空实现或丢弃(定时回合不需要 UI 流),仅 `promptApproval` 承载策略。`ApprovalRequest` 的工具名取用方法先读其定义(可能是 `toolName()` 或 `getToolName()`)。

- [ ] **Step 1: 写失败测试**（deny 立即拒 / auto-approve 立即批 / ask 超时拒 / ask 被 resolve 批;用假 `AskSurface`)

```java
package com.lyhn.wraith.automation;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import static org.junit.jupiter.api.Assertions.*;

class ScheduledRunRendererTest {
    private ApprovalRequest reqFor(String tool) {
        // 依 ApprovalRequest 真实构造/工厂构造;此处示意——实现时替换为真实构造。
        return TestApprovals.request(tool);
    }
    private ScheduledRunRenderer renderer(ApprovalPolicy p, long timeoutMs, ScheduledRunRenderer.AskSurface s) {
        ScheduledRunRenderer r = new ScheduledRunRenderer(p, timeoutMs, s);
        r.setRunId("run1");
        return r;
    }

    @Test void denyRejectsImmediately() {
        ApprovalPolicy p = new ApprovalPolicy(); p.default_ = ApprovalMode.DENY;
        ScheduledRunRenderer r = renderer(p, 1000, (id, req) -> { fail("ask 不应被调"); return null; });
        assertEquals(ApprovalResult.Decision.REJECTED, r.promptApproval(reqFor("write_file")).decision());
        assertTrue(r.deniedTools().contains("write_file"));
    }

    @Test void autoApproveApprovesImmediately() {
        ApprovalPolicy p = new ApprovalPolicy(); p.default_ = ApprovalMode.AUTO_APPROVE;
        ScheduledRunRenderer r = renderer(p, 1000, (id, req) -> { fail("ask 不应被调"); return null; });
        assertEquals(ApprovalResult.Decision.APPROVED, r.promptApproval(reqFor("write_file")).decision());
    }

    @Test void askResolvedApproves() {
        ApprovalPolicy p = new ApprovalPolicy(); p.default_ = ApprovalMode.ASK;
        ScheduledRunRenderer r = renderer(p, 2000,
                (id, req) -> CompletableFuture.completedFuture(ApprovalResult.approveOnce()));
        assertEquals(ApprovalResult.Decision.APPROVED, r.promptApproval(reqFor("write_file")).decision());
    }

    @Test void askTimesOutRejects() {
        ApprovalPolicy p = new ApprovalPolicy(); p.default_ = ApprovalMode.ASK;
        ScheduledRunRenderer r = renderer(p, 150, (id, req) -> new CompletableFuture<>()); // 永不完成
        assertEquals(ApprovalResult.Decision.REJECTED, r.promptApproval(reqFor("write_file")).decision());
    }
}
```

> `TestApprovals.request(tool)` 与 `ApprovalResult.approveOnce()` 的确切工厂在实现时对齐真实 API(先 grep `ApprovalResult` 的静态工厂;若只有 `reject(String)` 无 `approveOnce`,用现有 APPROVED 构造)。

- [ ] **Step 2: 跑确认失败** — `mvn -DskipTests=false -Dtest=ScheduledRunRendererTest test`。

- [ ] **Step 3: 实现** — `implements Renderer`;非审批方法空实现;`promptApproval` 按上面 Interfaces 描述的三分支;ask 用 `future.get(askTimeoutMs, MILLISECONDS)`,`catch (TimeoutException|Exception)` → `ApprovalResult.reject("scheduled ask timeout")`;`deniedTools` 用 `CopyOnWriteArrayList`。参考 `GatewayRenderer.promptApproval` 的 fail-closed 写法。

- [ ] **Step 4: 跑确认通过** — PASS(4)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/ScheduledRunRenderer.java src/test/java/com/lyhn/wraith/automation/ScheduledRunRendererTest.java
git commit -m "feat(automation): ScheduledRunRenderer(deny/auto-approve/ask 策略化审批,fail-closed)"
```

---

### Task 5: `AutomationRunner`(进程内跑一轮 → `RunResult`)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/AutomationRunner.java`
- Test: `src/test/java/com/lyhn/wraith/automation/AutomationRunnerTest.java`

**Interfaces:**
- Consumes: `AutomationTask`, `ScheduledRunRenderer`(Task 4);会话装配复刻 `GatewaySession`(`Agent + HitlToolRegistry + CommandSandbox + McpServerManager + SessionStore`,把 `GatewayRenderer` 换成 `ScheduledRunRenderer`);`LlmClient`(现有)
- Produces:
  - `record RunResult(String status, String answer, String sessionId, java.util.List<String> deniedTools)`(status = `success|failed`)
  - `interface TurnEngine { RunResult run(AutomationTask task); }` — 生产实现 `InProcessTurnEngine`(复刻 GatewaySession 装配 + `ScheduledRunRenderer`);**Scheduler 依赖 `TurnEngine` 接口而非具体类**,便于单测注入假引擎
  - `AutomationRunner` = `InProcessTurnEngine implements TurnEngine`,构造 `(LlmClient client, AskSurface askSurface, int defaultAskTimeoutMinutes)`

> 说明:把"跑一轮"抽象成 `TurnEngine` 接口是为让 Scheduler(Task 6)可用假引擎做确定性单测,不触网/不起 LLM。真实 `InProcessTurnEngine` 的装配**逐行参照 `GatewaySession` 构造函数**(HITL 链 → registry → sandbox → observers → 可选 MCP → `Agent` + `setRenderer(scheduledRenderer)` + `setReturnFinalResponseWhenStreamed(true)` → `SessionStore.open(...).startNew()`),仅把 renderer 换成 `ScheduledRunRenderer(task.approval, timeoutMs, askSurface)`,workspace = `task.workspace`。

- [ ] **Step 1: 写失败测试**(只测接口契约 + 一个假引擎;真实 `InProcessTurnEngine` 触网,归 Phase 1 末的集成 eye-verify)

```java
package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AutomationRunnerTest {
    @Test void turnEngineContractRunReturnsResult() {
        AutomationRunner.TurnEngine fake = task -> new AutomationRunner.RunResult("success", "pong", "sess1", List.of());
        AutomationTask t = new AutomationTask(); t.id="t"; t.prompt="ping";
        AutomationRunner.RunResult r = fake.run(t);
        assertEquals("success", r.status());
        assertEquals("pong", r.answer());
    }
}
```

- [ ] **Step 2: 跑确认失败** — 编译失败(`AutomationRunner.TurnEngine/RunResult` 不存在)。

- [ ] **Step 3: 实现** — 定义 `TurnEngine` 接口 + `RunResult` record + `InProcessTurnEngine`(复刻 GatewaySession 装配)。`run(task)`:try `String answer = session.runTurn(task.prompt); String sessionId = session.persist();` → `new RunResult("success", answer, sessionId, renderer.deniedTools())`;`catch (Exception e)` → `new RunResult("failed", "运行失败: "+e.getMessage(), null, ...)`;`finally session.close()`。

- [ ] **Step 4: 跑确认通过** — PASS(1)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/AutomationRunner.java src/test/java/com/lyhn/wraith/automation/AutomationRunnerTest.java
git commit -m "feat(automation): AutomationRunner(TurnEngine 接口 + 进程内复刻 GatewaySession 装配)"
```

---

### Task 6: `Scheduler`(tick + 有界并发 + 到点触发 + 去重 + miss)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/Scheduler.java`
- Test: `src/test/java/com/lyhn/wraith/automation/SchedulerTest.java`

**Interfaces:**
- Consumes: `AutomationStore`(Task 3)、`NextRun`(Task 2)、`TurnEngine`(Task 5)、`AutomationRun`(Task 1);投递回调 `interface OnResult { void deliver(AutomationTask task, AutomationRunner.RunResult result); }`(Phase 2 注入真 Deliverer;Phase 1 桩)
- Produces:
  - `Scheduler(AutomationStore store, TurnEngine engine, OnResult onResult, int maxConcurrent, java.util.function.LongSupplier clock)`
  - `void decideTick()` — 纯粹一 tick 的判定+触发(**测试直接调用它,不用真 30s 定时器**):读 tasks,对每个 enabled 且无活跃 run 且 `clock() >= computeNextRun(...)` 的任务 → 提交到有界池跑;更新 `lastFiredAt`;写 run 记录
  - `void start()` / `void stop()` — 生产用 `ScheduledExecutorService` 每 30s 调 `decideTick()`
  - `void requestRunNow(String taskId)` — 立即入队跑(不动 lastFiredAt)
  - `void sweepInterrupted()` — 启动时把非终态旧 run 标 interrupted
  - per-task 活跃集合 `Set<String> activeTaskIds`(去重:该任务有活跃 run 就跳过)

- [ ] **Step 1: 写失败测试**(注入假 clock + 假 engine + 捕获 deliver;验证到点触发、去重、lastFiredAt 更新、run 记录)

```java
package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class SchedulerTest {
    @TempDir Path dir;

    private void writeTasks(Path dir, String json) throws Exception {
        Files.write(dir.resolve("automations.json"), json.getBytes());
    }

    @Test void firesDueTaskRunsAndRecords() throws Exception {
        // interval 1 分钟,enabledAt=0 → 下次触发=60_000;clock=60_000 到点。
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"ping\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":1},\"enabled\":true,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        AutomationStore store = new AutomationStore(dir);
        CountDownLatch delivered = new CountDownLatch(1);
        List<String> deliveredAnswers = new CopyOnWriteArrayList<>();
        AutomationRunner.TurnEngine engine = t -> new AutomationRunner.RunResult("success", "pong", "s1", List.of());
        Scheduler sch = new Scheduler(store, engine,
                (task, res) -> { deliveredAnswers.add(res.answer()); delivered.countDown(); },
                3, () -> 60_000L);

        sch.decideTick();
        assertTrue(delivered.await(3, TimeUnit.SECONDS), "到点应触发并跑完");
        assertEquals(List.of("pong"), deliveredAnswers);
        assertEquals(60_000L, store.lastFiredAt("t1"));                       // 锚点推进
        assertTrue(store.loadRuns().stream().anyMatch(r -> "success".equals(r.status)));
    }

    @Test void notDueTaskDoesNotFire() throws Exception {
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"p\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":10},\"enabled\":true,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        AutomationStore store = new AutomationStore(dir);
        boolean[] fired = {false};
        Scheduler sch = new Scheduler(store, t -> { fired[0]=true; return new AutomationRunner.RunResult("success","","",List.of()); },
                (task,res) -> {}, 3, () -> 30_000L);                          // 30s < 600s 未到点
        sch.decideTick();
        Thread.sleep(100);
        assertFalse(fired[0]);
    }

    @Test void disabledTaskSkipped() throws Exception {
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"p\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":1},\"enabled\":false,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        boolean[] fired = {false};
        new Scheduler(new AutomationStore(dir), t -> { fired[0]=true; return null; },
                (a,r)->{}, 3, () -> 60_000L).decideTick();
        Thread.sleep(100);
        assertFalse(fired[0]);
    }
}
```

- [ ] **Step 2: 跑确认失败** — `mvn -DskipTests=false -Dtest=SchedulerTest test`。

- [ ] **Step 3: 实现** — 有界池 `Executors.newFixedThreadPool(maxConcurrent)`;`decideTick()`:`for task in store.loadTasks()`:`if(!task.enabled) continue; if(activeTaskIds.contains(task.id)) continue; long next = NextRun.computeNextRun(task.schedule, clock.getAsLong(), store.lastFiredAt(task.id), task.enabledAt); if(clock.getAsLong() >= next) fire(task);`。`fire(task)`:`activeTaskIds.add(id)`;写 `running` run;`store.setLastFiredAt(id, clock)`;`pool.submit(() -> { try { RunResult r = engine.run(task); 写终态 run(success/failed) + summary=末120字; onResult.deliver(task,r);} finally { activeTaskIds.remove(id);} })`。每个 task 与整个 tick 各自 try/catch。`requestRunNow`:类似 fire 但不更新 lastFiredAt。`sweepInterrupted()`:`store.nonTerminalRuns()` 逐个改 `interrupted` + `putRun`。

- [ ] **Step 4: 跑确认通过** — PASS(3)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/automation/Scheduler.java src/test/java/com/lyhn/wraith/automation/SchedulerTest.java
git commit -m "feat(automation): Scheduler(decideTick 到点触发 + 有界并发 + 去重 + lastFiredAt 推进)"
```

---

### Task 7: `GatewayDaemon` 接入 Scheduler(QQ 变可选)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`
- Test: 手动 eye-verify(见步骤)+ 现有 Java 全量绿

**Interfaces:**
- Consumes: `Scheduler`, `AutomationStore`, `InProcessTurnEngine`(前面任务)
- Produces: daemon 启动即起调度器(独立线程 `ScheduledExecutorService`);QQ 未配置时**不 return**,仅跳过 WS 那段,调度器照跑

- [ ] **Step 1:** 改 `GatewayDaemon.start(cfg)`:开头构建 `LlmClient`(现有);`AutomationStore store = new AutomationStore(Path.of(System.getProperty("user.home"), ".wraith"))`;`TurnEngine engine = new InProcessTurnEngine(client, askSurface, 30)`(Phase 1 的 `askSurface` 传一个"立即超时→拒"的桩,Phase 3 换真);`Scheduler sch = new Scheduler(store, engine, onResult, 3, System::currentTimeMillis)`(Phase 1 `onResult` = 只写日志的桩,Phase 2 换真 Deliverer);`sch.sweepInterrupted(); sch.start();`。把原 `if (gw==null||gw.getQq()==null) { ...; return; }` 改成:**无 QQ 配置时打印提示并跳过 WS 段,但不 return**(调度器已起)。

- [ ] **Step 2: 跑 Java 全量确认无回归**

Run: `mvn -DskipTests=false test`
Expected: BUILD SUCCESS,0F/0E(数量 = 之前 + 本阶段新增单测)。

- [ ] **Step 3: eye-verify(真机)** — rebuild+装 jar(见"上线"),配一个 `interval everyMinutes:1` 的任务写进 `~/.wraith/automations.json`(`deliverTo:[]`,`approval.default:"deny"`),重启 daemon,观察 `~/.wraith/logs/wraith.log` 一分钟内出现一轮 ReAct run + `automation-runs.json` 落一条 success。

- [ ] **Step 4: 提交**

```bash
git add src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java
git commit -m "feat(gateway): daemon 起常驻调度器(QQ 变可选,cron 独立于 IM)"
```

---

# Phase 2 — 投递抽象 + QQ pull + 桌面观察式

产出:跑完结果按 `deliverTo` 投递;QQ 走待发队列 + 窗口内即发 + 下次私聊冲刷;桌面经运行历史观察弹通知。

### Task 8: `DeliveryAdapter` 接口 + `Deliverer` 分发(空回复抑制)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/DeliveryAdapter.java`, `Deliverer.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/DelivererTest.java`

**Interfaces:**
- Consumes: `AutomationTask`, `DeliveryTarget`, `AutomationRunner.RunResult`
- Produces:
  - `interface DeliveryAdapter { String platform(); void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result); }`
  - `class Deliverer { Deliverer(List<DeliveryAdapter> adapters); void deliver(AutomationTask task, AutomationRunner.RunResult result); }` — 遍历 `task.deliverTo`,按 platform 找 adapter;**结果 answer 为空/纯空白 → 整体跳过(不投任何 target)**;未知 platform → 日志跳过;`deliverTo` 空 → no-op

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DelivererTest {
    static class Fake implements DeliveryAdapter {
        final String p; final List<String> got = new ArrayList<>();
        Fake(String p){this.p=p;}
        public String platform(){return p;}
        public void deliver(DeliveryTarget t, AutomationTask task, AutomationRunner.RunResult r){ got.add(r.answer()); }
    }
    private AutomationTask task(String... platforms) {
        AutomationTask t = new AutomationTask(); t.name="x"; t.deliverTo = new ArrayList<>();
        for (String p : platforms){ DeliveryTarget d=new DeliveryTarget(); d.platform=p; t.deliverTo.add(d); }
        return t;
    }

    @Test void dispatchesToMatchingAdapters() {
        Fake qq=new Fake("qq"), desk=new Fake("desktop");
        Deliverer d = new Deliverer(List.of(qq, desk));
        d.deliver(task("qq","desktop"), new AutomationRunner.RunResult("success","报告","s",List.of()));
        assertEquals(List.of("报告"), qq.got);
        assertEquals(List.of("报告"), desk.got);
    }

    @Test void emptyAnswerSuppressesDelivery() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task("qq"),
                new AutomationRunner.RunResult("success","   ","s",List.of()));
        assertTrue(qq.got.isEmpty(), "空回复应抑制投递");
    }

    @Test void emptyDeliverToIsNoop() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task(), new AutomationRunner.RunResult("success","x","s",List.of()));
        assertTrue(qq.got.isEmpty());
    }

    @Test void unknownPlatformSkipped() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task("telegram"),
                new AutomationRunner.RunResult("success","x","s",List.of()));
        assertTrue(qq.got.isEmpty());   // 无 telegram adapter → 跳过,不抛
    }
}
```

- [ ] **Step 2–5:** 跑失败 → 实现(`Deliverer` 建 `Map<String,DeliveryAdapter>`;`deliver`:`if(result.answer()==null||result.answer().isBlank()) return;` 遍历 `task.deliverTo`,`Map.get(platform)` 命中则 `adapter.deliver(...)`,否则 `log`)→ 跑通 → 提交。

```bash
git add src/main/java/com/lyhn/wraith/automation/delivery/DeliveryAdapter.java src/main/java/com/lyhn/wraith/automation/delivery/Deliverer.java src/test/java/com/lyhn/wraith/automation/delivery/DelivererTest.java
git commit -m "feat(automation): Deliverer 分发 + 空回复抑制 + 未知平台跳过"
```

---

### Task 9: `QqPendingStore`(待发队列持久化)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/QqPendingStore.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/QqPendingStoreTest.java`

**Interfaces:**
- Produces:
  - `record Pending(String taskName, String answer, long ts)`
  - `QqPendingStore(Path dir)`(写 `qq-pending.json`,原子写,`synchronized`)
  - `void enqueue(Pending p)`;`List<Pending> drainAll()`(返回并清空);`int size()`

- [ ] **Step 1: 写失败测试**(enqueue → drainAll 返回并清空 → 持久化跨实例)。
- [ ] **Step 2–5:** 跑失败 → 实现(结构同 `AutomationStore` 的原子写)→ 跑通 → 提交:

```bash
git commit -m "feat(automation): QqPendingStore(QQ 待发队列持久化)"
```

---

### Task 10: `QqDeliveryAdapter`(入队 + 窗口内即发,合并)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapter.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapterTest.java`

**Interfaces:**
- Consumes: `QqPendingStore`(Task 9);`QqApiClient.sendC2C(openid, text, replyToMsgId)`(现有);一个"窗口状态"提供者 `interface PassiveWindow { String freshMsgId(String openid); }`(返回 60 分钟内的 msg_id,过期/无则 null) — daemon 侧由现有 `lastMsgId` + 入站时间实现
- Produces:
  - `QqDeliveryAdapter(String ownerOpenid, QqApiClient api, QqPendingStore pending, PassiveWindow window)` implements `DeliveryAdapter`(`platform()="qq"`)
  - `deliver`:`String msgId = window.freshMsgId(ownerOpenid); if(msgId!=null){ try{ api.sendC2C(owner, format(task,result), msgId); return; }catch(IOException ignore){} } pending.enqueue(new Pending(task.name, result.answer(), now));`
  - `String flush(String freshMsgId)`(下次入站时调):`List<Pending> ps = pending.drainAll(); if(empty) return null; String digest = coalesce(ps); api.sendC2C(owner, digest, freshMsgId); return digest;` — `coalesce` 把多条合并成"📋 你有 N 条定时结果:\n- …"一条(≤4/msg_id,故合并成 1 条)

- [ ] **Step 1: 写失败测试**(用 `MockWebServer` + 真 `QqApiClient`,仿 `QqApiClientKeyboardTest`;窗口内即发命中 `/v2/users/{owner}/messages`;窗口外 `freshMsgId`=null → 入队、MockWebServer 无请求;`flush` 合并成一条 POST)。
- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通 → 提交:

```bash
git commit -m "feat(automation): QqDeliveryAdapter(窗口内即发/窗口外入队,flush 合并)"
```

---

### Task 11: `DesktopDeliveryAdapter`(标记 run 供桌面观察)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/delivery/DesktopDeliveryAdapter.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/DesktopDeliveryAdapterTest.java`

**Interfaces:**
- Produces: `DesktopDeliveryAdapter(AutomationStore store)` implements `DeliveryAdapter`(`platform()="desktop"`);`deliver`:找到该 run(按 result.sessionId 或最近 run)在其记录上置 `notifyDesktop=true` 并 `putRun`(需给 `AutomationRun` 加 `boolean notifyDesktop` 字段)。桌面侧 Phase 4 读该 flag 决定弹通知。

- [ ] **Step 1–5:** 给 `AutomationRun` 加 `notifyDesktop` 字段(补 Task 1 模型 + Jackson 测试断言可选);写测试(deliver 后对应 run 的 `notifyDesktop==true`)→ 实现 → 跑通 → 提交:

```bash
git commit -m "feat(automation): DesktopDeliveryAdapter(标记 run.notifyDesktop 供桌面观察)"
```

---

### Task 12: daemon 接线 Deliverer + 冲刷待发

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`
- Test: 扩 `GatewayIntegrationTest` 或新增集成测试(仿其 mock-WS + MockWebServer)

**Interfaces:**
- Produces:
  - daemon 构建 `Deliverer`(注册 `QqDeliveryAdapter`——仅 QQ 配置时——+ `DesktopDeliveryAdapter`),把 `Scheduler` 的 `onResult` 换成 `deliverer::deliver`
  - `PassiveWindow` 实现:复用现有 `lastMsgId` map + 记录每 openid 最近入站时间戳,`freshMsgId` 判 `< 60min`
  - **入站冲刷**:在现有 `onC2C` 处理(dedup+authz 通过、driver.onMessage 之前或之后)插入 `qqAdapter.flush(inbound.msgId())`——用这条新鲜 msg_id 把待发队列发出

- [ ] **Step 1:** 集成测试:喂一个 C2C 入站帧,断言若有待发项则冲刷发一条 POST(仿 `GatewayIntegrationTest.c2cFrameDrivesTurnAndPostsPassivePong` 的 MockWebServer 断言)。
- [ ] **Step 2–5:** 跑失败 → 接线实现 → Java 全量绿 → 提交:

```bash
git commit -m "feat(gateway): daemon 接 Deliverer + 入站冲刷 QQ 待发队列"
```

---

# Phase 3 — 审批 ask 模式的 surfacing(桌面 + QQ)

产出:ask 模式的审批能被桌面/QQ 顶出、点选后 resolve、超时降级拒。

### Task 13: `RequestInbox` + 审批响应/run-now 信令

**Files:**
- Create: `src/main/java/com/lyhn/wraith/automation/RequestInbox.java`
- Test: `src/test/java/com/lyhn/wraith/automation/RequestInboxTest.java`

**Interfaces:**
- Produces:
  - `RequestInbox(Path requestsDir)`(`~/.wraith/automation-requests/`)
  - `record Request(String type, String id, String payload)`(type=`run-now`|`approval`)
  - `List<Request> drain()` — 读目录内所有 json、解析、**删除已消费文件**、返回列表;目录不存在 → 空
  - app-server 侧写:一请求一文件(文件名含唯一 id)

- [ ] **Step 1: 写失败测试**(TempDir 落两个请求文件 → `drain()` 返回 2 条且文件被删)。
- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通 → 提交:

```bash
git commit -m "feat(automation): RequestInbox(桌面→daemon 请求目录:run-now/审批响应)"
```

---

### Task 14: ask surfacing 接线(QQ 就地 resolve + 桌面经 RequestInbox + run-now)

**Files:**
- Modify: `GatewayDaemon.java`、`Scheduler.java`(消费 run-now)、`ScheduledRunRenderer.AskSurface` 的真实实现
- Test: 集成测试(ask→surface→resolve→approve;ask→timeout→reject)

**Interfaces:**
- Produces:
  - 真实 `AskSurface`:ask 时生成 `approvalId`,把审批入 `QqPendingStore`(带按钮 data `approve:<approvalId>` / `reject:<approvalId>`,复用 `QqApproval.keyboardJson`)**并**登记一个 `CompletableFuture` 到 daemon 的 `Map<String,CompletableFuture<ApprovalResult>> pendingApprovals`;返回该 future 给 renderer 阻塞
  - daemon `onInteraction`:解析 `approve/reject:<approvalId>` → `pendingApprovals.remove(id).complete(APPROVED/REJECTED)`(就地 resolve)
  - daemon tick 前 `requestInbox.drain()`:`run-now` → `scheduler.requestRunNow(taskId)`;`approval` → `pendingApprovals.get(id).complete(...)`
  - 入站冲刷时,若队列含 ask 审批项 → 用新鲜 msg_id 发带按钮的审批消息

- [ ] **Step 1:** 集成测试:构造一个 ask 策略任务 + 假 `TurnEngine` 里回合调 `renderer.promptApproval`(或直接单测 `AskSurface`+resolve 路径):surface 后由"注入的审批响应"complete future → renderer 返回 APPROVED;不 complete 且超时 → REJECTED。
- [ ] **Step 2–5:** 跑失败 → 接线实现 → Java 全量绿 → 提交:

```bash
git commit -m "feat(automation): ask 审批 surfacing(QQ 按钮就地 resolve + 桌面 RequestInbox + run-now)"
```

---

# Phase 4 — 桌面:app-server RPC + 面板配置化 + 迁移 + UI

产出:桌面面板经 RPC 管理任务、cron 输入、审批/deliverTo 配置、一次性迁移旧 automations;旧 TS 调度器退役。

### Task 15: app-server RPC `automations.*` + cron 校验

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerAutomationsTest.java`(仿 `AppServerGatewayConfigTest`)

**Interfaces:**
- Produces(在 `switch(method)` 加 case,复用 `writer.result()/error()`、`AutomationStore`):
  - `automations.list` → `{tasks:[...]}`(读 `automations.json`)
  - `automations.upsert`(params=task)→ **先 `if(task.schedule.kind==CRON && !NextRun.isValidCron(expr)) return error(非法 cron)`**;保存进 `automations.json`(保留其它任务;新任务 `enabledAt` 处理同现有语义)→ `{ok:true}`
  - `automations.remove`(params={id})→ 删任务 + 其 runs → `{ok:true}`
  - `automations.runs`(params={taskId?})→ `{runs:[...]}`(读 `automation-runs.json`,可选按 taskId 过滤)+ 附 `automation-state.json` 的 lastFiredAt 供显示下次触发
  - app-server 需能写 `automations.json`(定义单写者=app-server)。给 `AutomationStore` 加 `void saveTasks(List<AutomationTask>)`(原子写),或在 AppServer 内直接用同一原子写。

- [ ] **Step 1: 写失败测试**(仿 `AppServerGatewayConfigTest`:driver 桩;`automations.upsert` 一个 cron 任务 → `automations.list` 能读回;非法 cron upsert → error;`automations.remove` → list 为空)。
- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通 → 提交:

```bash
git commit -m "feat(appserver): automations.list/upsert/remove/runs RPC + cron 校验"
```

---

### Task 16: 桌面共享类型扩展 + preload 暴露

**Files:**
- Modify: `desktop/src/shared/types.ts`、`desktop/src/preload/index.ts`、`desktop/src/preload/global.d.ts`
- Test: `desktop/test/` 现有 typecheck

**Interfaces:**
- Produces:
  - `types.ts`:`AutomationSchedule` 加 `| { kind:'cron'; expr:string }`;`AutomationTask` 加 `workspace`(重命名 projectPath;保留兼容读)、`deliverTo: DeliveryTarget[]`、`approval: ApprovalPolicy`;新增 `DeliveryTarget`/`ApprovalMode`/`ApprovalPolicy` 类型(镜像 Java 线格式)
  - preload 暴露 `automationsList/Upsert/Remove/Runs`(经 IPC)

- [ ] **Step 1–4:** 改类型 → `npm --prefix desktop run typecheck` 绿(暂时会因 index.ts 未接线报错,故本任务与 Task 18 相邻提交;若拆分,先让类型自洽)。提交:

```bash
git commit -m "feat(desktop): 自动化共享类型扩展(cron/deliverTo/approval)+ preload 暴露"
```

---

### Task 17: 迁移映射(纯函数)

**Files:**
- Create: `desktop/src/main/automationMigration.ts`
- Test: `desktop/test/automationMigration.test.ts`

**Interfaces:**
- Produces:
  - `export function mapLegacyTask(legacy: LegacyAutomationTask): AutomationTask` — `projectPath→workspace`;`deliverTo=[{platform:'desktop'}]`;`approval={default:'deny'}`;其余原样;`lastFiredAt` 单独返回供灌 state
  - `export function needsMigration(daemonTasks, legacyTasks, migratedFlag): boolean`

- [ ] **Step 1: 写失败 vitest**(一个 legacy 任务映射后 `workspace` 来自 `projectPath`、`deliverTo=[desktop]`、`approval.default='deny'`;已迁移 flag → needsMigration=false)。
- [ ] **Step 2–5:** 跑失败 → 实现纯函数 → `npm --prefix desktop test` 绿 → 提交:

```bash
git commit -m "feat(desktop): automations 迁移映射(纯函数)"
```

---

### Task 18: index.ts 接线(IPC→RPC)+ 移除本地 scheduler + 启动迁移

**Files:**
- Modify: `desktop/src/main/index.ts`
- Test: typecheck + 现有 vitest 绿

**Interfaces:**
- Produces:
  - IPC handlers `automationList/Upsert/Remove/Runs` → `client.request('automations.*', params)`(复用现有 app-server rpcClient)
  - 移除 `automationScheduler = new AutomationScheduler(...)` + `.start()` 及 `will-quit` 的 `stopAll()`;automations 现由 daemon 跑
  - `whenReady` 里:读旧 `automations.json`(userData)+ 经 `automations.list` 判 daemon 库空 + 本地 migratedFlag → `mapLegacyTask` 逐个 `automations.upsert` → 落 lastFiredAt(经一个 `automations.setState` RPC 或写 state 文件由 daemon 接管;若简化,迁移只迁定义,lastFiredAt 从 0 起)→ 置 migratedFlag
  - `onTerminal` 桌面通知改为:轮询/订阅 daemon 的 `automations.runs`,对 `notifyDesktop && endedAt>lastSeen` 的终态 run 调现有 `notifyOS(...)`(复用现有标题/正文逻辑)

- [ ] **Step 1–4:** 改接线 → `npm --prefix desktop run typecheck` + `npm test` + `npm run build` 全绿 → 提交:

```bash
git commit -m "feat(desktop): automations 走 app-server RPC,移除本地 scheduler,启动一次性迁移"
```

---

### Task 19: `AutomationForm` UI(cron 输入 + 审批配置 + deliverTo)

**Files:**
- Modify: `desktop/src/renderer/components/AutomationForm.tsx`、`AutomationsPanel.tsx`
- Test: `desktop/test/` 相关(纯 label/校验函数优先单测;组件层 smoke)

**Interfaces:**
- Produces:
  - schedule 类型选择加 "cron 表达式" → 文本输入 `expr`(前端轻校验 5 段 + 后端 upsert 二次校验)
  - `deliverTo` 多选(qq / desktop)
  - 审批区:default 模式下拉(deny/auto-approve/ask)+ 可选"按工具覆盖"表 + askTimeout 输入
  - 面板列表/历史改读 `automationsRuns`(含下次触发)

- [ ] **Step 1–4:** 抽纯校验/label 函数 + 单测 → 改组件 → typecheck+vitest+build 绿 → 提交:

```bash
git commit -m "feat(desktop): AutomationForm 加 cron 输入 + 审批配置 + deliverTo 选择"
```

---

### Task 20: 退役旧 TS 调度器 + 全量门禁 + 上线

**Files:**
- Delete: `desktop/src/main/automationScheduler.ts / automationRunner.ts / automationsStore.ts / automationRunState.ts / automationSchedule.ts` 及对应 `desktop/test/*` 测试(调度逻辑已移 Java)
- Modify: 任何残留 import

**Interfaces:** 无新增;确保无悬空 import。

- [ ] **Step 1:** 删文件 + 删/改其测试(`automationSchedule.test.ts`、`automationScheduler.shell.test.ts`、`automationRunner.test.ts` 等)。
- [ ] **Step 2: 全量门禁**

Run(Java):`mvn -DskipTests=false test` → 0F/0E。
Run(桌面):`npm --prefix desktop run typecheck && npm --prefix desktop test && npm --prefix desktop run build` → 全绿。

- [ ] **Step 3: 密钥红线扫描** — `git diff --cached | grep -inE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

- [ ] **Step 4: 上线** — rebuild+装 jar:
```bash
cp ~/.wraith/wraith.jar ~/.wraith/wraith.jar.bak-$(date +%Y%m%d-%H%M%S)-pre-cron
mvn -DskipTests package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
# 重启 daemon(见 /tmp/wraith-gateway.pid)
```

- [ ] **Step 5: 提交**

```bash
git commit -m "chore(desktop): 退役旧 TS 调度器(逻辑已迁 Java daemon)+ 全量门禁绿"
```

---

## Self-Review

- **Spec coverage:** §3 架构→Task 7/12;§4 数据模型/文件→Task 1/3/9/13;§5 调度器→Task 2/5/6,并发→Task 6,run-now/崩溃扫描→Task 6/14;§6 投递→Task 8/10/11/12;§7 审批→Task 4/13/14;§8 桌面→Task 15–19,迁移→Task 17/18;§9 错误处理→散落于各 Task 的 try/catch + 原子写 + QQ 可选(Task 7);§10 测试→每 Task 的 TDD;§11 依赖/门禁/上线→Task 1/20。无遗漏。
- **Placeholder scan:** 无 TBD/TODO;wiring 任务给了 Interfaces + 步骤 + 模板引用(`GatewaySession`/`GatewayIntegrationTest`/`AppServerGatewayConfigTest`/`QqApiClientKeyboardTest`),纯逻辑任务给了完整测试+实现代码。
- **Type consistency:** `computeNextRun(Schedule,long,Long,long)`、`TurnEngine.run→RunResult(status,answer,sessionId,deniedTools)`、`DeliveryAdapter.deliver(target,task,result)`、`ApprovalMode{DENY,AUTO_APPROVE,ASK}`/线格式 `deny|auto-approve|ask`、五个存储文件名跨 Task 一致。
- **已知实现期需对齐真实 API 的点**(实现时先 grep 确认,不阻塞计划):`Renderer` 接口全貌与 `ApprovalRequest` 工具名取法(Task 4);`ApprovalResult` 的 approve 工厂(Task 4);app-server RPC helper 精确签名(Task 15,照 `AppServerGatewayConfigTest`)。
