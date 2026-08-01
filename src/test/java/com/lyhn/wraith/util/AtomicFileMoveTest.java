package com.lyhn.wraith.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression traps for the Windows tmp→target atomic-move hardening ({@code AtomicFileMove}).
 *
 * <p>These tests verify the <b>retry/backoff policy</b> deterministically via the injectable
 * {@code MoveOp}/sleeper overload — they do NOT reproduce the actual Windows failure mode
 * ({@code AccessDeniedException} thrown by the real filesystem while another process holds the
 * target open). That OS-level behaviour cannot be triggered on macOS/POSIX, where rename over an
 * open file simply succeeds; only the real-Windows test run the user is about to do can confirm
 * the retry actually fires against a genuinely locked file.
 */
class AtomicFileMoveTest {

    @Test
    void succeedsOnFirstAttemptInvokesOpOnceAndNeverSleeps() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        List<Integer> sleeps = new ArrayList<>();

        AtomicFileMove.moveIntoPlace(
                Path.of("tmp"), Path.of("target"),
                (t, target) -> calls.incrementAndGet(),
                sleeps::add);

        assertEquals(1, calls.get(), "op should be invoked exactly once on immediate success");
        assertTrue(sleeps.isEmpty(), "no backoff sleep should happen on the successful path: " + sleeps);
    }

    @Test
    void retriesTransientAccessDeniedTwiceThenSucceeds() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        List<Integer> sleeps = new ArrayList<>();

        AtomicFileMove.moveIntoPlace(
                Path.of("tmp"), Path.of("target"),
                (t, target) -> {
                    int n = calls.incrementAndGet();
                    if (n <= 2) {
                        throw new AccessDeniedException("target locked, attempt " + n);
                    }
                },
                sleeps::add);

        assertEquals(3, calls.get(), "op should run: fail, fail, succeed = 3 invocations");
        assertEquals(2, sleeps.size(), "exactly two backoffs before the third (successful) attempt");
        assertTrue(sleeps.get(0) < sleeps.get(1),
                "backoff must increase between retries, got " + sleeps);
    }

    @Test
    void exhaustsAttemptsAndRethrowsTheLastFailureVerbatim() {
        AtomicInteger calls = new AtomicInteger();
        List<Integer> sleeps = new ArrayList<>();
        List<AccessDeniedException> thrown = new ArrayList<>();

        AccessDeniedException result = assertThrows(AccessDeniedException.class, () ->
                AtomicFileMove.moveIntoPlace(
                        Path.of("tmp"), Path.of("target"),
                        (t, target) -> {
                            int n = calls.incrementAndGet();
                            AccessDeniedException ex = new AccessDeniedException("target locked, attempt " + n);
                            thrown.add(ex);
                            throw ex;
                        },
                        sleeps::add));

        assertEquals(5, calls.get(), "op should be invoked exactly `attempts` (5) times, never more");
        assertEquals(5, thrown.size());
        assertSame(thrown.get(thrown.size() - 1), result,
                "the rethrown exception must be the LAST one thrown, not the first or a wrapper");
        // 4 backoffs between the 5 attempts (before attempt cap is hit, never after the last attempt).
        assertEquals(4, sleeps.size(), "backoff happens before each retry, not after the final failed attempt");
        for (int i = 1; i < sleeps.size(); i++) {
            assertTrue(sleeps.get(i - 1) < sleeps.get(i),
                    "backoff should keep increasing across retries, got " + sleeps);
        }
    }

    @Test
    void atomicMoveNotSupportedFallsBackWithoutConsumingRetryBudgetOrSleeping(@TempDir Path dir) throws IOException {
        Path tmp = dir.resolve("target.tmp");
        Path target = dir.resolve("target");
        Files.writeString(tmp, "new-content", StandardCharsets.UTF_8);
        Files.writeString(target, "old-content", StandardCharsets.UTF_8);

        AtomicInteger calls = new AtomicInteger();
        List<Integer> sleeps = new ArrayList<>();

        // The injected op always reports "not supported" — real filesystems only throw this for
        // the ATOMIC_MOVE attempt itself, never for REPLACE_EXISTING, so the fallback inside
        // AtomicFileMove (a *real* Files.move(..., REPLACE_EXISTING), independent of this fake op)
        // is what must actually perform the move against the real temp-dir files below.
        AtomicFileMove.moveIntoPlace(
                tmp, target,
                (t, tgt) -> {
                    calls.incrementAndGet();
                    throw new AtomicMoveNotSupportedException(t.toString(), tgt.toString(), "not supported");
                },
                sleeps::add);

        assertEquals(1, calls.get(),
                "the not-supported case must NOT be treated as retryable — the atomic attempt runs once");
        assertTrue(sleeps.isEmpty(), "falling back to REPLACE_EXISTING must not sleep/back off");
        // Distinguishes "fell back and actually replaced the file" from "retried against the fake
        // op and eventually rethrew" — only a real REPLACE_EXISTING move produces this content.
        assertEquals("new-content", Files.readString(target, StandardCharsets.UTF_8));
        assertFalse(Files.exists(tmp), "tmp should have been consumed by the fallback move");
    }

    @Test
    void endToEndPublicMethodReplacesExistingTargetOnRealFilesystem(@TempDir Path dir) throws IOException {
        Path target = dir.resolve("session.jsonl");
        Files.writeString(target, "old-session-data", StandardCharsets.UTF_8);

        Path tmp = dir.resolve("session.jsonl.tmp");
        Files.writeString(tmp, "new-session-data", StandardCharsets.UTF_8);

        AtomicFileMove.moveIntoPlace(tmp, target);

        assertEquals("new-session-data", Files.readString(target, StandardCharsets.UTF_8),
                "moveIntoPlace must really replace the pre-existing target with the tmp content");
        assertFalse(Files.exists(tmp), "tmp file should be gone after a successful move");
    }

    @Test
    void interruptedBackoffAbortsRetryLoopAndRestoresInterruptFlag() {
        AtomicInteger calls = new AtomicInteger();
        List<Integer> sleeps = new ArrayList<>();
        List<AccessDeniedException> thrown = new ArrayList<>();

        try {
            AccessDeniedException result = assertThrows(AccessDeniedException.class, () ->
                    AtomicFileMove.moveIntoPlace(
                            Path.of("tmp"), Path.of("target"),
                            (t, target) -> {
                                int n = calls.incrementAndGet();
                                AccessDeniedException ex = new AccessDeniedException("locked " + n);
                                thrown.add(ex);
                                throw ex;
                            },
                            ms -> {
                                sleeps.add(ms);
                                // Simulate the real sleeper being interrupted mid-backoff: it
                                // restores the flag itself (mirroring AtomicFileMove's real
                                // sleepMillis), the retry loop must notice and abort rather than
                                // spin through the remaining attempts.
                                Thread.currentThread().interrupt();
                            }));

            assertEquals(1, calls.get(), "must abort after the first attempt once interrupted, not retry further");
            assertEquals(1, sleeps.size());
            assertSame(thrown.get(0), result, "must rethrow the last real failure, not swallow it for the interrupt");
            assertTrue(Thread.currentThread().isInterrupted(), "interrupt flag must be restored, not swallowed");
        } finally {
            assertTrue(Thread.interrupted(), "clearing: flag was set as expected"); // clears it for later tests
        }
    }
}
