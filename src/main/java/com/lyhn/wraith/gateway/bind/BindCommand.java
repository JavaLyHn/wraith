package com.lyhn.wraith.gateway.bind;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.GatewayDaemon;
import okhttp3.OkHttpClient;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * {@code wraith gateway [bind]} 子命令入口。
 *
 * <ul>
 *   <li>{@code wraith gateway bind} → openclaw 扫码绑定流程：本地生成 AES key →
 *       {@link Openclaw#createBindTask} → 打印扫码指引 → 轮询 {@link Openclaw#pollBindResult}
 *       直到 COMPLETED → {@link Openclaw#decryptSecret} → 把 {@code gateway.qq} 写入
 *       {@code ~/.wraith/config.json}。（EYE-VERIFY：需真机扫码，此处不做自动化测试。）</li>
 *   <li>{@code wraith gateway}（无 bind）→ {@link GatewayDaemon#start} 常驻。</li>
 * </ul>
 *
 * <p>⚠ 密钥红线：解出的 appId / clientSecret / openid 只写入配置文件，绝不打印或日志。
 */
public final class BindCommand {

    private BindCommand() {}

    /** COMPLETED 前的轮询上限（30 次 × 3s ≈ 90s）。 */
    private static final int MAX_POLLS = 30;
    private static final long POLL_INTERVAL_MS = 3_000L;

    public static void dispatch(String[] args) {
        if (args != null && args.length >= 2 && "bind".equals(args[1])) {
            runBind();
        } else {
            GatewayDaemon.start(WraithConfig.load());
        }
    }

    /**
     * 扫码绑定流程（EYE-VERIFY）。生成本地 AES key，提交换 task_id，引导用户扫码，
     * 轮询到 COMPLETED 后解密并落盘。
     */
    private static void runBind() {
        OkHttpClient http = new OkHttpClient();
        Openclaw openclaw = new Openclaw(http);

        // 本地生成 32 字节 AES-256 key（base64 提交给 portal；解密时用原始字节）。
        byte[] aesKey = new byte[32];
        new SecureRandom().nextBytes(aesKey);
        String base64Key = Base64.getEncoder().encodeToString(aesKey);

        try {
            String taskId = openclaw.createBindTask(base64Key);
            System.out.println("请用手机 QQ 扫码完成绑定：");
            System.out.println("  https://q.qq.com/qqbot/openclaw/connect.html?task_id=" + taskId + "&_wv=2&source=wraith");
            System.out.println("（等待扫码授权，最长约 " + (MAX_POLLS * POLL_INTERVAL_MS / 1000) + " 秒）...");

            String[] result = null;
            for (int i = 0; i < MAX_POLLS; i++) {
                String[] r = openclaw.pollBindResult(taskId);
                String status = r[0];
                if ("2".equals(status)) {           // COMPLETED
                    result = r;
                    break;
                }
                if ("3".equals(status)) {           // EXPIRED
                    System.err.println("[gateway] 绑定任务已过期，请重试 wraith gateway bind");
                    return;
                }
                Thread.sleep(POLL_INTERVAL_MS);     // PENDING：继续轮询
            }

            if (result == null) {
                System.err.println("[gateway] 绑定超时（未在限定时间内完成扫码），请重试");
                return;
            }

            // result = [status, bot_appid, bot_encrypt_secret, user_openid]
            String appId = result[1];
            String clientSecret = Openclaw.decryptSecret(result[2], aesKey);
            String ownerOpenid = result[3];

            // ⚠ 只写入配置文件，绝不打印明文密钥/openid。
            WraithConfig cfg = WraithConfig.load();
            WraithConfig.GatewayConfig gw = cfg.getGateway();
            if (gw == null) {
                gw = new WraithConfig.GatewayConfig();
                cfg.setGateway(gw);
            }
            WraithConfig.GatewayQqConfig qq = gw.getQq();
            if (qq == null) {
                qq = new WraithConfig.GatewayQqConfig();
                gw.setQq(qq);
            }
            qq.setAppId(appId);
            qq.setClientSecret(clientSecret);
            qq.setOwnerOpenid(ownerOpenid);
            if (qq.getWorkspace() == null || qq.getWorkspace().isBlank()) {
                qq.setWorkspace(System.getProperty("user.dir"));
            }
            cfg.save();

            System.out.println("✅ 绑定成功，已写入 ~/.wraith/config.json。运行 `wraith gateway` 启动网关。");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            System.err.println("[gateway] 绑定被中断");
        } catch (Exception e) {
            // 不打印 e.getMessage()（可能含敏感响应体片段），只报异常类型。
            System.err.println("[gateway] 绑定失败: " + e.getClass().getSimpleName());
        }
    }
}
