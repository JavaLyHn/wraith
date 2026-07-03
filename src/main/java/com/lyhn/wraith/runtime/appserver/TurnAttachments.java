package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 纯函数：解析 turn.submit 中的 attachments 参数，校验上限，
 * 生成文本注入前缀和图片 ContentPart 列表。
 */
public final class TurnAttachments {

    /** 单个文本文件最大尺寸：512 KB */
    static final long TEXT_MAX = 512L * 1024;
    /** 单轮附件总量最大尺寸：2 MB */
    static final long TOTAL_MAX = 2L * 1024 * 1024;
    /** 单张图片最大尺寸：4 MB */
    static final long IMAGE_MAX = 4L * 1024 * 1024;

    /** 合法图片扩展 → MIME 映射 */
    private static final Map<String, String> IMAGE_MIME = Map.of(
            "png",  "image/png",
            "jpg",  "image/jpeg",
            "jpeg", "image/jpeg",
            "gif",  "image/gif",
            "webp", "image/webp"
    );

    private TurnAttachments() {}

    /**
     * 解析结果：文本注入前缀、图片 parts、图片文件名列表。
     */
    public record Resolved(
            String textPrefix,
            List<LlmClient.ContentPart> imageParts,
            List<String> imageNames
    ) {}

    /**
     * 解析并校验 attachments 节点。
     *
     * @param attachmentsOrNull turn.submit params 中的 "attachments" 节点（可为 null）
     * @return Resolved 结果
     * @throws IOException 校验失败，含友好中文文案和文件名
     */
    public static Resolved resolve(JsonNode attachmentsOrNull) throws IOException {
        if (attachmentsOrNull == null || attachmentsOrNull.isNull()
                || !attachmentsOrNull.isArray() || attachmentsOrNull.size() == 0) {
            return new Resolved("", List.of(), List.of());
        }

        StringBuilder textPrefix = new StringBuilder();
        List<LlmClient.ContentPart> imageParts = new ArrayList<>();
        List<String> imageNames = new ArrayList<>();
        long totalBytes = 0;

        for (JsonNode item : attachmentsOrNull) {
            String pathStr = item.path("path").asText(null);
            String kind    = item.path("kind").asText(null);

            // kind 合法性校验
            if (!"image".equals(kind) && !"text".equals(kind)) {
                throw new IOException("附件 kind 非法（必须为 image 或 text）: " + kind);
            }

            // 路径非空
            if (pathStr == null || pathStr.isBlank()) {
                throw new IOException("附件路径为空");
            }

            Path p = Path.of(pathStr);
            String fileName = p.getFileName() != null ? p.getFileName().toString() : pathStr;

            // 路径存在、是普通文件、可读
            if (!Files.exists(p)) {
                throw new IOException("附件文件不存在: " + fileName);
            }
            if (!Files.isRegularFile(p)) {
                throw new IOException("附件路径不是普通文件: " + fileName);
            }
            if (!Files.isReadable(p)) {
                throw new IOException("附件文件不可读: " + fileName);
            }

            long size = Files.size(p);

            if ("text".equals(kind)) {
                // 文本单文件 ≤ 512 KB
                if (size > TEXT_MAX) {
                    throw new IOException("文本附件超出 512 KB 上限: " + fileName
                            + "（" + size + " 字节）");
                }
                totalBytes += size;
                if (totalBytes > TOTAL_MAX) {
                    throw new IOException("单轮附件总量超出 2 MB 上限，在文件: " + fileName);
                }
                String content = Files.readString(p, StandardCharsets.UTF_8);
                textPrefix.append("```").append(fileName).append("\n")
                          .append(content).append("\n```\n\n");

            } else { // image
                // kind=image 但扩展不在映射内 → 抛
                String ext = extension(fileName).toLowerCase(Locale.ROOT);
                String mime = IMAGE_MIME.get(ext);
                if (mime == null) {
                    throw new IOException("图片附件扩展名不支持（支持 png/jpg/jpeg/gif/webp）: " + fileName);
                }
                // 图片单张 ≤ 4 MB
                if (size > IMAGE_MAX) {
                    throw new IOException("图片附件超出 4 MB 上限: " + fileName
                            + "（" + size + " 字节）");
                }
                totalBytes += size;
                if (totalBytes > TOTAL_MAX) {
                    throw new IOException("单轮附件总量超出 2 MB 上限，在文件: " + fileName);
                }
                byte[] bytes = Files.readAllBytes(p);
                String b64 = Base64.getEncoder().encodeToString(bytes);
                imageParts.add(LlmClient.ContentPart.imageBase64(b64, mime));
                imageNames.add(fileName);
            }
        }

        return new Resolved(textPrefix.toString(), List.copyOf(imageParts), List.copyOf(imageNames));
    }

    /** 提取文件扩展名（不含点），无扩展返回空串。 */
    private static String extension(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return (dot >= 0 && dot < fileName.length() - 1) ? fileName.substring(dot + 1) : "";
    }
}
