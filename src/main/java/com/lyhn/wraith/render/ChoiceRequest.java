package com.lyhn.wraith.render;

import java.util.List;

/**
 * 交互式选择器的请求。
 *
 * @param title       选择器标题
 * @param options     2-9 个选项
 * @param allowCancel 是否允许 Esc 取消
 * @param hint        可选自定义底部提示，null 时用默认提示
 */
public record ChoiceRequest(
        String title,
        List<ChoiceOption> options,
        boolean allowCancel,
        String hint
) {}
