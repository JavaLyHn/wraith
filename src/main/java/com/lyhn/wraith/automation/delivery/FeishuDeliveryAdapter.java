package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;

/**
 * DeliveryAdapter for 飞书单聊。飞书可随时主动发消息,故直接立即发给 owner
 * (无 QQ 的 60 分钟被动窗口 / 待发队列)。发送经注入的 {@link Sink}(由
 * FeishuProvider 接到 im.message.create),便于单测。不抛异常。
 */
public final class FeishuDeliveryAdapter implements DeliveryAdapter {

    /** 出站文本发送口(openId, text)。 */
    public interface Sink { void send(String openId, String text); }

    private final String ownerOpenid;
    private final Sink sink;

    public FeishuDeliveryAdapter(String ownerOpenid, Sink sink) {
        this.ownerOpenid = ownerOpenid;
        this.sink = sink;
    }

    @Override
    public String platform() {
        return "feishu";
    }

    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        sink.send(ownerOpenid, "⏰ " + task.name + ":\n" + result.answer());
    }
}
