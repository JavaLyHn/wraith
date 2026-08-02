package com.lyhn.wraith.policy;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 命令快速拒绝：在 execute_command 进入 HITL 审批 / 真正调用 ProcessBuilder 之前的黑名单 fast-fail。
 *
 * 定位：辅助 HITL 而非主防线。黑名单是出名的反模式（永远列不全），但能拦住 LLM 容易踩的明显破坏性命令，
 * 减少 HITL 弹窗骚扰。真正的安全责任在 HITL 审批和用户判断。
 *
 * 设计取舍：
 * - 不做完整 shell 解析，只做正则模式匹配，够覆盖明显破坏性命令即可
 * - 命令替换段 $(...) 和反引号内的内容仍以原文存在，正则会一并扫描，不需要单独展开
 * - curl / git / 网络命令默认放行，只拦真正破坏性的（rm -rf 全盘、sudo、mkfs 等）
 */
public final class CommandGuard {

    private static final List<DenyRule> RULES = List.of(
            new DenyRule("禁止 sudo 提权",
                    Pattern.compile("(?i)\\bsudo\\b")),
            // rm 路径黑名单：匹配开头即可拦截，不强求路径结束边界。
            // /、~、/*、$HOME 是常见的"灾难性删除起点"，包括其作为前缀的所有子路径都拦掉，避免 LLM 误删根目录或用户目录。
            new DenyRule("禁止 rm -rf 删除全盘或用户目录",
                    Pattern.compile("(?i)\\brm\\s+-[a-z]*r[a-z]*f[a-z]*\\s+(/|~|\\$home)|" +
                            "\\brm\\s+-[a-z]*f[a-z]*r[a-z]*\\s+(/|~|\\$home)")),
            new DenyRule("禁止 mkfs 格式化磁盘",
                    Pattern.compile("(?i)\\bmkfs(\\.|\\b)")),
            new DenyRule("禁止 dd 写入裸设备",
                    Pattern.compile("(?i)\\bdd\\b[^\\n]*\\bof=/dev/")),
            new DenyRule("识别为 fork bomb",
                    Pattern.compile(":\\(\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:")),
            new DenyRule("禁止 curl / wget 管道直接执行远端脚本",
                    Pattern.compile("(?i)\\b(curl|wget)\\b[^|\\n]*\\|\\s*(sh|bash|zsh|fish|ksh)\\b")),
            // 只拦"扫全盘/家目录本身"(路径正好是 / ~ $HOME,后接空白或行尾);
            // 放行 `find /tmp/具体目录`、`find ~/子目录` 这类有界扫描——否则任何以 / 开头的
            // 绝对路径都会被前缀误杀(如 `find /tmp/x`),把合法操作也拦下。
            new DenyRule("不允许扫描 /、~ 或整个文件系统",
                    Pattern.compile("(?i)\\bfind\\s+(/|~|\\$home)(\\s|$)")),
            new DenyRule("禁止 chmod 777 全盘",
                    Pattern.compile("(?i)\\bchmod\\s+-R\\s+777\\s+(/|~)")),
            new DenyRule("禁止 shutdown / reboot / halt",
                    Pattern.compile("(?i)\\b(shutdown|reboot|halt|poweroff)\\b")),

            // ── 以下为 Windows / PowerShell 形状 ──────────────────────────────
            //
            // 为什么要补：上面九条全是 POSIX 词汇。Windows 上真正能拆家的命令
            // (rd /s /q C:\、format、diskpart、reg delete …) 此前一条都不拦，
            // 而无沙箱时给用户看的文案偏偏是「仍受命令黑名单保护」——
            // 在 Windows 上那句话基本是空的。
            //
            // 不按平台分开判：命令文本里出现 `format C:` 在 mac 上也没有放行的理由，
            // 而且按平台分叉会让「这条规则在哪儿生效」变成一件要推理的事。

            // rd / rmdir / del 打向盘符根或用户目录。盘符根写法很多：C:\ C:\* C:/ %SystemDrive%
            new DenyRule("禁止 rd/rmdir/del 递归删除盘符根或用户目录",
                    Pattern.compile("(?i)\\b(rd|rmdir|del|erase)\\b[^\\n]*?\\s"
                            + "([a-z]:[\\\\/]?(\\*|\\s|$)|%systemdrive%|%userprofile%|%homepath%)")),

            // PowerShell 的等价物。Remove-Item 别名极多：ri / rm / rmdir / del / erase / rd
            new DenyRule("禁止 PowerShell 递归强删盘符根或用户目录",
                    Pattern.compile("(?i)\\bremove-item\\b[^\\n]*?"
                            + "([a-z]:[\\\\/]?(\\*|['\"]|\\s|$)|\\$env:userprofile|\\$home)")),

            // 拆两条而不是一个 alternation:`format C:` 以 `:` 收尾,
            // 后面接空格时尾部 `\b` 不成立(两侧都是非词字符),整条规则会静默失效。
            new DenyRule("禁止格式化磁盘",
                    Pattern.compile("(?i)\\bformat\\s+[a-z]:")),
            new DenyRule("禁止格式化磁盘 / 操作分区",
                    Pattern.compile("(?i)\\b(diskpart|format-volume)\\b")),

            new DenyRule("禁止删除注册表项",
                    Pattern.compile("(?i)\\breg\\s+delete\\b|\\bremove-item(property)?\\b[^\\n]*\\bhk(lm|cu|cr|u|cc):")),

            new DenyRule("禁止夺取所有权 / 批量改 ACL",
                    Pattern.compile("(?i)\\btakeown\\b[^\\n]*\\s/f\\b|"
                            + "\\bicacls\\b[^\\n]*\\s/(grant|deny|setowner)\\b[^\\n]*\\s/t\\b")),

            new DenyRule("禁止删除卷影副本",
                    Pattern.compile("(?i)\\bvssadmin\\b[^\\n]*\\bdelete\\b[^\\n]*\\bshadows?\\b|"
                            + "\\bwmic\\b[^\\n]*\\bshadowcopy\\b[^\\n]*\\bdelete\\b")),

            new DenyRule("禁止修改引导配置",
                    Pattern.compile("(?i)\\bbcdedit\\b")),

            new DenyRule("禁止 PowerShell 关机 / 重启",
                    Pattern.compile("(?i)\\b(stop|restart)-computer\\b")),

            // Windows 上 curl / wget 常是 Invoke-WebRequest 的别名，
            // 上面那条 `curl|sh` 的 POSIX 规则匹配不到 `curl x | iex`。
            new DenyRule("禁止下载后直接执行远端脚本",
                    Pattern.compile("(?i)\\b(iwr|irm|curl|wget|invoke-webrequest|invoke-restmethod)\\b"
                            + "[^|\\n]*\\|\\s*(iex|invoke-expression)\\b")),

            new DenyRule("禁止直接执行远端脚本内容",
                    Pattern.compile("(?i)\\b(iex|invoke-expression)\\b[^\\n]*"
                            + "\\b(downloadstring|iwr|irm|invoke-webrequest|invoke-restmethod)\\b"))
    );

    private CommandGuard() {
    }

    /**
     * 校验命令是否安全。
     *
     * @return null 表示放行；非 null 字符串是拒绝原因，调用方包装成用户/LLM 可见的提示
     */
    public static String check(String command) {
        if (command == null || command.isBlank()) {
            return null;
        }
        String normalized = command.replaceAll("\\s+", " ").trim();

        for (DenyRule rule : RULES) {
            if (rule.pattern().matcher(normalized).find()) {
                return rule.reason();
            }
        }
        return null;
    }

    private record DenyRule(String reason, Pattern pattern) {
    }
}
