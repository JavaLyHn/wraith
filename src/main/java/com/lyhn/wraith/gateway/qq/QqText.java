package com.lyhn.wraith.gateway.qq;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public final class QqText {
    private QqText() {}

    public static List<String> chunk(String text, int max) {
        List<String> out = new ArrayList<>();
        if (text == null) text = "";
        int i = 0, n = text.length();
        while (i < n) {
            int end = Math.min(i + max, n);
            if (end < n) {
                int nl = text.lastIndexOf('\n', end);
                if (nl > i) end = nl;               // 在窗口内的换行处断(去掉该换行)
            }
            String piece = text.substring(i, end);
            out.add(piece);
            i = (end < n && text.charAt(end) == '\n') ? end + 1 : end;
        }
        if (out.isEmpty()) out.add("");
        return out;
    }

    /** msg_seq:1..65535 环绕,防 QQ 对同 msg_id 重复发的去重。 */
    public static int nextMsgSeq(AtomicInteger ctr) {
        int v = ctr.updateAndGet(x -> x >= 65535 ? 1 : x + 1);
        return v;
    }
}
