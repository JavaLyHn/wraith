package com.lyhn.wraith.util;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileSystemException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.function.IntConsumer;

/**
 * Shared tmp→target atomic-move step for the "write tmp file, then rename into place" pattern
 * used by {@code AutomationStore}, {@code SessionStore}, {@code SkillStore} and
 * {@code QqPendingStore}.
 *
 * <p>On POSIX filesystems a rename over an existing (even open) file just works. On Windows,
 * if the target is briefly held open by another process (antivirus, Search indexer, another
 * Wraith process reading it), {@link Files#move} fails with {@link java.nio.file.AccessDeniedException}
 * — a subclass of {@link FileSystemException}, <b>not</b> of
 * {@link AtomicMoveNotSupportedException}. Falling back to {@code REPLACE_EXISTING} does not
 * help either, since the same lock blocks that call too. The only real remedy for a transient
 * lock is a short bounded retry, which is what this class adds on top of the pre-existing
 * atomic-move-with-fallback behaviour.
 *
 * <p><b>Careful with the exception hierarchy:</b> {@link AtomicMoveNotSupportedException} is
 * itself a {@link FileSystemException}, so it must be caught (and handled via the
 * {@code REPLACE_EXISTING} fallback) before the generic {@link FileSystemException} catch that
 * drives the lock-retry path — otherwise a "not supported" filesystem would be mistaken for a
 * transient lock and needlessly retried/backed off.
 */
public final class AtomicFileMove {

    /** Bounded attempt cap: one initial try plus up to this many retries-worth of iterations. */
    private static final int MAX_ATTEMPTS = 5;

    /** Increasing backoff (ms) before attempts 2..MAX_ATTEMPTS; total well under a second so no
     * UI-facing write path can visibly stall. */
    private static final int[] BACKOFF_MS = {20, 40, 60, 80};

    private AtomicFileMove() {
    }

    /**
     * Move {@code tmp} into {@code target}, preferring an atomic rename and retrying a bounded
     * number of times if the target is transiently locked (Windows: AV/indexer/another process
     * holding it open). Rethrows the last exception unchanged if every attempt fails — callers
     * keep converting {@link IOException} themselves (e.g. into {@code UncheckedIOException}).
     */
    public static void moveIntoPlace(Path tmp, Path target) throws IOException {
        moveIntoPlace(tmp, target, AtomicFileMove::atomicMove, AtomicFileMove::sleepMillis);
    }

    /**
     * One atomic-move attempt, injectable so tests can simulate Windows-only failures
     * ({@code AccessDeniedException}) deterministically on any OS.
     */
    @FunctionalInterface
    interface MoveOp {
        void move(Path tmp, Path target) throws IOException;
    }

    /**
     * Test seam: {@code op} performs the {@code ATOMIC_MOVE} attempt, {@code sleeper} performs
     * the backoff wait. Package-private so {@code AtomicFileMoveTest} can drive both
     * deterministically without touching the real filesystem or the clock.
     */
    static void moveIntoPlace(Path tmp, Path target, MoveOp op, IntConsumer sleeper) throws IOException {
        FileSystemException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                op.move(tmp, target);
                return;
            } catch (AtomicMoveNotSupportedException notSupported) {
                // Filesystem doesn't support atomic rename at all — not a transient lock, so
                // fall back once, immediately, without touching the retry/backoff budget.
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
                return;
            } catch (FileSystemException lockLike) {
                // e.g. AccessDeniedException: target briefly held open by another process.
                lastFailure = lockLike;
            }
            if (attempt == MAX_ATTEMPTS) {
                break;
            }
            sleeper.accept(BACKOFF_MS[attempt - 1]);
            if (Thread.currentThread().isInterrupted()) {
                break;
            }
        }
        throw lastFailure;
    }

    private static void atomicMove(Path tmp, Path target) throws IOException {
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
    }

    private static void sleepMillis(int ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
