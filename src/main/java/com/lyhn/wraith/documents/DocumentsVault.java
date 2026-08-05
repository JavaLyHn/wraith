package com.lyhn.wraith.documents;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 「文档资料库」的服务端读侧：{@code ~/.wraith/documents/}。
 *
 * <p><b>为什么要有这个类：</b>资料库本来就是「跨项目的知识存放处」，可在此之前只有桌面 UI 读得到，
 * agent 读不到 —— {@code read_file} 被 {@code PathGuard(projectPath)} 锁在当前项目内，
 * 而资料库不属于任何项目。于是「把资料放进库里，让 agent 在任何项目引用」这件事做不到。
 *
 * <p><b>为什么不能用 execute_command + cat 绕：</b>那条路两个平台行为不一致。macOS 的 Seatbelt
 * profile 打底是 {@code (allow default)}，只收紧写与网络，读得到库；Windows 的 AppContainer 是
 * 能力制、默认全拒，只显式授予了 workspace 一个目录，读不到。跨平台方案只能走进程内。
 *
 * <p><b>目录即真相：</b>与桌面侧一致，不建索引文件，列表由 readdir + stat 现算。
 * 两边共用同一个目录约定，所以不存在「索引与磁盘不一致」这类问题。
 *
 * <p><b>安全边界：</b>只读；名字必须是纯文件名（不含分隔符、不含 {@code ..}）；
 * 解析后再校验真实路径的父目录确实是库根（软链逃逸防线，与桌面侧 lstat 跳过软链同源）。
 */
public final class DocumentsVault {

    /** 单个文档读取上限：超过就截断并在末尾说明，避免把一整本书塞进上下文。 */
    static final int MAX_READ_BYTES = 256 * 1024;

    private DocumentsVault() { /* utility */ }

    /**
     * 库根目录。沿用 {@code wraith.config.dir} 这一个重定向开关（与 WraithConfig 同源），
     * 测试因此可以整体重定向 {@code ~/.wraith}，不必再发明第二个属性。
     */
    public static Path dir() {
        String override = System.getProperty("wraith.config.dir");
        Path base = (override == null || override.isBlank())
                ? Path.of(System.getProperty("user.home"), ".wraith")
                : Path.of(override);
        return base.resolve("documents");
    }

    /** 库里的一份文档。{@code size} 为字节数，{@code modifiedAt} 为毫秒时间戳。 */
    public record Entry(String name, long size, long modifiedAt) {}

    /**
     * 列出库内文档，按修改时间倒序（最新的在前 —— 日报这类按天生成的东西，最新那份最常被问到）。
     *
     * <p>目录不存在不是错误，等价于「库是空的」：首次使用时目录本来就还没建。
     */
    public static List<Entry> list() {
        Path dir = dir();
        List<Entry> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (var stream = Files.list(dir)) {
            for (Path p : stream.toList()) {
                // 软链一律跳过：与桌面侧同一条规矩 —— 「库内软链指向库外文件」不该被当成库内文档列出。
                if (Files.isSymbolicLink(p)) continue;
                if (!Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)) continue;
                String name = p.getFileName().toString();
                if (name.startsWith(".")) continue;   // .DS_Store 之类不是用户放进来的文档
                out.add(new Entry(name, Files.size(p), Files.getLastModifiedTime(p).toMillis()));
            }
        } catch (IOException e) {
            return out;   // 读不了目录 = 当作空库；调用方会渲染成「库里还没有文档」
        }
        out.sort(Comparator.comparingLong(Entry::modifiedAt).reversed());
        return out;
    }

    /**
     * 把文件名解析成库内的绝对路径。
     *
     * @throws IllegalArgumentException 名字为空、含路径分隔符、含 {@code ..}、是绝对路径，
     *                                  或解析后落在库外（软链逃逸）
     */
    public static Path resolveInVault(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("文档名不能为空");
        }
        String trimmed = name.trim();
        if (trimmed.contains("/") || trimmed.contains("\\") || trimmed.contains("..")
                || Path.of(trimmed).isAbsolute()) {
            throw new IllegalArgumentException(
                    "只接受文档名，不接受路径：" + trimmed + "（资料库是平铺的，没有子目录）");
        }
        Path dir = dir();
        Path target = dir.resolve(trimmed).normalize();
        // 纵深防御：normalize 之后再确认父目录仍是库根。单靠上面的字符串检查在
        // 平台差异（比如 Windows 的备用分隔符）面前不够硬。
        if (!dir.normalize().equals(target.getParent())) {
            throw new IllegalArgumentException("路径越界：" + trimmed + " 不在资料库内");
        }
        return target;
    }

    /**
     * 读一份文档。超过 {@link #MAX_READ_BYTES} 时截断，并在末尾追加一行说明 ——
     * 静默截断会让模型基于半份内容下结论，比明说更危险。
     *
     * @throws IllegalArgumentException 名字非法（见 {@link #resolveInVault}）
     * @throws java.io.FileNotFoundException 库内没有这份文档
     */
    public static String read(String name) throws IOException {
        Path p = resolveInVault(name);
        if (Files.isSymbolicLink(p) || !Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)) {
            throw new java.io.FileNotFoundException("资料库里没有这份文档：" + name);
        }
        long size = Files.size(p);
        if (size <= MAX_READ_BYTES) {
            return Files.readString(p, StandardCharsets.UTF_8);
        }
        byte[] head = new byte[MAX_READ_BYTES];
        try (var in = Files.newInputStream(p)) {
            int n = in.readNBytes(head, 0, MAX_READ_BYTES);
            return new String(head, 0, n, StandardCharsets.UTF_8)
                    + "\n\n[...已截断:该文档 " + size + " 字节,只读了前 " + MAX_READ_BYTES + " 字节]";
        }
    }
}
