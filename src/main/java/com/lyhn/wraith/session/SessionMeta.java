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
 * @param starred   用户标记的重点会话
 * @param name      用户自定义名;显示优先于 title
 * @param origin    会话来源:null/"user"=交互式(默认);"automation"=定时任务无头运行
 *                  (后者从 {@code list()} 过滤,不进主对话侧栏,但仍可按 id resume/peek)
 */
public record SessionMeta(
        String id,
        String cwd,
        String createdAt,
        String updatedAt,
        String provider,
        String model,
        String title,
        int turns,
        boolean starred,
        String name,
        String origin) {
}
