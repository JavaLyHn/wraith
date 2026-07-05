package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * Polls {@code ~/.wraith/automation-requests/} for pending request files and
 * consumes them.
 *
 * <p>The app-server (desktop panel, a separate process) writes one small JSON
 * file per request into the directory:
 * <pre>
 *   {"type":"run-now","id":"taskId","payload":null}
 *   {"type":"approval","id":"approvalId","payload":"approve"}
 * </pre>
 * The daemon calls {@link #drain()} on each tick; drain reads every {@code *.json}
 * file, parses it into a {@link Request}, <em>deletes</em> the file, and returns
 * the collected list.  One-file-per-request avoids concurrent-write races on a
 * shared mutable file.
 */
public final class RequestInbox {

    private static final Logger log = LoggerFactory.getLogger(RequestInbox.class);

    private static final ObjectMapper M = new ObjectMapper();

    /**
     * A single request written by the app-server.
     *
     * @param type    {@code "run-now"} or {@code "approval"}
     * @param id      task-id (for run-now) or approval-id (for approval)
     * @param payload optional extra context; {@code null} for run-now, the
     *                decision string ({@code "approve"}/{@code "reject"}) for
     *                approval
     */
    public record Request(String type, String id, String payload) {}

    private final Path requestsDir;

    /**
     * @param requestsDir the directory to watch; typically
     *                    {@code ~/.wraith/automation-requests/}
     */
    public RequestInbox(Path requestsDir) {
        this.requestsDir = requestsDir;
    }

    /**
     * Reads all {@code *.json} files currently present in the requests directory,
     * parses each into a {@link Request}, deletes the file (consuming the
     * request), and returns the list.
     *
     * <ul>
     *   <li>If the directory does not exist, returns an empty list.</li>
     *   <li>A single corrupt/unparseable file is logged and deleted (or skipped)
     *       without aborting processing of the remaining files.</li>
     * </ul>
     *
     * @return immutable snapshot of all successfully parsed requests
     */
    public List<Request> drain() {
        if (!Files.exists(requestsDir)) {
            return List.of();
        }

        List<Request> collected = new ArrayList<>();

        try (Stream<Path> stream = Files.list(requestsDir)) {
            stream
                .filter(p -> p.getFileName().toString().endsWith(".json"))
                .forEach(file -> {
                    Request req = parseAndDelete(file);
                    if (req != null) {
                        collected.add(req);
                    }
                });
        } catch (IOException e) {
            log.warn("RequestInbox: failed to list {}: {}", requestsDir, e.getMessage());
        }

        return List.copyOf(collected);
    }

    // ---- internal ----------------------------------------------------------

    /** Parses a request file and deletes it regardless of parse success.
     *  Returns {@code null} on parse failure (file is still deleted). */
    private Request parseAndDelete(Path file) {
        Request req = null;
        try {
            req = M.readValue(file.toFile(), Request.class);
        } catch (IOException e) {
            log.warn("RequestInbox: skipping unparseable file {} — {}", file.getFileName(), e.getMessage());
        }

        // Always delete the file so a corrupt file doesn't get retried forever
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("RequestInbox: could not delete {} — {}", file.getFileName(), e.getMessage());
        }

        return req;
    }
}
