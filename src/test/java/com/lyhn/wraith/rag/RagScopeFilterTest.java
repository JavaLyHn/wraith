package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引范围过滤的判据。
 *
 * <p><b>为什么做这个开关</b>：实测 wraith 自身索引的构成是 Java 主代码 35.4%、
 * <b>Java 测试 33.0%</b>、<b>docs 文档 20.8%</b>、桌面源码 7.0%、桌面测试 2.9% ——
 * 一半以上是测试和文档。而测试块特别容易压住主代码：这个仓库的测试名本身就在描述
 * 被测行为（{@code void thinExtractionSaysFetchSucceeded()}），语义上与
 * 「这功能怎么实现的」高度相似。
 *
 * <p><b>两个开关的效果方向相反，这是量出来的</b>（24 条冻结查询集，见
 * {@code scripts/rag-eval/}）：
 * <pre>
 *   基线(全索引)     MRR 0.2693   R@10 54.2%
 *   排除测试         MRR 0.3337   R@10 66.7%   好 10 / 差 1   ← +24%
 *   排除文档         MRR 0.2035   R@10 41.7%   好  1 / 差 4   ← −24%
 *   两者都排除        MRR 0.2943   R@10 66.7%   好 12 / 差 3
 * </pre>
 * 所以两个开关<b>必须分开</b>：合并成一个会把 +24% 拖成 +9%。「排除文档」是净亏，
 * 因为「为什么这么设计」这类问题的答案只在 {@code docs/} 里 —— 它保留下来是为了
 * 「我就是不想索引文档」（省磁盘/省时间）这个诉求，不是为了提升检索质量。
 *
 * <p><b>判据必须可枚举、可预测</b>，不用启发式（如「assert 密度高就算测试」）——
 * 那会产生「为什么我这个文件没被索引」这类用户无法自查的问题。
 */
class RagScopeFilterTest {

    // ---- 测试判据 ----

    @Test
    @DisplayName("Maven / Gradle 约定目录:src/test 与 src/it")
    void mavenTestDirs() {
        assertTrue(RagScopeFilter.isTest("src/test/java/com/lyhn/wraith/rag/CodeIndexTest.java"));
        assertTrue(RagScopeFilter.isTest("src/it/java/com/lyhn/wraith/Smoke.java"));
        assertFalse(RagScopeFilter.isTest("src/main/java/com/lyhn/wraith/rag/CodeIndex.java"));
    }

    @Test
    @DisplayName("Surefire / Failsafe 的默认文件名模式:*Test / *Tests / *IT")
    void javaTestFileNames() {
        assertTrue(RagScopeFilter.isTest("anywhere/FooTest.java"));
        assertTrue(RagScopeFilter.isTest("anywhere/FooTests.java"));
        assertTrue(RagScopeFilter.isTest("anywhere/FooIT.java"));
    }

    @Test
    @DisplayName("vitest / jest 约定:*.test.ts / *.spec.tsx 等")
    void jsTestFileNames() {
        for (String p : new String[]{"desktop/test/ragView.test.ts", "src/a.test.tsx",
                "src/a.spec.ts", "src/a.spec.js", "x/y.test.mjs"}) {
            assertTrue(RagScopeFilter.isTest(p), p);
        }
    }

    @Test
    @DisplayName("通用测试目录:/test/ /tests/ /__tests__/")
    void genericTestDirs() {
        assertTrue(RagScopeFilter.isTest("desktop/test/foo.ts"));
        assertTrue(RagScopeFilter.isTest("pkg/tests/foo.py"));
        assertTrue(RagScopeFilter.isTest("web/__tests__/foo.js"));
    }

    @Test
    @DisplayName("pytest / go test:test_*.py / *_test.py / *_test.go")
    void pythonAndGoTests() {
        assertTrue(RagScopeFilter.isTest("tools/test_report.py"));
        assertTrue(RagScopeFilter.isTest("tools/report_test.py"));
        assertTrue(RagScopeFilter.isTest("cmd/main_test.go"));
    }

    @Test
    @DisplayName("不许误伤:Latest.java / contest 目录 / protest.md 都不是测试")
    void doesNotMisfireOnLookalikes() {
        // 「Test」出现在词中间不算 —— 判据是文件名后缀而不是子串
        assertFalse(RagScopeFilter.isTest("src/main/java/Latest.java"), "Latest.java");
        assertFalse(RagScopeFilter.isTest("src/main/java/GreatestHits.java"), "GreatestHits.java");
        // 目录判据必须是完整路径段
        assertFalse(RagScopeFilter.isTest("src/main/contest/Foo.java"), "contest/ 不是 test/");
        assertFalse(RagScopeFilter.isTest("src/main/latest/Foo.java"), "latest/ 不是 test/");
        assertFalse(RagScopeFilter.isTest("docs/protest.md"), "protest.md");
        // .test 出现在中间但后缀不对
        assertFalse(RagScopeFilter.isTest("src/a.test.java"), "Java 走的是 *Test.java 那条,不是 .test.");
    }

    // ---- 文档判据 ----

    @Test
    @DisplayName("文档:.md 后缀 或 docs/ 路径段")
    void docs() {
        assertTrue(RagScopeFilter.isDoc("README.md"));
        assertTrue(RagScopeFilter.isDoc("docs/superpowers/specs/x-design.md"));
        assertTrue(RagScopeFilter.isDoc("docs/windows-usage.md"));
        assertFalse(RagScopeFilter.isDoc("src/main/java/Foo.java"));
    }

    @Test
    @DisplayName("**例外:resources/skills 下的 .md 不是文档,是运行时载荷**")
    void skillMarkdownIsNotDocumentation() {
        // SKILL.md 是技能定义,site-patterns/*.md 是 web_fetch 的站点规则。
        // 当文档排掉,就是把一部分产品行为从索引里挖走 —— 真实索引里这类 md 有 129 块。
        assertFalse(RagScopeFilter.isDoc("src/main/resources/skills/web-access/SKILL.md"));
        assertFalse(RagScopeFilter.isDoc(
                "src/main/resources/skills/web-access/references/site-patterns/zhuanlan.zhihu.com.md"));
        assertFalse(RagScopeFilter.isDoc("src/main/resources/skills/pptx/references/unicode.md"));
    }

    @Test
    @DisplayName("docs/ 必须是完整路径段 —— mydocs/ 不算")
    void docsMustBeAPathSegment() {
        assertFalse(RagScopeFilter.isDoc("src/mydocs.java"));
        assertTrue(RagScopeFilter.isDoc("a/docs/b.txt"), "docs/ 段命中(与后缀无关)");
    }

    // ---- 组合 ----

    @Test
    @DisplayName("两个开关都关时什么都不排 —— 默认行为不变")
    void bothSwitchesOffExcludesNothing() {
        for (String p : new String[]{"src/test/java/FooTest.java", "README.md", "src/main/java/Foo.java"}) {
            assertFalse(RagScopeFilter.excluded(p, false, false), p);
        }
    }

    @Test
    @DisplayName("开关各自只管自己那一类")
    void switchesAreIndependent() {
        assertTrue(RagScopeFilter.excluded("src/test/java/FooTest.java", true, false));
        assertFalse(RagScopeFilter.excluded("README.md", true, false), "只开排除测试时文档要留下");
        assertTrue(RagScopeFilter.excluded("README.md", false, true));
        assertFalse(RagScopeFilter.excluded("src/test/java/FooTest.java", false, true),
                "只开排除文档时测试要留下");
    }

    @Test
    @DisplayName("既是测试又是文档(测试目录下的 .md 夹具):任一开关打开都会被排除")
    void dualMatchIsExcludedByEitherSwitch() {
        // src/test/ 命中测试判据,.md 命中文档判据 —— 两条都成立
        String dual = "src/test/resources/fixtures/sample.md";
        assertTrue(RagScopeFilter.isTest(dual), "在 src/test/ 下");
        assertTrue(RagScopeFilter.isDoc(dual), ".md 后缀");
        assertTrue(RagScopeFilter.excluded(dual, true, false), "只开排除测试也该排掉");
        assertTrue(RagScopeFilter.excluded(dual, false, true), "只开排除文档也该排掉");
    }

    @Test
    @DisplayName("`.test.md` 不是测试 —— 测试判据只覆盖 ts/js 系的 .test./.spec. 后缀")
    void dotTestMarkdownIsJustADoc() {
        assertFalse(RagScopeFilter.isTest("docs/foo.test.md"));
        assertTrue(RagScopeFilter.isDoc("docs/foo.test.md"));
    }

    @Test
    @DisplayName("Windows 反斜杠路径同样识别 —— 用户在 Windows 上跑")
    void windowsSeparators() {
        assertTrue(RagScopeFilter.isTest("src\\test\\java\\com\\FooTest.java"));
        assertTrue(RagScopeFilter.isTest("desktop\\test\\foo.ts"));
        assertTrue(RagScopeFilter.isDoc("docs\\windows-usage.md"));
        assertFalse(RagScopeFilter.isDoc("src\\main\\resources\\skills\\web-access\\SKILL.md"));
    }

    @Test
    @DisplayName("null / 空路径不许抛 —— 过滤层崩了会让整次索引失败")
    void nullSafe() {
        assertFalse(RagScopeFilter.isTest(null));
        assertFalse(RagScopeFilter.isDoc(null));
        assertFalse(RagScopeFilter.isTest(""));
        assertFalse(RagScopeFilter.excluded(null, true, true));
    }
}
