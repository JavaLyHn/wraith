package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * /archive 命令族解析层边界测试。
 *
 * <p>关键点:子命令(list/show/restore/delete/clear)必须先于裸 /archive 匹配,
 * 否则 "/archive list" 会被当成给 /archive 的自定义标题。
 */
class CliCommandParserArchiveTest {

    private CliCommandParser.ParsedCommand parse(String input) {
        return CliCommandParser.parse(input);
    }

    @Test
    void bareArchiveHasNoPayload() {
        CliCommandParser.ParsedCommand c = parse("/archive");
        assertEquals(CliCommandParser.CommandType.ARCHIVE, c.type());
        assertNull(c.payload());
    }

    @Test
    void archiveWithTitleCarriesRemainderAsPayload() {
        CliCommandParser.ParsedCommand c = parse("/archive 修一下登录");
        assertEquals(CliCommandParser.CommandType.ARCHIVE, c.type());
        assertEquals("修一下登录", c.payload());
    }

    @Test
    void subcommandsWinOverBareArchive() {
        // 这条是关键:若裸 /archive 先匹配,"list" 会被当成自定义标题
        assertEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/archive list").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_CLEAR, parse("/archive clear").type());
    }

    @Test
    void showRestoreDeleteCarryId() {
        assertEquals("20260805-101010-ab12", parse("/archive show 20260805-101010-ab12").payload());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_SHOW, parse("/archive show x").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_RESTORE, parse("/archive restore x").type());
        assertEquals(CliCommandParser.CommandType.ARCHIVE_DELETE, parse("/archive delete x").type());
    }

    @Test
    void caseInsensitive() {
        assertEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/ARCHIVE LIST").type());
    }

    @Test
    void archivedIsNotAnArchiveCommand() {
        // 前缀相近的输入不能被误吞
        assertNotEquals(CliCommandParser.CommandType.ARCHIVE, parse("/archived").type());
        assertNotEquals(CliCommandParser.CommandType.ARCHIVE_LIST, parse("/archived").type());
    }
}
