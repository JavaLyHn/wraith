package com.lyhn.wraith.tool.todo;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TodoItemTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void parsesValidList() {
        List<TodoItem> items = TodoItem.parseList(
                "[{\"content\":\"读取\",\"status\":\"completed\"},"
                        + "{\"content\":\"重构\",\"status\":\"in_progress\"},"
                        + "{\"content\":\"测试\",\"status\":\"pending\"}]",
                mapper);
        assertEquals(3, items.size());
        assertEquals("读取", items.get(0).content());
        assertEquals(TodoStatus.COMPLETED, items.get(0).status());
        assertEquals(TodoStatus.IN_PROGRESS, items.get(1).status());
        assertEquals(TodoStatus.PENDING, items.get(2).status());
    }

    @Test
    void unknownStatusBecomesPending() {
        List<TodoItem> items = TodoItem.parseList("[{\"content\":\"x\",\"status\":\"weird\"}]", mapper);
        assertEquals(TodoStatus.PENDING, items.get(0).status());
    }

    @Test
    void skipsItemsWithoutContent() {
        List<TodoItem> items = TodoItem.parseList(
                "[{\"status\":\"pending\"},{\"content\":\"  \"},{\"content\":\"ok\"}]", mapper);
        assertEquals(1, items.size());
        assertEquals("ok", items.get(0).content());
    }

    @Test
    void emptyOrBadInputYieldsEmpty() {
        assertTrue(TodoItem.parseList(null, mapper).isEmpty());
        assertTrue(TodoItem.parseList("", mapper).isEmpty());
        assertTrue(TodoItem.parseList("not json", mapper).isEmpty());
        assertTrue(TodoItem.parseList("{\"todos\":[]}", mapper).isEmpty()); // 非数组
    }

    @Test
    void statusFromWireAliases() {
        assertEquals(TodoStatus.IN_PROGRESS, TodoStatus.fromWire("in-progress"));
        assertEquals(TodoStatus.COMPLETED, TodoStatus.fromWire("DONE"));
        assertEquals(TodoStatus.PENDING, TodoStatus.fromWire(null));
    }
}
