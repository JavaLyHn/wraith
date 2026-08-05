package com.lyhn.wraith.skill;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;

/**
 * 把 jar 内 resources/skills/&lt;name&gt;/ 解压到 ~/.wraith/skills-cache/&lt;name&gt;/。
 *
 * 解压策略：通过 .version 文件标记当前 jar 内置版本。版本一致跳过；不一致或缺失则覆盖整个目录。
 *
 * 内置 skill 文件清单为硬编码（避免 jar 内 resource walk 的跨平台问题），
 * 当前覆盖：web-access + 16 个流程/方法论/领域技能(brainstorming / writing-plans /
 * systematic-debugging / test-driven-development / verification-before-completion /
 * receiving-code-review / requesting-code-review / mcp-builder / skill-creator /
 * github-ai-daily / code-refactoring / git-workflow / typescript-patterns /
 * performance-optimization / documentation-writing / security-review),
 * 以及 6 个改写自 Matt Pocock skills 的设计/决策技能(codebase-design / domain-modeling /
 * prototype / grilling / research / handoff),
 * obra/superpowers(MIT) & anthropics/skills 部分完整搬运中文翻译; Matt Pocock skills(MIT) 6 个改写适配,
 * 其余为 Wraith 原创；非功能基建脚本/文档原样保留并注明 wraith 不运行。
 */
public final class SkillBuiltinExtractor {

    /** 内置 skill 内容有破坏性更新(含新增)时上调，触发缓存重建。 */
    public static final String CURRENT_VERSION = "1.5.0";

    private static final List<BuiltinSkillSpec> BUILTIN_SKILLS = List.of(
            new BuiltinSkillSpec("web-access", List.of(
                    "SKILL.md",
                    "references/cdp-cheatsheet.md",
                    "references/site-patterns/github.com.md",
                    "references/site-patterns/juejin.cn.md",
                    "references/site-patterns/mp.weixin.qq.com.md",
                    "references/site-patterns/x.com.md",
                    "references/site-patterns/xiaohongshu.com.md",
                    "references/site-patterns/zhuanlan.zhihu.com.md"
            )),
            // 流程/方法论类内置技能(完整搬运自 obra/superpowers & anthropics/skills,
            // 方法论文档译中文、非功能基建脚本/文档原样保留并注明不运行)
            new BuiltinSkillSpec("brainstorming", List.of(
                    "SKILL.md",
                    "references/visual-companion.md",
                    "references/spec-document-reviewer-prompt.md",
                    "references/scripts/README-wraith.md",
                    "references/scripts/frame-template.html",
                    "references/scripts/helper.js",
                    "references/scripts/server.cjs",
                    "references/scripts/start-server.sh",
                    "references/scripts/stop-server.sh"
            )),
            new BuiltinSkillSpec("writing-plans", List.of(
                    "SKILL.md",
                    "references/plan-document-reviewer-prompt.md"
            )),
            new BuiltinSkillSpec("systematic-debugging", List.of(
                    "SKILL.md",
                    "references/root-cause-tracing.md",
                    "references/defense-in-depth.md",
                    "references/condition-based-waiting.md",
                    "references/condition-based-waiting-example.ts",
                    "references/find-polluter.sh",
                    "references/feedback-loop.md"
            )),
            new BuiltinSkillSpec("test-driven-development", List.of(
                    "SKILL.md",
                    "references/testing-anti-patterns.md"
            )),
            new BuiltinSkillSpec("github-ai-daily", List.of("SKILL.md")),
            new BuiltinSkillSpec("verification-before-completion", List.of("SKILL.md")),
            new BuiltinSkillSpec("receiving-code-review", List.of("SKILL.md")),
            new BuiltinSkillSpec("requesting-code-review", List.of(
                    "SKILL.md",
                    "references/code-reviewer.md"
            )),
            new BuiltinSkillSpec("mcp-builder", List.of(
                    "SKILL.md",
                    "LICENSE.txt",
                    "references/mcp_best_practices.md",
                    "references/node_mcp_server.md",
                    "references/python_mcp_server.md",
                    "references/evaluation.md",
                    "references/scripts/README-wraith.md",
                    "references/scripts/connections.py",
                    "references/scripts/evaluation.py",
                    "references/scripts/example_evaluation.xml",
                    "references/scripts/requirements.txt"
            )),
            new BuiltinSkillSpec("skill-creator", List.of(
                    "SKILL.md",
                    "LICENSE.txt",
                    "references/schemas.md",
                    "agents/analyzer.md",
                    "agents/comparator.md",
                    "agents/grader.md",
                    "assets/eval_review.html",
                    "eval-viewer/generate_review.py",
                    "eval-viewer/viewer.html",
                    "scripts/README-wraith.md",
                    "scripts/__init__.py",
                    "scripts/aggregate_benchmark.py",
                    "scripts/generate_report.py",
                    "scripts/improve_description.py",
                    "scripts/package_skill.py",
                    "scripts/quick_validate.py",
                    "scripts/run_eval.py",
                    "scripts/run_loop.py",
                    "scripts/utils.py"
            )),
            new BuiltinSkillSpec("code-refactoring", List.of("SKILL.md")),
            new BuiltinSkillSpec("git-workflow", List.of("SKILL.md")),
            new BuiltinSkillSpec("typescript-patterns", List.of("SKILL.md")),
            new BuiltinSkillSpec("performance-optimization", List.of("SKILL.md")),
            new BuiltinSkillSpec("documentation-writing", List.of("SKILL.md")),
            new BuiltinSkillSpec("security-review", List.of("SKILL.md")),
            // 以下 6 个 skill 改写自 Matt Pocock skills(MIT):
            // codebase-design / domain-modeling / prototype / grilling / research / handoff
            // 翻译为中文、适配 Wraith 工具链、去除 issue-tracker/openai-agent 依赖
            new BuiltinSkillSpec("codebase-design", List.of(
                    "SKILL.md",
                    "references/deepening.md",
                    "references/design-it-twice.md"
            )),
            new BuiltinSkillSpec("domain-modeling", List.of(
                    "SKILL.md",
                    "references/adr-format.md",
                    "references/context-format.md"
            )),
            new BuiltinSkillSpec("prototype", List.of(
                    "SKILL.md",
                    "references/logic.md",
                    "references/ui.md"
            )),
            new BuiltinSkillSpec("grilling", List.of("SKILL.md")),
            new BuiltinSkillSpec("research", List.of("SKILL.md")),
            new BuiltinSkillSpec("handoff", List.of("SKILL.md"))
    );

    private final Path cacheRoot;

    public SkillBuiltinExtractor(Path cacheRoot) {
        this.cacheRoot = cacheRoot;
    }

    public Path cacheRoot() {
        return cacheRoot;
    }

    public List<String> builtinSkillNames() {
        return BUILTIN_SKILLS.stream().map(BuiltinSkillSpec::name).toList();
    }

    public Path skillCacheDir(String skillName) {
        return cacheRoot.resolve(skillName);
    }

    public void extractAll() throws IOException {
        Files.createDirectories(cacheRoot);
        for (BuiltinSkillSpec spec : BUILTIN_SKILLS) {
            extract(spec);
        }
    }

    private void extract(BuiltinSkillSpec spec) throws IOException {
        Path skillDir = cacheRoot.resolve(spec.name());
        Path versionFile = skillDir.resolve(".version");
        if (Files.exists(versionFile)) {
            String existing = Files.readString(versionFile).trim();
            if (CURRENT_VERSION.equals(existing)) {
                return;
            }
        }
        if (Files.exists(skillDir)) {
            deleteRecursive(skillDir);
        }
        Files.createDirectories(skillDir);
        for (String relative : spec.files()) {
            String resourcePath = "skills/" + spec.name() + "/" + relative;
            try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
                if (in == null) {
                    System.err.println("⚠️ 内置 skill 资源缺失: " + resourcePath);
                    continue;
                }
                Path target = skillDir.resolve(relative);
                Files.createDirectories(target.getParent());
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        Files.writeString(versionFile, CURRENT_VERSION);
    }

    private static void deleteRecursive(Path dir) throws IOException {
        if (!Files.exists(dir)) return;
        try (var stream = Files.walk(dir)) {
            stream.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {
                        }
                    });
        }
    }

    private record BuiltinSkillSpec(String name, List<String> files) {
    }
}
