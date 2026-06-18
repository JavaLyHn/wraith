package com.lyhn.wraith.render;

import java.util.List;

/**
 * 共享的 "WRAITH" ANSI-Shadow 字标(6 行,纯字形,不含 ANSI / 缩进)。
 * 启动 banner({@code Main.startupBannerLines})与开场动画({@code IntroAnimation})共用同一份字形。
 */
public final class WraithWordmark {

    private WraithWordmark() {
    }

    /** 6 行等宽字形。每行字符数即显示列宽(全部为 BMP 单宽字符)。 */
    public static final List<String> LINES = List.of(
            "██╗    ██╗██████╗  █████╗ ██╗████████╗██╗  ██╗",
            "██║    ██║██╔══██╗██╔══██╗██║╚══██╔══╝██║  ██║",
            "██║ █╗ ██║██████╔╝███████║██║   ██║   ███████║",
            "██║███╗██║██╔══██╗██╔══██║██║   ██║   ██╔══██║",
            "╚███╔███╔╝██║  ██║██║  ██║██║   ██║   ██║  ██║",
            " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝");

    /** 显示列宽(取首行长度;各行等宽)。 */
    public static int width() {
        return LINES.get(0).length();
    }

    /** 行数。 */
    public static int height() {
        return LINES.size();
    }
}
