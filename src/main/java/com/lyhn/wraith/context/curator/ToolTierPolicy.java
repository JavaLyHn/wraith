package com.lyhn.wraith.context.curator;

import java.util.Set;

/** 工具分级:保护名单显式声明,其余(含未知新工具)默认可压。数值为 pass 的截断常量。 */
public final class ToolTierPolicy {
    /** 任何 Tier 不动:技能正文=工作知识;记忆写入极小;状态回滚凭据。 */
    public static final Set<String> PROTECTED_TOOLS = Set.of("load_skill", "save_memory", "revert_turn");

    public static final int SNIP_KEEP_HEAD_CHARS = 600;
    public static final int SNIP_MIN_CHARS = 1_500;          // 原文短于此不值得动
    public static final int CODEBLOCK_KEEP_LINES = 8;
    public static final int CODEBLOCK_MIN_LINES = 60;        // 用户代码块超过此行数才截
    public static final int ASSISTANT_PRUNE_MIN_CHARS = 1_200;

    public boolean compressible(String toolName) {
        return toolName == null || !PROTECTED_TOOLS.contains(toolName);
    }
}
