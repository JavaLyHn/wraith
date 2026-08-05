package com.lyhn.wraith.documents;

import com.lyhn.wraith.hitl.ApprovalPolicy;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.FileNotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 「文档资料库」的 agent 只读入口。
 *
 * <p>存在理由：资料库刻意不属于任何项目（它就是跨项目的知识存放处），而 {@code read_file} 被
 * {@code PathGuard(projectPath)} 锁在当前项目内 —— 在这两个工具之前，库里的东西只有桌面 UI
 * 读得到，agent 在任何项目里都读不到。
 *
 * <p>测试隔离：全程用 {@code -Dwraith.config.dir} 把 {@code ~/.wraith} 重定向到 {@code @TempDir}，
 * 绝不碰开发机上真实的资料库；每个用例结束还原该系统属性。
 */
class DocumentsVaultTest {

    private String saved;

    private void redirect(Path base) {
        saved = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", base.toString());
    }

    @AfterEach
    void restore() {
        if (saved == null) System.clearProperty("wraith.config.dir");
        else System.setProperty("wraith.config.dir", saved);
    }

    @Test
    void listsNewestFirstAndSkipsHiddenFiles(@TempDir Path base) throws Exception {
        redirect(base);
        Path vault = Files.createDirectories(base.resolve("documents"));
        Files.writeString(vault.resolve("旧.md"), "old");
        Files.writeString(vault.resolve("新.md"), "new");
        Files.setLastModifiedTime(vault.resolve("旧.md"),
                java.nio.file.attribute.FileTime.fromMillis(1_000_000));
        Files.setLastModifiedTime(vault.resolve("新.md"),
                java.nio.file.attribute.FileTime.fromMillis(9_000_000));
        Files.writeString(vault.resolve(".DS_Store"), "junk");

        var names = DocumentsVault.list().stream().map(DocumentsVault.Entry::name).toList();
        assertEquals(java.util.List.of("新.md", "旧.md"), names,
                "应按修改时间倒序：日报这类按天生成的东西，最新那份最常被问到");
        assertFalse(names.contains(".DS_Store"), "点开头的不是用户放进来的文档");
    }

    @Test
    void missingVaultDirIsEmptyNotError(@TempDir Path base) {
        redirect(base);   // 不建 documents 目录
        assertTrue(DocumentsVault.list().isEmpty(), "库还没建 = 空库，不是错误");
    }

    @Test
    void readsContent(@TempDir Path base) throws Exception {
        redirect(base);
        Path vault = Files.createDirectories(base.resolve("documents"));
        Files.writeString(vault.resolve("报告.md"), "# 标题\n正文");
        assertEquals("# 标题\n正文", DocumentsVault.read("报告.md"));
    }

    @Test
    void rejectsPathTraversalAndSeparators(@TempDir Path base) throws Exception {
        redirect(base);
        Files.createDirectories(base.resolve("documents"));
        Files.writeString(base.resolve("秘密.txt"), "不该被读到");

        for (String evil : new String[]{"../秘密.txt", "..", "sub/x.md", "sub\\x.md", "/etc/passwd"}) {
            assertThrows(IllegalArgumentException.class, () -> DocumentsVault.read(evil),
                    "应拒绝越界名字：" + evil);
        }
    }

    @Test
    void rejectsBlankName(@TempDir Path base) {
        redirect(base);
        assertThrows(IllegalArgumentException.class, () -> DocumentsVault.read("  "));
    }

    @Test
    void missingDocumentThrowsFileNotFound(@TempDir Path base) throws Exception {
        redirect(base);
        Files.createDirectories(base.resolve("documents"));
        assertThrows(FileNotFoundException.class, () -> DocumentsVault.read("不存在.md"));
    }

    @Test
    void symlinkIsNotReadableNorListed(@TempDir Path base) throws Exception {
        redirect(base);
        Path vault = Files.createDirectories(base.resolve("documents"));
        Path outside = base.resolve("库外.txt");
        Files.writeString(outside, "库外内容");
        try {
            Files.createSymbolicLink(vault.resolve("链接.md"), outside);
        } catch (UnsupportedOperationException | java.io.IOException e) {
            return;   // 平台不支持建软链（Windows 无权限时）→ 跳过，不算失败
        }
        assertThrows(FileNotFoundException.class, () -> DocumentsVault.read("链接.md"),
                "库内软链指向库外文件，不该当成库内文档读出来");
        assertTrue(DocumentsVault.list().stream().noneMatch(e -> e.name().equals("链接.md")),
                "软链也不该出现在列表里（与桌面侧 lstat 跳过软链同源）");
    }

    @Test
    void truncatesOversizedDocumentAndSaysSo(@TempDir Path base) throws Exception {
        redirect(base);
        Path vault = Files.createDirectories(base.resolve("documents"));
        Files.writeString(vault.resolve("大.md"), "x".repeat(DocumentsVault.MAX_READ_BYTES + 5_000));
        String got = DocumentsVault.read("大.md");
        assertTrue(got.contains("已截断"), "截断必须说出来 —— 静默截断会让模型基于半份内容下结论");
        assertTrue(got.length() < DocumentsVault.MAX_READ_BYTES + 500);
    }

    // ---- 工具层 ----

    @Test
    void bothToolsRegisteredAndExposed() {
        ToolRegistry reg = new ToolRegistry();
        for (String name : new String[]{"documents_list", "documents_read"}) {
            assertTrue(reg.hasTool(name), name + " 应已注册");
            assertTrue(reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals(name)),
                    name + " 应暴露给 LLM");
        }
    }

    @Test
    void readOnlyToolsAreNotGatedByApproval() {
        for (String name : new String[]{"documents_list", "documents_read"}) {
            assertFalse(ApprovalPolicy.requiresApproval(name),
                    name + " 是只读工具，不该设审批闸 —— 否则无人值守的定时任务没法用");
        }
    }

    @Test
    void toolReportsMissingDocumentWithoutThrowing(@TempDir Path base) throws Exception {
        redirect(base);
        Files.createDirectories(base.resolve("documents"));
        String out = new ToolRegistry().executeTool("documents_read",
                "{\"name\":\"今天没有.md\"}");
        assertTrue(out.contains("没有这份文档"),
                "「库里没有」是常见的正常情况（比如今天的报告还没生成），要如实说而不是抛异常");
        assertTrue(out.contains("documents_list"), "应指路怎么查现在有哪些");
    }

    @Test
    void toolRejectsTraversalWithoutThrowing(@TempDir Path base) throws Exception {
        redirect(base);
        Files.createDirectories(base.resolve("documents"));
        String out = new ToolRegistry().executeTool("documents_read",
                "{\"name\":\"../秘密.txt\"}");
        assertTrue(out.startsWith("documents_read 失败"), "越界应返回可读错误而不是抛出");
    }
}
