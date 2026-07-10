package com.lyhn.wraith.gateway.bind;

import com.lyhn.wraith.wechat.IlinkClient;
import com.lyhn.wraith.wechat.TerminalQrRenderer;
import com.lyhn.wraith.wechat.WechatAccount;
import com.lyhn.wraith.wechat.WechatAccountStore;
import com.lyhn.wraith.wechat.WechatLoginResult;
import com.lyhn.wraith.wechat.WechatQrLogin;

import java.nio.file.Path;
import java.time.Duration;

/**
 * {@code wraith gateway bind-weixin [--workspace <dir>]}:微信 iLink 扫码绑定(非交互)。
 * 终端渲染二维码 → 手机微信扫码确认 → 轮询换 token → 写 WechatAccountStore
 * (扫码者 ilink_user_id 即主人 boundUserId)。EYE-VERIFY:需真机扫码。
 * ⚠ 密钥红线:bot_token 只落账号店,绝不打印。
 */
public final class WeixinBind {

    private static final long POLL_INTERVAL_MS = 3_000L;

    private WeixinBind() {}

    public static void run(String[] args) {
        String workspace = argValue(args, "--workspace");
        if (workspace == null || workspace.isBlank()) {
            workspace = Path.of(".").toAbsolutePath().normalize().toString();
        }
        IlinkClient client = new IlinkClient();
        WechatAccountStore store = WechatAccountStore.createDefault();
        try {
            WechatQrLogin qr = client.startQrLogin("3");
            System.out.println("请用目标微信扫描二维码:");
            TerminalQrRenderer.print(System.out, qr.qrcodeUrl());
            System.out.println("扫码失败时可打开链接:" + qr.qrcodeUrl());
            System.out.println("(等待扫码授权,最长约 300 秒)...");

            long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
            while (System.nanoTime() < deadline) {
                WechatLoginResult r = client.pollQrStatus(qr.qrcodeId());
                if (r.connected()) {
                    WechatAccount account = store.createAccount(
                            r.token(), r.accountId(), r.baseUrl(), r.userId(), workspace);
                    store.save(account);
                    System.out.println("✅ 微信绑定成功,账号: " + r.accountId());
                    System.out.println("工作区: " + workspace);
                    System.out.println("提示:网关将在下次 wraith gateway 启动时接入微信;与 /wechat REPL 通道不可同时运行。");
                    return;
                }
                if (r.expired()) {
                    System.err.println("[gateway] 二维码已过期,请重试 wraith gateway bind-weixin");
                    return;
                }
                Thread.sleep(POLL_INTERVAL_MS);
            }
            System.err.println("[gateway] 绑定超时(未在限定时间内完成扫码),请重试");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            System.err.println("[gateway] 绑定被中断");
        } catch (Exception e) {
            // 不打印 e.getMessage()(IlinkClient 的 IOException 携带完整响应体,绑定期可能含 bot_token),只报异常类型。
            System.err.println("[gateway] 微信绑定失败: " + e.getClass().getSimpleName());
        }
    }

    /** 提取 `--key value` 形式的参数值;无则 null。 */
    static String argValue(String[] args, String key) {
        if (args == null) return null;
        for (int i = 0; i < args.length - 1; i++) {
            if (key.equals(args[i])) return args[i + 1];
        }
        return null;
    }
}
