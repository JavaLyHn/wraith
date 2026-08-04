package com.lyhn.wraith.rag;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 索引范围过滤：判定一个文件是「测试」还是「文档」，供 {@link CodeIndex} 按开关排除。
 *
 * <p><b>为什么有这个开关</b>：实测 wraith 自身索引的构成是 Java 主代码 35.4%、
 * <b>Java 测试 33.0%</b>、<b>docs 文档 20.8%</b>、桌面源码 7.0%、桌面测试 2.9% ——
 * 一半以上是测试和文档。测试块特别容易压住主代码：这个仓库的测试名本身就在描述被测行为
 * （{@code void thinExtractionSaysFetchSucceeded()}），语义上与「这功能怎么实现的」高度相似。
 *
 * <p><b>两个开关的效果方向相反，这是量出来的</b>（24 条冻结查询集，{@code scripts/rag-eval/}）：
 * <pre>
 *   基线(全索引)     MRR 0.2693   R@10 54.2%
 *   排除测试         MRR 0.3337   R@10 66.7%   好 10 / 差 1   ← +24%
 *   排除文档         MRR 0.2035   R@10 41.7%   好  1 / 差 4   ← −24%
 *   两者都排除        MRR 0.2943   R@10 66.7%   好 12 / 差 3
 * </pre>
 * 所以两个开关<b>必须分开</b>（合并会把 +24% 拖成 +9%）。「排除文档」保留下来是为了
 * 「我就是不想索引文档」（省磁盘 / 省索引时间）这个诉求，<b>不是</b>为了提升检索质量 ——
 * 「为什么这么设计」这类问题的答案只在 {@code docs/} 里。
 *
 * <p><b>判据只用可枚举的路径 / 文件名规则，不用启发式</b>（比如「assert 密度高就算测试」）：
 * 启发式会产生「为什么我这个文件没被索引」这类用户无法自查的问题。规则必须是读一眼就能预测的。
 */
public final class RagScopeFilter {

    private RagScopeFilter() {}

    /** 路径段化的目录判据：{@code /test/} 命中而 {@code /contest/} 不命中。 */
    private static final Pattern TEST_DIR = Pattern.compile(
            "(^|/)(src/test|src/it|test|tests|__tests__)/");

    /** Surefire / Failsafe 的默认扫描模式 + vitest / jest + pytest / go test。 */
    private static final Pattern TEST_FILE = Pattern.compile(
            "(^|/)[^/]*(Test|Tests|IT)\\.java$"
                    + "|\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$"
                    + "|(^|/)test_[^/]*\\.py$"
                    + "|_test\\.(py|go)$");

    private static final Pattern DOC_ANY = Pattern.compile("\\.md$|(^|/)docs/");

    /**
     * 例外：{@code resources/skills/**} 下的 {@code .md} <b>不是文档，是运行时载荷</b>。
     *
     * <p>{@code SKILL.md} 是技能定义，{@code references/site-patterns/*.md} 是 {@code web_fetch}
     * 的站点规则。当文档排掉，就是把一部分产品行为从索引里挖走 —— 真实索引里这类 md 有 129 块。
     */
    private static final Pattern SKILL_PAYLOAD = Pattern.compile("(^|/)resources/skills/");

    /** 反斜杠归一成正斜杠：判据要在 Windows 上同样成立。 */
    private static String norm(String path) {
        return path == null ? null : path.replace('\\', '/');
    }

    /** 是不是测试文件。{@code null} / 空串一律 false（过滤层崩了会让整次索引失败）。 */
    public static boolean isTest(String path) {
        String p = norm(path);
        if (p == null || p.isEmpty()) {
            return false;
        }
        return TEST_DIR.matcher(p).find() || TEST_FILE.matcher(p).find();
    }

    /** 是不是文档。{@code resources/skills/} 下的 md 不算 —— 见 {@link #SKILL_PAYLOAD}。 */
    public static boolean isDoc(String path) {
        String p = norm(path);
        if (p == null || p.isEmpty()) {
            return false;
        }
        if (SKILL_PAYLOAD.matcher(p).find()) {
            return false;
        }
        return DOC_ANY.matcher(p).find();
    }

    /** 按两个开关决定是否排除。两个都关时恒为 false —— 默认行为不变。 */
    public static boolean excluded(String path, boolean excludeTests, boolean excludeDocs) {
        if (excludeTests && isTest(path)) {
            return true;
        }
        return excludeDocs && isDoc(path);
    }

    /**
     * 「索引是在不同范围设置下建的」提示。返回 {@code null} = 不必提示。
     *
     * <p><b>这是这个特性最容易漏的一环</b>：范围变了但 embedding 模型没变时，已有的两处
     * 陈旧检测（{@code ragView.staleIndexWarning} 与 {@link EmbeddingProbe#compatibilityWarning}）
     * 都不会响 —— 它们比的是模型和维度。用户打开开关却没重建，索引里测试还在、检索照样返回测试，
     * 而界面一个字都不说。这是本仓库第 9 次 snapshot-vs-live，只不过陈旧的是「范围」不是「模型」。
     *
     * <p>判据与模型比较同一条纪律：<b>任一侧未知就不比较</b>。老索引没记过范围
     * （{@code index_meta} 的这两列是后加的）时不提示 —— 宁可漏报，也不要对着一份
     * 可能没问题的索引喊「快重建」。
     */
    public static String scopeMismatchWarning(VectorStore.IndexMeta meta,
                                              boolean excludeTests, boolean excludeDocs) {
        if (meta == null) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        if (meta.excludeTests() != null && meta.excludeTests() != excludeTests) {
            sb.append(excludeTests
                    ? "当前设置要排除测试，但这份索引里含测试"
                    : "当前设置要包含测试，但这份索引建时排除了测试");
        }
        if (meta.excludeDocs() != null && meta.excludeDocs() != excludeDocs) {
            if (sb.length() > 0) {
                sb.append("；");
            }
            sb.append(excludeDocs
                    ? "当前设置要排除文档，但这份索引里含文档"
                    : "当前设置要包含文档，但这份索引建时排除了文档");
        }
        if (sb.length() == 0) {
            return null;
        }
        return sb + "。检索结果会与设置不符 —— 请点「重建索引」。";
    }

    /** 给回包 / 日志用的一句人话，说明当前范围。 */
    public static String describe(boolean excludeTests, boolean excludeDocs) {
        if (!excludeTests && !excludeDocs) {
            return "全部文件";
        }
        if (excludeTests && excludeDocs) {
            return "排除测试与文档";
        }
        return excludeTests ? "排除测试" : "排除文档";
    }

    /** 仅为对齐日志里的大小写风格保留（provider 名等处的惯例）。 */
    static String lower(String s) {
        return s == null ? null : s.toLowerCase(Locale.ROOT);
    }
}
