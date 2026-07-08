package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;

import java.util.List;

public record ToolOutput(String text, List<LlmClient.ContentPart> imageParts, boolean ok) {
    public ToolOutput {
        text = text == null ? "" : text;
        imageParts = imageParts == null ? List.of() : List.copyOf(imageParts);
    }

    /** 兼容:2 参构造默认 ok=true(保留 McpClient/McpCallToolResult 的既有调用)。 */
    public ToolOutput(String text, List<LlmClient.ContentPart> imageParts) {
        this(text, imageParts, true);
    }

    public static ToolOutput text(String text) {
        return new ToolOutput(text, List.of(), true);
    }

    /** 失败输出:ok=false。 */
    public static ToolOutput failure(String text) {
        return new ToolOutput(text, List.of(), false);
    }

    public boolean hasImageParts() {
        return !imageParts.isEmpty();
    }
}
