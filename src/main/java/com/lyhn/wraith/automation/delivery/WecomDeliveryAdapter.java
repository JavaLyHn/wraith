package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;

import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * DeliveryAdapter for 企微群聊。企微主动推送目标是 chatid(非 userid),
 * 且 chatid 在 provider 运行期才捕获,故采用懒取 Supplier 获取 ownerChatId。
 *
 * <p>chatId 为空/空白时跳过并记 warn(主人尚未与 bot 建会话,无法主动推送)。
 * 发送经注入的 {@code markdownSink}(chatId, text),便于单测。不抛异常。
 */
public final class WecomDeliveryAdapter implements DeliveryAdapter {

    private final Supplier<String> ownerChatIdSupplier;
    private final BiConsumer<String, String> markdownSink;

    /**
     * @param ownerChatIdSupplier 懒取 ownerChatId;返回空/null 时投递跳过
     * @param markdownSink        出站发送口 (chatId, markdownText)
     */
    public WecomDeliveryAdapter(Supplier<String> ownerChatIdSupplier,
                                BiConsumer<String, String> markdownSink) {
        this.ownerChatIdSupplier = ownerChatIdSupplier;
        this.markdownSink = markdownSink;
    }

    @Override
    public String platform() {
        return "wecom";
    }

    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        // target 有意忽略:企微投递恒发给 ownerChatId(非 per-target 路由)。
        try {
            String chatId = ownerChatIdSupplier.get();
            if (chatId == null || chatId.isBlank()) {
                System.err.println("[gateway] 企微投递跳过: ownerChatId 尚未捕获(主人未建会话)");
                return;
            }
            markdownSink.accept(chatId, "⏰ " + task.name + ":\n" + result.answer());
        } catch (Exception e) {
            // DeliveryAdapter 契约:deliver 不得外抛。sink 通常已内部吞异常,此处再兜一层。
            System.err.println("[gateway] 企微投递失败: " + e.getClass().getSimpleName());
        }
    }
}
