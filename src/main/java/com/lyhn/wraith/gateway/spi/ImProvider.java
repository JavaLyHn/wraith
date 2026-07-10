package com.lyhn.wraith.gateway.spi;

import com.lyhn.wraith.automation.delivery.DeliveryAdapter;

import java.util.Optional;

/**
 * 一个 IM 平台接入的 SPI。每个平台(qq、feishu、…)实现一份,自带自己的
 * 传输回路 + 会话路由 + 鉴权 + 去重;daemon 只按接口 start/stop 并收集其
 * {@link DeliveryAdapter}(供 cron 结果投递)。
 */
public interface ImProvider {

    /** 平台标识,如 {@code "qq"}、{@code "feishu"}。 */
    String platform();

    /** 起传输回路(应在独立线程,立即返回,非阻塞)。 */
    void start() throws Exception;

    /** 尽力停止传输回路(shutdown 时调用;best-effort)。 */
    void stop();

    /** 本平台的 cron 结果投递适配器(无则 empty),由 daemon 注册进 Deliverer。 */
    Optional<DeliveryAdapter> deliveryAdapter();

    /**
     * 把一个定时任务审批以本平台原生方式呈现给主人(如 QQ 待发队列 → 下次入站发按钮)。
     * 默认 no-op(不支持 IM 审批呈现的平台无需实现)。
     */
    default void surfaceScheduledApproval(String approvalId, String toolName, String suggestion) {}
}
