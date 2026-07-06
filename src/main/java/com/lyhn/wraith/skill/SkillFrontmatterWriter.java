package com.lyhn.wraith.skill;

import java.util.List;

/**
 * SKILL.md 序列化(镜像 SkillFrontmatterParser 的极简 YAML 子集,不引入 SnakeYAML)。
 *
 * 产物保证能被 SkillFrontmatterParser.parse 读回同样字段:
 * - name    : inline(name 已过目录安全校验,无冒号/引号/特殊字符)
 * - description: 块标量 |,折成单行写在一条 2 空格缩进行上(解析器会折叠空白,round-trip 稳定;
 *                规避前导 [ / { / " / | 与冒号歧义)
 * - version/author: 引号包裹(允许含点/空格/冒号;findKeyColonIndex 跳过引号内冒号)
 * - tags    : 行内数组 [a, b];空则省略字段
 * - body    : 闭合 ---\n 后空一行再原样输出
 *
 * 已知不支持(与解析器一致):字段值含英文双引号、tag 含逗号、description 保留换行。
 */
public final class SkillFrontmatterWriter {

    private SkillFrontmatterWriter() {
    }

    public static String serialize(String name, String description, String version,
                                   String author, List<String> tags, String body) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("name: ").append(name).append('\n');
        String descOneLine = description == null ? "" : description.replaceAll("\\s+", " ").trim();
        sb.append("description: |\n");
        sb.append("  ").append(descOneLine).append('\n');
        if (version != null && !version.isBlank()) {
            sb.append("version: \"").append(version.trim()).append("\"\n");
        }
        if (author != null && !author.isBlank()) {
            sb.append("author: \"").append(author.trim()).append("\"\n");
        }
        List<String> cleanTags = tags == null ? List.of()
                : tags.stream().map(String::trim).filter(t -> !t.isEmpty()).toList();
        if (!cleanTags.isEmpty()) {
            sb.append("tags: [").append(String.join(", ", cleanTags)).append("]\n");
        }
        sb.append("---\n\n");
        sb.append(body == null ? "" : body);
        return sb.toString();
    }
}
