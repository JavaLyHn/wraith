# list_skills 工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增无参工具 `list_skills`，让模型在被问"有哪些 skill"时调用它列出当前启用 skill，而非回避。

**Architecture:** 在 `ToolRegistry.registerSkillTools()` 内紧挨 `load_skill` 注册 `list_skills`，handler 读 `skillRegistry.enabledSkills()` 渲染"名称+来源+简介"清单，禁用项以尾注提示；description 截断复用 `SkillIndexFormatter.truncateByCodepoint`（需提升为 public）。同时把 `SkillIndexFormatter` 里方案 A 的提示从"直接列出"重指向为"调用 list_skills"。

**Tech Stack:** Java 17，Maven，JUnit 5（`@TempDir`），既有 `ToolRegistry.executeTool(name, jsonArgs)` 测试入口。

## Global Constraints

- 包名 `com.lyhn.wraith`，Java 17，Maven。
- 密钥红线：本任务无密钥面；提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 测试默认 skip，跑测试须带 `-DskipTests=false`。~4F/38E 基线是 JDK26+Mockito 既有噪声，非本次引入。
- 分支续用 `fix/skill-list-prompt`。
- 三层覆盖（builtin→project→user，user 胜）不动。

## File Structure

- `src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java` — 修改：`truncateByCodepoint` 提升为 `public`（供 ToolRegistry 跨包复用）；方案 A 提示句重指向 `list_skills`。
- `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` — 修改：`registerSkillTools()` 内新增 `list_skills` 工具；按需补 import。
- `src/test/java/com/lyhn/wraith/skill/ListSkillsToolTest.java` — 新建：镜像 `LoadSkillToolTest`，验证 `list_skills` 各分支。
- `src/test/java/com/lyhn/wraith/skill/SkillIndexFormatterTest.java` — 修改：`includesUserFacingListingInstruction` 断言随重指向更新。

---

### Task 1: 新增 list_skills 工具

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java`（`truncateByCodepoint` 提升 public）
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（`registerSkillTools()` 内新增工具 + import）
- Test: `src/test/java/com/lyhn/wraith/skill/ListSkillsToolTest.java`（新建）

**Interfaces:**
- Consumes:
  - `ToolRegistry.setSkillRegistry(SkillRegistry)`、`ToolRegistry.executeTool(String name, String jsonArgs) -> String`（既有）。
  - `SkillRegistry.enabledSkills() -> List<Skill>`、`SkillRegistry.allSkills() -> List<Skill>`（既有）。
  - `Skill.name() -> String`、`Skill.description() -> String`、`Skill.displaySource() -> String`（返回 `"builtin"/"user"/"project"`）。
  - `SkillIndexFormatter.MAX_DESCRIPTION_CODEPOINTS`（`public static final int = 500`，既有）。
- Produces:
  - `SkillIndexFormatter.truncateByCodepoint(String, int) -> String` 由包级私有提升为 `public static`（Task 2 与既有测试同包不受影响）。
  - 工具 `list_skills`（无参），`executeTool("list_skills","{}")` 返回启用清单字符串。

- [ ] **Step 1: 写失败测试（新建 ListSkillsToolTest）**

新建 `src/test/java/com/lyhn/wraith/skill/ListSkillsToolTest.java`：

```java
package com.lyhn.wraith.skill;

import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class ListSkillsToolTest {

    @Test
    void listsEnabledSkillWithNameAndDescription(@TempDir Path tempDir) throws IOException {
        SkillRegistry registry = registryWith(tempDir, "web-access", "联网工具决策手册", "body");
        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");

        assertTrue(result.contains("web-access"), result);
        assertTrue(result.contains("联网工具决策手册"), result);
        assertTrue(result.contains("user"), "应标注来源 displaySource");
    }

    @Test
    void notesDisabledCount(@TempDir Path tempDir) throws IOException {
        // 两个 user skill，其中一个被禁用 -> 启用 1、禁用 1
        writeUserSkill(tempDir, "enabled-one", "d1", "b1");
        writeUserSkill(tempDir, "disabled-one", "d2", "b2");
        Path userRoot = tempDir.resolve("user-skills");
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        state.disable("disabled-one");
        SkillRegistry registry = new SkillRegistry(null, userRoot, null, state);
        registry.reload();

        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("enabled-one"), result);
        assertFalse(result.contains("disabled-one"), "禁用 skill 不应出现在启用清单里");
        assertTrue(result.contains("另有 1 个 skill 已禁用"), result);
    }

    @Test
    void emptyWhenNoEnabledSkills(@TempDir Path tempDir) throws IOException {
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        SkillRegistry registry = new SkillRegistry(null, tempDir.resolve("empty-user"), null, state);
        registry.reload();

        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("没有启用任何 skill"), result);
    }

    @Test
    void failsWhenRegistryNull() {
        ToolRegistry tools = new ToolRegistry();
        // 不注入 skillRegistry
        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("未初始化"), result);
    }

    private static SkillRegistry registryWith(Path tempDir, String name, String desc, String body) throws IOException {
        Path userRoot = writeUserSkill(tempDir, name, desc, body).getParent().getParent();
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        SkillRegistry registry = new SkillRegistry(null, userRoot, null, state);
        registry.reload();
        return registry;
    }

    private static Path writeUserSkill(Path tempDir, String name, String desc, String body) throws IOException {
        Path userRoot = tempDir.resolve("user-skills");
        Path skillDir = userRoot.resolve(name);
        Files.createDirectories(skillDir);
        Path skillMd = skillDir.resolve("SKILL.md");
        Files.writeString(skillMd,
                "---\nname: " + name
                        + "\ndescription: " + desc
                        + "\n---\n" + body + "\n");
        return skillMd;
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ListSkillsToolTest test 2>&1 | tail -20`
Expected: FAIL —— `list_skills` 未注册，`executeTool` 返回"未知工具"之类，断言不满足（非编译错）。

> 若 `executeTool` 对未知工具抛异常而非返回字符串，测试同样会 RED，符合预期。

- [ ] **Step 3: 提升 truncateByCodepoint 为 public**

在 `src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java` 把：

```java
    static String truncateByCodepoint(String s, int limit) {
```

改为：

```java
    public static String truncateByCodepoint(String s, int limit) {
```

- [ ] **Step 4: 在 ToolRegistry 注册 list_skills**

先确认 import。文件顶部应已有 `import com.lyhn.wraith.skill.Skill;`、`import com.lyhn.wraith.skill.SkillRegistry;`、`import java.util.List;`。补一行（若无）：

```java
import com.lyhn.wraith.skill.SkillIndexFormatter;
```

在 `registerSkillTools()` 方法内、`load_skill` 的 `tools.put(...)` 之后、方法右括号 `}` 之前插入：

```java
        tools.put("list_skills", new Tool(
                "list_skills",
                "当用户问“你有哪些技能 / 会做什么 / 列出 skill”时调用，返回当前启用的 skill 清单（名称 + 简介）。这是回答此类问题的权威来源，直接把结果转述给用户，不要回避、也不要让用户自己去看系统提示。",
                createParameters(),
                args -> {
                    if (skillRegistry == null) {
                        return "list_skills 失败: Skill 系统未初始化";
                    }
                    List<Skill> enabled = skillRegistry.enabledSkills();
                    if (enabled.isEmpty()) {
                        return "当前没有启用任何 skill。";
                    }
                    StringBuilder sb = new StringBuilder();
                    sb.append("当前启用的 skill：\n");
                    for (Skill s : enabled) {
                        String desc = SkillIndexFormatter.truncateByCodepoint(
                                s.description().trim(), SkillIndexFormatter.MAX_DESCRIPTION_CODEPOINTS);
                        sb.append("- **").append(s.name()).append("**（")
                                .append(s.displaySource()).append("）：")
                                .append(desc).append('\n');
                    }
                    int disabled = skillRegistry.allSkills().size() - enabled.size();
                    if (disabled > 0) {
                        sb.append("\n另有 ").append(disabled)
                                .append(" 个 skill 已禁用，可用 /skill on <name> 启用。");
                    }
                    return sb.toString();
                }
        ));
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ListSkillsToolTest test 2>&1 | tail -20`
Expected: PASS —— `Tests run: 4, Failures: 0, Errors: 0`。

- [ ] **Step 6: skill/tool 包回归**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest="ListSkillsToolTest,LoadSkillToolTest,SkillIndexFormatterTest,SkillRegistryTest,ToolRegistryTest" test 2>&1 | grep -iE "Tests run:|BUILD" | tail -8`
Expected: 各测试类 `Failures: 0, Errors: 0`，`BUILD SUCCESS`。

> `SkillIndexFormatterTest.includesUserFacingListingInstruction` 此刻仍是方案 A 旧断言（"名称与简介"）——本 Task 未改提示句，故它仍应 GREEN。Task 2 才动它。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java \
        src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/test/java/com/lyhn/wraith/skill/ListSkillsToolTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(skill): 新增 list_skills 工具,被问技能时据启用清单枚举

无参工具,读 enabledSkills() 渲染 名称+来源+简介,禁用项以尾注提示。
description 截断复用 SkillIndexFormatter.truncateByCodepoint(提升为 public)。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 2: 方案 A 提示重指向 list_skills

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java:51-52`（提示句）
- Test: `src/test/java/com/lyhn/wraith/skill/SkillIndexFormatterTest.java:28-33`（断言）

**Interfaces:**
- Consumes: Task 1 已注册的 `list_skills` 工具名（提示句内引用该名字）。
- Produces: `SkillIndexFormatter.format(...)` 输出的用户枚举指令句改为引导调用 `list_skills`（含子串 `list_skills`，保留 `用户询问`）。

- [ ] **Step 1: 更新失败测试**

在 `src/test/java/com/lyhn/wraith/skill/SkillIndexFormatterTest.java`，把 `includesUserFacingListingInstruction` 改为：

```java
    @Test
    void includesUserFacingListingInstruction() {
        // 当用户问"有哪些技能"时,提示应引导模型调用 list_skills 工具,而非回避。
        String out = SkillIndexFormatter.format(List.of(mockSkill("web-access", "联网", Skill.Source.BUILTIN)));
        assertTrue(out.contains("用户询问"), "应含面向用户的枚举指令(用户询问技能时)");
        assertTrue(out.contains("list_skills"), "应指示调用 list_skills 工具获取清单");
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SkillIndexFormatterTest test 2>&1 | tail -20`
Expected: FAIL —— `includesUserFacingListingInstruction` 断言 `list_skills` 子串不满足（现文案是"名称与简介"，无 list_skills）。

- [ ] **Step 3: 重指向提示句**

在 `src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java` 把：

```java
        sb.append("当用户询问你有哪些技能 / 会做什么 / 让你列出技能时，直接依据上面的清单向用户列出每个 skill 的")
                .append("名称与简介，不要回避、也不要让用户自己去看系统提示。\n");
```

改为：

```java
        sb.append("当用户询问你有哪些技能 / 会做什么 / 让你列出技能时，调用 list_skills 获取当前启用清单并转述给用户，")
                .append("不要回避、也不要让用户自己去看系统提示。\n");
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SkillIndexFormatterTest test 2>&1 | tail -20`
Expected: PASS —— `Tests run: 6, Failures: 0, Errors: 0`。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/skill/SkillIndexFormatter.java \
        src/test/java/com/lyhn/wraith/skill/SkillIndexFormatterTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
refactor(skill): 方案A提示重指向 list_skills 工具

从"直接依据清单列出"改为"调用 list_skills 获取清单并转述",
让提示与新工具合成一条确定动作,避免两条并行指令各行其是。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

## 交付后（计划外，人工/主循环执行）

1. `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests package` 重建 jar。
2. `cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar`。
3. 用户完全重启桌面 App，问"有哪些 skill"肉眼验证列出。
4. 验证通过 → `git checkout main && git merge --ff-only fix/skill-list-prompt && git push origin main`（推送前用户点头）→ `git branch -d fix/skill-list-prompt`。

## Self-Review

**1. Spec 覆盖：**
- 工具本体（无参/描述/handler/空/禁用尾注/未初始化）→ Task 1 Step 4 + 测试全覆盖。✓
- 复用 truncateByCodepoint → Task 1 Step 3 提升 public 后复用。✓
- 方案 A 重指向 → Task 2。✓
- 测试（ToolRegistry 层四分支 + Formatter 断言更新）→ Task 1 Step 1、Task 2 Step 1。✓ 且 spec 里"ToolRegistry 可测性未知"已探明：`executeTool(name,json)` 直接可测（见 LoadSkillToolTest 范式），无需退化方案。
- 交付链路 → "交付后"节。✓

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整代码。✓

**3. 类型一致性：** `enabledSkills()`/`allSkills()` 返回 `List<Skill>`；`displaySource()` 返回 `builtin/user/project`（测试断言 `"user"` 与之一致）；`truncateByCodepoint` public 提升在 Task 1 完成，Task 2 不再引用它——一致。✓
