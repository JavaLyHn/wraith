package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * web-access skill 的工具选择表里，「搜索关键词、找入口」那行的 fallback 列曾是 `—`。
 *
 * <p>后果：`web_search` 不可用时，模型在<b>搜索这一步没有任何降级指令</b>，只能自己瞎凑。
 * 这个洞与「chrome-devtools 要不要接成 search provider」无关——它是纯文案洞，
 * 而 chrome-devtools 早就是内建 MCP（{@code McpConfigLoader} 里恒补
 * {@code npx -y chrome-devtools-mcp@latest}），skill 也在教模型用它读 SPA。
 * 缺的只是搜索这一步的出口。
 *
 * <p>这条测试守的就是那行不被改回去。
 */
class SearchRoutingDocTest {

    private static String skillMarkdown() throws IOException {
        try (InputStream in = SearchRoutingDocTest.class.getClassLoader()
                .getResourceAsStream("skills/web-access/SKILL.md")) {
            assertNotNull(in, "web-access skill 应当在 classpath 上");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    @DisplayName("搜索那一行有浏览器降级出口，不再是 `—`")
    void searchRowHasBrowserFallback() throws IOException {
        String markdown = skillMarkdown();

        String searchRow = markdown.lines()
                .filter(line -> line.contains("搜索关键词"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("工具选择表里应当有「搜索关键词」那行"));

        assertTrue(searchRow.contains("web_search"), "首选仍是 web_search");
        assertTrue(searchRow.contains("chrome-devtools"),
                "fallback 列该给浏览器出口,否则 web_search 不可用时模型只能瞎凑: " + searchRow);
    }

    @Test
    @DisplayName("SearchProvider 接口注释列全所有实现")
    void interfaceDocListsAllImplementations() throws IOException {
        // 读源码而不是反射:这里断言的是「注释有没有跟上」,不是运行时行为。
        // 相对路径成立的前提是 surefire 的工作目录是项目根,本仓库既有测试同样依赖这一点。
        String source = java.nio.file.Files.readString(
                java.nio.file.Path.of("src/main/java/com/lyhn/wraith/web/SearchProvider.java"));

        assertTrue(source.contains("ZhipuSearchProvider"), "zhipu 此前就漏了");
        assertTrue(source.contains("SerpApiSearchProvider"));
        assertTrue(source.contains("SearxngSearchProvider"));
        assertTrue(source.contains("DuckDuckGoSearchProvider"));
        assertTrue(source.contains("UnconfiguredSearchProvider"));
    }
}
