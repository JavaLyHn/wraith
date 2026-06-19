package com.lyhn.wraith.tool.todo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * 一条任务清单项(给用户看的实时 TODO 面板)。
 *
 * @param content 任务描述
 * @param status  状态
 */
public record TodoItem(String content, TodoStatus status) {

    /**
     * 容错解析 {@code todo_write} 的 todos 参数(JSON 数组,每项 {content, status})。
     * 非法 / 空 / 缺 content 的项跳过;无法识别的 status 记为待办;整体异常返回空列表。
     */
    public static List<TodoItem> parseList(String json, ObjectMapper mapper) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            JsonNode root = mapper.readTree(json);
            if (root == null || !root.isArray()) {
                return List.of();
            }
            List<TodoItem> out = new ArrayList<>();
            for (JsonNode n : root) {
                String content = n.hasNonNull("content") ? n.get("content").asText().strip() : "";
                if (content.isEmpty()) {
                    continue;
                }
                TodoStatus status = TodoStatus.fromWire(n.hasNonNull("status") ? n.get("status").asText() : null);
                out.add(new TodoItem(content, status));
            }
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }
}
