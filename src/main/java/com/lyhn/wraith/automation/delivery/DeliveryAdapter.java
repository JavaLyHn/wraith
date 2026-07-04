package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;

/**
 * SPI: 单个投递渠道的适配器。
 *
 * <p>每个渠道（qq、desktop、…）实现此接口，并在 Deliverer 构造时注册。
 * Deliverer 按 {@code target.platform} 分派给对应 adapter。
 */
public interface DeliveryAdapter {

    /** 此 adapter 处理的平台标识，如 {@code "qq"}、{@code "desktop"}。 */
    String platform();

    /**
     * 将本次运行结果投递到指定目标。
     *
     * <p>实现负责格式化消息并通过目标渠道发送；不应抛出异常（自行 catch/log）。
     *
     * @param target the delivery target (platform + chatId)
     * @param task   the automation task that was run
     * @param result the run result to deliver
     */
    void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result);
}
