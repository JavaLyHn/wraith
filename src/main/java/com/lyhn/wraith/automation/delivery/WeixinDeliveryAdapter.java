package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import com.lyhn.wraith.gateway.format.MarkdownLite;

import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * DeliveryAdapter for 个人微信(iLink ClawBot 通道)。
 *
 * <p>投递目标为主人最近的 context_token(由 WeixinProvider 运行期懒取注入),
 * context_token 为空/空白时跳过并记 warn(主人尚未扫码登录或尚无会话)。
 * 发送经注入的 {@code sink}(contextToken, text),text 已通过 {@link MarkdownLite#toPlainText}
 * 清洗(微信不渲染 Markdown)。不抛异常。
 */
public final class WeixinDeliveryAdapter implements DeliveryAdapter {

    private final Supplier<String> ownerContextTokenSupplier;
    private final BiConsumer<String, String> sink;

    /**
     * @param ownerContextTokenSupplier 懒取主人最近 context_token;返回空/null 时投递跳过
     * @param sink                      出站发送口 (contextToken, plainText)
     */
    public WeixinDeliveryAdapter(Supplier<String> ownerContextTokenSupplier,
                                 BiConsumer<String, String> sink) {
        this.ownerContextTokenSupplier = ownerContextTokenSupplier;
        this.sink = sink;
    }

    @Override
    public String platform() {
        return "weixin";
    }

    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        // target 有意忽略:微信投递恒发给主人 context_token(非 per-target 路由)。
        try {
            String ctx = ownerContextTokenSupplier.get();
            if (ctx == null || ctx.isBlank()) {
                System.err.println("[gateway] 微信投递跳过: ownerContextToken 尚未捕获(主人未建会话)");
                return;
            }
            sink.accept(ctx, "⏰ " + task.name + ":\n" + MarkdownLite.toPlainText(result.answer()));
        } catch (Exception e) {
            // DeliveryAdapter 契约:deliver 不得外抛。sink 通常已内部吞异常,此处再兜一层。
            System.err.println("[gateway] 微信投递失败: " + e.getClass().getSimpleName());
        }
    }
}
