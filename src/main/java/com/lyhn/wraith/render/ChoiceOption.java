package com.lyhn.wraith.render;

/**
 * 选择器中的一个选项。
 *
 * @param label       显示文本（必填）
 * @param description 可选描述，有值时在 label 下方浅色显示
 */
public record ChoiceOption(
        String label,
        String description
) {}
