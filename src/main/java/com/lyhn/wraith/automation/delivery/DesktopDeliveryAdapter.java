package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRun;
import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * DeliveryAdapter for the desktop app.
 *
 * <p>Instead of sending a network message, marks the corresponding
 * {@link AutomationRun#notifyDesktop} flag so that the Electron desktop app
 * (Task 18) can poll {@code automation-runs.json} and pop an OS notification.
 *
 * <p>Run-matching strategy:
 * <ol>
 *   <li>If {@code result.sessionId()} is non-null, find the run whose
 *       {@code sessionId} equals it.</li>
 *   <li>Otherwise (e.g. failed run with null sessionId), fall back to the
 *       most-recent run (max {@code startedAt}) for {@code task.id}.</li>
 * </ol>
 *
 * <p>If no matching run is found, logs a WARN and returns without throwing.
 */
public final class DesktopDeliveryAdapter implements DeliveryAdapter {

    private static final Logger log = LoggerFactory.getLogger(DesktopDeliveryAdapter.class);

    private final AutomationStore store;

    public DesktopDeliveryAdapter(AutomationStore store) {
        this.store = store;
    }

    @Override
    public String platform() {
        return "desktop";
    }

    /**
     * Marks {@link AutomationRun#notifyDesktop} on the matching run and persists it.
     *
     * <p>Matching: by {@code result.sessionId()} first; falls back to the
     * most-recent run for {@code task.id} when sessionId is null.
     * No-op (with a WARN) when no run is found.
     */
    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        List<AutomationRun> runs = store.loadRuns();

        Optional<AutomationRun> found;
        if (result.sessionId() != null) {
            // Primary: match by sessionId
            found = runs.stream()
                    .filter(r -> result.sessionId().equals(r.sessionId))
                    .findFirst();
        } else {
            // Fallback: most-recent run for this taskId
            found = runs.stream()
                    .filter(r -> task.id != null && task.id.equals(r.taskId))
                    .max(Comparator.comparingLong(r -> r.startedAt));
        }

        if (found.isEmpty()) {
            log.warn("DesktopDeliveryAdapter: no run found for task={} sessionId={}; skipping",
                    task.id, result.sessionId());
            return;
        }

        AutomationRun run = found.get();
        run.notifyDesktop = true;
        store.putRun(run);
        log.debug("DesktopDeliveryAdapter: marked notifyDesktop=true on runId={} taskId={}",
                run.runId, run.taskId);
    }
}
