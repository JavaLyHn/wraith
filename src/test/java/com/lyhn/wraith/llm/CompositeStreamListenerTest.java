package com.lyhn.wraith.llm;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TDD for CompositeStreamListener — verifies that every StreamListener method
 * is forwarded to ALL members.
 */
class CompositeStreamListenerTest {

    /** Capturing stub that records all method invocations. */
    private static final class CapturingListener implements LlmClient.StreamListener {
        final StringBuilder reasoningDeltas = new StringBuilder();
        final StringBuilder contentDeltas = new StringBuilder();
        int finishCount = 0;
        int resetCount = 0;
        boolean hasStreamedOutputResult = false; // controlled by test

        // Allow the test to control what hasStreamedOutput() returns
        boolean streamedOutputOverride = false;

        @Override
        public void onReasoningDelta(String delta) {
            if (delta != null) reasoningDeltas.append(delta);
        }

        @Override
        public void onContentDelta(String delta) {
            if (delta != null) contentDeltas.append(delta);
        }

        @Override
        public void finish() {
            finishCount++;
        }

        @Override
        public boolean hasStreamedOutput() {
            return streamedOutputOverride;
        }

        @Override
        public void resetBetweenIterations() {
            resetCount++;
        }
    }

    @Test
    void onReasoningDelta_forwardedToBothMembers() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        composite.onReasoningDelta("hello");
        composite.onReasoningDelta(" world");

        assertEquals("hello world", a.reasoningDeltas.toString());
        assertEquals("hello world", b.reasoningDeltas.toString());
    }

    @Test
    void onContentDelta_forwardedToBothMembers() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        composite.onContentDelta("foo");
        composite.onContentDelta("bar");

        assertEquals("foobar", a.contentDeltas.toString());
        assertEquals("foobar", b.contentDeltas.toString());
    }

    @Test
    void finish_forwardedToBothMembers() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        composite.finish();

        assertEquals(1, a.finishCount);
        assertEquals(1, b.finishCount);
    }

    @Test
    void resetBetweenIterations_forwardedToBothMembers() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        composite.resetBetweenIterations();
        composite.resetBetweenIterations();

        assertEquals(2, a.resetCount);
        assertEquals(2, b.resetCount);
    }

    @Test
    void hasStreamedOutput_trueIfAnyMemberReturnsTrue() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        b.streamedOutputOverride = true;
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        assertTrue(composite.hasStreamedOutput(),
                "should return true when at least one member has streamed output");
    }

    @Test
    void hasStreamedOutput_falseWhenAllMembersReturnFalse() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        assertFalse(composite.hasStreamedOutput(),
                "should return false when all members return false");
    }

    @Test
    void allMethodsInvokedInCorrectOrder_allForwardedToBothMembers() {
        CapturingListener a = new CapturingListener();
        CapturingListener b = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a, b));

        composite.onReasoningDelta("r1");
        composite.onContentDelta("c1");
        composite.resetBetweenIterations();
        composite.onReasoningDelta("r2");
        composite.onContentDelta("c2");
        composite.finish();

        assertEquals("r1r2", a.reasoningDeltas.toString());
        assertEquals("r1r2", b.reasoningDeltas.toString());
        assertEquals("c1c2", a.contentDeltas.toString());
        assertEquals("c1c2", b.contentDeltas.toString());
        assertEquals(1, a.finishCount);
        assertEquals(1, b.finishCount);
        assertEquals(1, a.resetCount);
        assertEquals(1, b.resetCount);
    }

    @Test
    void singleMemberList_stillForwards() {
        CapturingListener a = new CapturingListener();
        CompositeStreamListener composite = new CompositeStreamListener(List.of(a));

        composite.onContentDelta("only");
        composite.finish();

        assertEquals("only", a.contentDeltas.toString());
        assertEquals(1, a.finishCount);
    }

    @Test
    void emptyMemberList_doesNotThrow() {
        CompositeStreamListener composite = new CompositeStreamListener(List.of());

        assertDoesNotThrow(() -> {
            composite.onReasoningDelta("x");
            composite.onContentDelta("y");
            composite.finish();
            composite.resetBetweenIterations();
            composite.hasStreamedOutput();
        });
    }
}
