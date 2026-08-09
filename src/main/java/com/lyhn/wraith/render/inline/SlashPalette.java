package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.jline.terminal.Terminal;

import java.io.PrintStream;
import java.util.List;

/**
 * 临时浮起的命令选择列表。
 *
 * <p>实现委托给 {@link InteractiveSelector}，保留旧的 {@code (PrintStream, Terminal)}
 * 构造器与 {@code open(String, List<String>)} 入口，使 {@code Main.java} 等现有调用方
 * 不需要改动。新代码应直接走 {@link com.lyhn.wraith.render.Renderer#promptChoice}。
 */
public final class SlashPalette {

    private final InteractiveSelector delegate;

    public SlashPalette(PrintStream out, Terminal terminal) {
        this.delegate = new InteractiveSelector(out, terminal);
    }

    /**
     * 打开 palette,阻塞等待用户选择。
     *
     * @return 选中项的下标;用户取消(Esc)返回 -1
     */
    public int open(String title, List<String> items) {
        if (items == null || items.isEmpty()) {
            return -1;
        }
        List<ChoiceOption> opts = items.stream()
                .map(s -> new ChoiceOption(s, null))
                .toList();
        ChoiceResult result = delegate.open(new ChoiceRequest(title, opts, true, null));
        return result.isCancelled() ? -1 : result.selectedIndex();
    }
}
