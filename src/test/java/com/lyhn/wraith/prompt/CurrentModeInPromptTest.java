package com.lyhn.wraith.prompt;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 系统提示必须告诉模型<b>当前运行模式</b>。
 *
 * <p><b>症状</b>（用户实测）：用户明明在 ReAct 模式，模型却对他说
 * 「我注意到你当前处于 Plan 模式……ReAct 模式（左下角可切）会更直接高效」。
 *
 * <p><b>根因</b>：整个 prompt 语料里<b>没有任何地方</b>告诉模型当前模式是什么。
 * 唯一沾边的是 {@code modes/agent.md} 第 3 行「你在默认 ReAct 模式下工作」——
 * 一句静态断言，还带个「默认」，读起来像「这是缺省值，用户可能改过」。
 *
 * <p>而模式这件事在对话历史里<b>有</b>强信号：Plan / Team 模式下问一个问题会撞
 * {@link com.lyhn.wraith.plan.NoPlanException}，{@code PlanJson.noPlanMessage} 那段
 * 「Plan / Team 模式会先要求模型产出 JSON 计划……把模式切回 ReAct 再问一次」
 * 会被 {@code memoryManager.addAssistantMessage} <b>写进对话历史</b>。此后哪怕用户
 * 切回了 ReAct，模型在历史里仍看得到这段具体、就在眼前的话，压过 system prompt 里
 * 那句轻飘飘的静态断言 —— 于是它对用户宣布「你当前处于 Plan 模式」。
 * （截图里模型说的「左下角」也是从那段文案抄的，而切换器其实在<b>右下角</b>。）
 *
 * <p><b>这是第八次 snapshot-vs-live，但形态是新的</b>：前七次都是<b>代码</b>持有陈旧副本；
 * 这次是<b>模型</b>持有陈旧副本 —— 历史是快照，模式是活状态，而我们从来没给它现值。
 *
 * <p><b>修法的关键在「派生」而不是「再拉一条线」</b>：模式名直接由
 * {@link PromptMode} 算出来（{@link PromptMode#displayName()}）。选模式文件的和声明
 * 模式的是同一个枚举，两者永远不会各说各话；若另加一个 PromptContext 字段，就又多了
 * 一个可以忘记更新的地方。
 */
class CurrentModeInPromptTest {

    private static String ctx(PromptMode mode) {
        return PromptAssembler.runtimeContext("2026-08-03", "Asia/Shanghai", "Mac OS X", mode);
    }

    @Test
    @DisplayName("ReAct 模式:运行时上下文里明确写着 ReAct")
    void reactModeIsAnnounced() {
        String s = ctx(PromptMode.AGENT);
        assertTrue(s.contains("当前运行模式"), "该有这一行: " + s);
        assertTrue(s.contains("ReAct"), s);
        assertFalse(s.contains("当前运行模式: **Plan**"), s);
    }

    @Test
    @DisplayName("Plan 与 Team 也各自报对 —— planner / worker / reviewer 都算在各自模式里")
    void planAndTeamModesAreAnnounced() {
        assertTrue(ctx(PromptMode.PLAN).contains("Plan"), "PLAN 该报 Plan");
        assertTrue(ctx(PromptMode.PLANNER).contains("Plan"), "PLANNER 是 Plan 模式的规划者");
        assertTrue(ctx(PromptMode.TEAM_PLANNER).contains("Team"), "TEAM_PLANNER 该报 Team");
        assertTrue(ctx(PromptMode.TEAM_WORKER).contains("Team"), "TEAM_WORKER 该报 Team");
        assertTrue(ctx(PromptMode.TEAM_REVIEWER).contains("Team"), "TEAM_REVIEWER 该报 Team");
    }

    @Test
    @DisplayName("每个 PromptMode 都有 displayName —— 新增模式忘了填会被这条抓住")
    void everyPromptModeHasADisplayName() {
        for (PromptMode m : PromptMode.values()) {
            String name = m.displayName();
            assertTrue(name != null && !name.isBlank(), m + " 缺 displayName");
        }
        assertEquals("ReAct", PromptMode.AGENT.displayName());
    }

    @Test
    @DisplayName("必须显式作废历史里的模式说法 —— 否则历史里那段具体的话仍会压过这一行")
    void historyStatementsAreExplicitlyInvalidated() {
        String s = ctx(PromptMode.AGENT);
        assertTrue(s.contains("历史"), "要点名「对话历史」这个来源: " + s);
        assertTrue(s.contains("过去") || s.contains("不代表现在"),
                "要说清历史里的模式说法属于过去某一回合: " + s);
    }

    @Test
    @DisplayName("要告诉模型切换器在哪 —— 而且是右下角(截图里模型照着旧文案说了左下角)")
    void switcherLocationIsCorrect() {
        String s = ctx(PromptMode.AGENT);
        assertTrue(s.contains("右下角"), "模式选择器在输入框右下角: " + s);
        assertFalse(s.contains("左下角"), "「左下角」是错的,模型会照着复述: " + s);
    }

    @Test
    @DisplayName("这一行进得了完整 prompt —— 只放进 runtimeContext 不装配上去等于没写")
    void theLineReachesTheAssembledPrompt() {
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.AGENT, PromptContext.empty());
        assertTrue(prompt.contains("当前运行模式"), "完整 prompt 里找不到这一行");
        assertTrue(prompt.contains("ReAct"), prompt.substring(0, Math.min(400, prompt.length())));
    }

    @Test
    @DisplayName("Plan 模式装配出的 prompt 说的是 Plan,不会串成 ReAct")
    void planPromptSaysPlan() {
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.PLAN, PromptContext.empty());
        assertTrue(prompt.contains("当前运行模式: **Plan**"),
                "Plan 模式该报 Plan: " + prompt.lines()
                        .filter(l -> l.contains("当前运行模式")).findFirst().orElse("(那一行不存在)"));
    }

    @Test
    @DisplayName("旧三参重载仍在 —— 已有测试与调用方不必改")
    void legacyThreeArgOverloadStillWorks() {
        String s = PromptAssembler.runtimeContext("2026-08-03", "UTC", "Windows 11");
        assertTrue(s.contains("cmd.exe"), s);
    }
}
