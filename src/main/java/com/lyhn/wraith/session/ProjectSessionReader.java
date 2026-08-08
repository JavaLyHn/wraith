package com.lyhn.wraith.session;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 只读地查看<strong>任意项目</strong>的会话,不触碰活跃 {@link SessionStore}。
 *
 * <p>存在理由:会话按项目分目录({@code ~/.wraith/sessions/<hash>/}),而活跃 store 绑死在当前项目上。
 * 「项目面板展开看某项目的会话」「设置里跨项目列归档」这两件事都需要越过当前项目去读。
 *
 * <p>为什么不做成 {@code SessionStore} 的静态方法:{@code SessionStore} 是<strong>有状态的活跃会话游标</strong>
 * (持有 currentId / starred / archivedAt 内存态),这里全是无状态只读查询。混在一起会让调用方
 * 误以为这些方法会动活跃会话。
 *
 * <p>安全性:{@link SessionStore#open} 只拼路径不建目录,{@code list()} 在目录缺失时回空表。
 * 所以对「加进列表但从没跑过」的项目调用本类是安全的,不会在磁盘上留下空目录。
 */
public final class ProjectSessionReader {

    private ProjectSessionReader() {
    }

    /**
     * 一个项目的会话概况。
     *
     * @param path          项目绝对路径(与入参原样回传,便于前端对齐)
     * @param sessionCount  未归档会话数
     * @param lastSessionAt 最新未归档会话的 updatedAt(ISO-8601);无会话时 null
     */
    public record Summary(String path, int sessionCount, String lastSessionAt) {
    }

    /** 批量汇总。返回顺序与 paths 一致(前端按下标对齐,不做二次查找)。 */
    public static List<Summary> summaries(Path home, List<String> paths) {
        List<Summary> out = new ArrayList<>();
        if (paths == null) {
            return out;
        }
        for (String p : paths) {
            List<SessionMeta> metas = storeFor(home, p).list(0);
            // list() 已按 updatedAt 倒序,首条即最新
            String last = metas.isEmpty() ? null : metas.get(0).updatedAt();
            out.add(new Summary(p, metas.size(), last));
        }
        return out;
    }

    /** 某项目最近的未归档会话(最近在前)。limit&lt;=0 返回全部。 */
    public static List<SessionMeta> recent(Path home, String path, int limit) {
        return storeFor(home, path).list(limit);
    }

    /** 跨项目的已归档会话,合并后按 archivedAt 倒序。limit&lt;=0 返回全部。 */
    public static List<SessionMeta> archived(Path home, List<String> paths, int limit) {
        List<SessionMeta> all = new ArrayList<>();
        if (paths == null) {
            return all;
        }
        for (String p : paths) {
            all.addAll(storeFor(home, p).listArchived(0));
        }
        all.sort(Comparator.comparing(SessionMeta::archivedAt,
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
        if (limit > 0 && all.size() > limit) {
            return new ArrayList<>(all.subList(0, limit));
        }
        return all;
    }

    /** 归档某项目下全部未归档会话,返回条数。 */
    public static int archiveAll(Path home, String path) {
        return storeFor(home, path).archiveAll();
    }

    /** 只读用的 store:provider/model 传空 —— 本类只读不写,这两个字段不会落盘。 */
    private static SessionStore storeFor(Path home, String path) {
        return SessionStore.open(home, path, "", "");
    }
}
