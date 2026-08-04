package com.lyhn.wraith.config;

/**
 * 从要回给前端 / 打给用户看的字符串里抹掉凭证。
 *
 * <p><b>为什么单独一个类</b>：这段逻辑原来只在 {@code Main.redactKey} 里。
 * embedding 的「测试连接」（{@code com.lyhn.wraith.rag.EmbeddingProbe}）也要抹 ——
 * 而 {@code rag} 不该依赖 {@code cli}。安全逻辑存两份就会漂：一边修了另一边没修，
 * 而这种漂的后果是把 key 打到界面上。所以搬到两边都依赖的 {@code config} 下，
 * {@code Main.redactKey} 改成委托（它的调用点与测试都不动）。
 *
 * <p><b>能力边界要说清</b>：这是<b>防御性</b>的一层，判据只有「已知的那串字符出现在文本里」。
 * 它抹不掉服务端自己拼过的形态（截断、大小写变形、URL 编码）。真正的保证在上游：
 * 别把凭证放进任何回包字段。这一层是兜底，不是许可。
 */
public final class SecretRedaction {

    private SecretRedaction() {}

    /** null 安全：message 为 null 原样返回；secret 空白视为无凭证可抹。 */
    public static String redact(String message, String secret) {
        if (message == null) return null;
        if (secret == null || secret.isBlank()) return message;
        return message.contains(secret) ? message.replace(secret, "[redacted]") : message;
    }
}
