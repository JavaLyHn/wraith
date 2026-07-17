package com.lyhn.wraith.context.curator;

/** 治理产物的机器可读标记:pass 见标即跳过——单调性的实现基石。 */
public final class CurationMarks {
    public static final String SNIP_MARK = "⟦wraith:snip⟧";
    public static final String PRUNE_MARK = "⟦wraith:prune⟧";
    /** 完整日志指针行前缀(spill 与 pass 共用,pass 改写时必须保留该行)。 */
    public static final String LOG_POINTER_PREFIX = "[完整输出: ";
    private CurationMarks() {}
}
