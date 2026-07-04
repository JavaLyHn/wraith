package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Deliverer — 按 platform 分派投递结果。
 *
 * <p>构造时根据 adapters 列表建立 {@code platform → adapter} 映射，
 * 运行时对每个 {@link AutomationTask#deliverTo} 目标查找对应 adapter 并调用。
 *
 * <p>两个提前退出条件：
 * <ul>
 *   <li>result.answer() 为 null 或纯空白 → 整体抑制（不投任何 target）</li>
 *   <li>deliverTo 为空 / null → no-op（run-only 任务）</li>
 * </ul>
 */
public class Deliverer {

    private static final Logger log = LoggerFactory.getLogger(Deliverer.class);
    private final Map<String, DeliveryAdapter> adapters;

    /**
     * @param adapters the list of adapters to register; duplicate platforms last-wins
     */
    public Deliverer(List<DeliveryAdapter> adapters) {
        this.adapters = new HashMap<>();
        for (DeliveryAdapter a : adapters) {
            this.adapters.put(a.platform(), a);
        }
    }

    /**
     * Dispatch the run result to all configured delivery targets.
     *
     * @param task   the automation task (contains deliverTo list)
     * @param result the run result to deliver
     */
    public void deliver(AutomationTask task, AutomationRunner.RunResult result) {
        // Suppress delivery entirely when answer is null or blank
        if (result.answer() == null || result.answer().isBlank()) {
            return;
        }

        // No-op for run-only tasks with no delivery targets
        if (task.deliverTo == null || task.deliverTo.isEmpty()) {
            return;
        }

        for (DeliveryTarget target : task.deliverTo) {
            DeliveryAdapter adapter = adapters.get(target.platform);
            if (adapter != null) {
                adapter.deliver(target, task, result);
            } else {
                log.warn("Deliverer: 未知投递平台 '{}',跳过(任务 {})", target.platform, task.name);
            }
        }
    }
}
