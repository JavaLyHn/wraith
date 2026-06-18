package com.lyhn.wraith.render.intro;

/**
 * 决定开场动画是否播放。每次启动都播(满足能力条件:inline 渲染器 + 颜色启用 + 真 TTY +
 * 终端足够宽),{@code WRAITH_INTRO=off} 可关闭。
 */
public final class IntroGate {

    private IntroGate() {
    }

    /** 字标宽 46,留边后的最小终端列宽。 */
    public static final int MIN_COLUMNS = 50;

    /** 纯函数:是否播放。便于单测。 */
    public static boolean shouldPlay(boolean inline,
                                     boolean colorEnabled,
                                     boolean realTty,
                                     int columns,
                                     String introEnv) {
        String env = introEnv == null ? "" : introEnv.trim().toLowerCase();
        if (env.equals("off") || env.equals("false") || env.equals("0")) {
            return false;
        }
        return inline && colorEnabled && realTty && columns >= MIN_COLUMNS;
    }
}
