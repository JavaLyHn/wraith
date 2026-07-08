package com.lyhn.wraith.llm;

import java.util.List;

/**
 * Fan-out {@link LlmClient.StreamListener} that forwards every method call to
 * all members in the supplied list. Used to attach an optional extra listener
 * (e.g., a desktop event-forwarder) alongside the standard terminal renderer
 * without changing the internal SubAgentStreamRenderer.
 *
 * <p>Null members are skipped silently so callers may pass {@code null}
 * placeholders when only some slots are populated.</p>
 */
public final class CompositeStreamListener implements LlmClient.StreamListener {

    private final List<LlmClient.StreamListener> members;

    /**
     * Constructs a composite from the given list of listeners. The list is
     * copied defensively; subsequent external mutations do not affect this
     * instance.
     *
     * @param members the listeners to fan out to (nulls are skipped)
     */
    public CompositeStreamListener(List<LlmClient.StreamListener> members) {
        this.members = members == null ? List.of() : List.copyOf(members);
    }

    @Override
    public void onReasoningDelta(String delta) {
        for (LlmClient.StreamListener m : members) {
            if (m != null) m.onReasoningDelta(delta);
        }
    }

    @Override
    public void onContentDelta(String delta) {
        for (LlmClient.StreamListener m : members) {
            if (m != null) m.onContentDelta(delta);
        }
    }

    @Override
    public void finish() {
        for (LlmClient.StreamListener m : members) {
            if (m != null) m.finish();
        }
    }

    @Override
    public boolean hasStreamedOutput() {
        for (LlmClient.StreamListener m : members) {
            if (m != null && m.hasStreamedOutput()) return true;
        }
        return false;
    }

    @Override
    public void resetBetweenIterations() {
        for (LlmClient.StreamListener m : members) {
            if (m != null) m.resetBetweenIterations();
        }
    }
}
