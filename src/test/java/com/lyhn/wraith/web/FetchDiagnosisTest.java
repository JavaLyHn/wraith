package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 回包的诚实性。
 *
 * <p><b>为什么需要这一层</b>：用户让 agent 抓 GitHub，抓取 HTTP 200 成功，
 * 但提取出来的是一小坨导航壳。回包对此<b>一个字都没说</b>，模型于是自己编了个因果，
 * 对用户讲「网页抓取不了 GitHub」—— 一句错误的事实陈述。
 *
 * <p>提取器本身的过度删除已在 {@code HtmlExtractorNoiseGuardTest} 修掉。这一层管的是
 * <b>剩下的真·JS 页面</b>：那时回包必须自己说清「抓取成功、但正文没提到」，
 * 并明确禁止「这个站点抓不了」这种推论，同时给出可行的下一步。
 *
 * <p>约定：这里只报<b>已知的事实</b>（HTTP 成功、两个字数、URL 形状），不猜页面质量。
 */
class FetchDiagnosisTest {

    @Test
    @DisplayName("正文极少而原始 HTML 很大:必须说抓取成功,并挡掉「这个站点抓不了」的推论")
    void thinExtractionSaysFetchSucceeded() {
        String advice = FetchDiagnosis.advise("https://example.com/spa", 120, 640_000);
        assertFalse(advice.isBlank(), "该给提示");
        assertTrue(advice.contains("成功"), "必须点明抓取本身成功,否则模型会说成失败: " + advice);
        assertTrue(advice.contains("640000") || advice.contains("640,000"),
                "该带上原始 HTML 字节数作证据: " + advice);
        assertTrue(advice.contains("120"), "该带上实际提取到的字数: " + advice);
        assertTrue(advice.contains("不要") && advice.contains("抓不了"),
                "必须显式禁止「这个站点抓不了」这种推论: " + advice);
    }

    @Test
    @DisplayName("正文正常时不啰嗦:非 GitHub 的普通页面一个字都不加")
    void normalExtractionGetsNoAdvice() {
        assertEquals("", FetchDiagnosis.advise("https://example.com/post/1", 9_892, 224_646));
    }

    @Test
    @DisplayName("原始 HTML 本来就很小(比如一个纯文本接口),正文少也不该报警")
    void smallHtmlIsNotSuspicious() {
        assertEquals("", FetchDiagnosis.advise("https://example.com/api/ping", 40, 300));
    }

    @Test
    @DisplayName("空正文不重复报警:那句「未提取到正文」已由 FetchResult 的 hint 说了")
    void emptyMarkdownLeavesTheEmptyHintAlone() {
        String advice = FetchDiagnosis.advise("https://example.com/spa", 0, 640_000);
        assertFalse(advice.contains("成功"), "空正文的话术归 FetchResult.hint,这里别插一脚: " + advice);
    }

    @Test
    @DisplayName("/blob/ 的重写是纯机械的:整段照搬到 raw.githubusercontent.com,分支名带 / 也不会错")
    void blobRewriteIsMechanicalAndBranchSlashSafe() {
        String advice = FetchDiagnosis.advise(
                "https://github.com/JavaLyHn/wraith/blob/feat/windows-parity-block1/README.md", 37_126, 609_434);
        assertTrue(advice.contains(
                        "https://raw.githubusercontent.com/JavaLyHn/wraith/feat/windows-parity-block1/README.md"),
                "/blob/ 之后的整段原样搬过去即可,不需要切分 ref 与路径: " + advice);
    }

    @Test
    @DisplayName("/tree/ 不装作能切分 ref 与路径:分支名可能含 /,只给出端点形状 + 已知的 owner/repo")
    void treeAdviceDoesNotFakeParsing() {
        String advice = FetchDiagnosis.advise(
                "https://github.com/JavaLyHn/wraith/tree/feat/windows-parity-block1", 53_321, 642_060);
        assertTrue(advice.contains("api.github.com/repos/JavaLyHn/wraith/contents"),
                "owner/repo 是能确定的,该填实: " + advice);
        assertFalse(advice.contains("contents/feat/windows-parity-block1"),
                "不能把分支名当成目录路径拼进去 —— 那是猜的: " + advice);
    }

    @Test
    @DisplayName("GitHub 页面即使正文正常也给纯文本入口 —— 读文件内容 raw 永远更好")
    void githubRouteIsAdvisedEvenWhenContentLooksFine() {
        String advice = FetchDiagnosis.advise(
                "https://github.com/o/r/blob/main/pom.xml", 37_126, 609_434);
        assertTrue(advice.contains("raw.githubusercontent.com/o/r/main/pom.xml"), advice);
        assertFalse(advice.contains("成功"), "正文正常,不该报「抓取成功但没提到正文」: " + advice);
    }

    @Test
    @DisplayName("非 GitHub 的 host 不给路线建议;github.io 之类的近似域名也不算")
    void nonGithubHostsGetNoRoute() {
        assertEquals("", FetchDiagnosis.advise("https://gitlab.com/o/r/blob/main/x", 9_000, 200_000));
        assertEquals("", FetchDiagnosis.advise("https://javalyhn.github.io/wraith/", 9_000, 200_000));
        assertEquals("", FetchDiagnosis.advise("https://notgithub.com/o/r/blob/main/x", 9_000, 200_000));
    }

    @Test
    @DisplayName("www.github.com 与 GitHub.Com 都算 GitHub")
    void hostMatchIsCaseInsensitiveAndAllowsWww() {
        assertTrue(FetchDiagnosis.advise("https://WWW.GitHub.Com/o/r/blob/main/x", 9_000, 200_000)
                .contains("raw.githubusercontent.com/o/r/main/x"));
    }

    @Test
    @DisplayName("坏 URL 不许抛异常:诊断层崩了会把一次成功的抓取变成「抓取失败」")
    void malformedUrlIsSwallowed() {
        assertEquals("", FetchDiagnosis.advise("not a url at all", 9_000, 200_000));
        assertEquals("", FetchDiagnosis.advise(null, 9_000, 200_000));
        assertEquals("", FetchDiagnosis.advise("", 9_000, 200_000));
    }

    @Test
    @DisplayName("GitHub 仓库首页 / 非 blob-tree 路径不给路线:raw 换算不成立")
    void githubNonFilePathsGetNoRoute() {
        assertEquals("", FetchDiagnosis.advise("https://github.com/JavaLyHn/wraith", 9_000, 200_000));
        assertEquals("", FetchDiagnosis.advise("https://github.com/JavaLyHn/wraith/issues/1", 9_000, 200_000));
    }
}
