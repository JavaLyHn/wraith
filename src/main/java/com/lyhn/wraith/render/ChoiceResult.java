package com.lyhn.wraith.render;

/**
 * 交互式选择器的结果。
 *
 * @param selectedIndex 选中项下标，取消时为 -1
 * @param isCancelled   是否取消
 */
public record ChoiceResult(
        int selectedIndex,
        boolean isCancelled
) {
    /** 用户取消时的工厂方法。 */
    public static ChoiceResult cancelled() {
        return new ChoiceResult(-1, true);
    }

    /** 用户选中某项时的工厂方法。 */
    public static ChoiceResult selected(int index) {
        return new ChoiceResult(index, false);
    }
}
