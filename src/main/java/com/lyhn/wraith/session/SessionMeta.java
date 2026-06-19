package com.lyhn.wraith.session;

/**
 * 一个持久化会话的元信息(JSONL 文件首行)。
 *
 * @param id        会话 ID(yyyyMMdd-HHmmss-xxxx,可排序)
 * @param cwd       会话所属项目目录(绝对路径)
 * @param createdAt 创建时间(ISO-8601)
 * @param updatedAt 最近一次写入时间(ISO-8601)
 * @param provider  模型 provider
 * @param model     模型名
 * @param title     首条用户消息摘要(列表展示用)
 * @param turns     用户轮数
 */
public record SessionMeta(
        String id,
        String cwd,
        String createdAt,
        String updatedAt,
        String provider,
        String model,
        String title,
        int turns) {
}
