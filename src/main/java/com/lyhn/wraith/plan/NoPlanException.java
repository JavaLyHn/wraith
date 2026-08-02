package com.lyhn.wraith.plan;

import java.io.IOException;

/**
 * 规划者没有返回计划（返回的是自然语言，不是 JSON）。
 *
 * <p>与「返回了 JSON 但是坏的 / 有环」区分开的理由：这一类**不是故障**，
 * 而是模式选错了——用户在 Plan / Team 模式下问了个问题。所以 message 是给用户看的
 * 完整指引（{@link PlanJson#noPlanMessage}），调用方应当**原样透出**，
 * 不要再加「执行失败:」之外的技术前缀，更不要包一层 Jackson 的话。
 *
 * <p>继承 {@link IOException} 是为了不改动既有调用点的 {@code throws} 签名——
 * {@code Planner.createPlan} 本就声明抛 IOException，上层照旧接得住。
 */
public class NoPlanException extends IOException {

    public NoPlanException(String userFacingMessage) {
        super(userFacingMessage);
    }
}
