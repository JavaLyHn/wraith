package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RequestInboxTest {

    @TempDir
    Path dir;

    /** Writes a simple flat JSON request file into the given directory. */
    private static void writeRequestFile(Path inboxDir, String filename,
                                         String type, String id, String payload) throws IOException {
        String json = String.format(
                "{\"type\":\"%s\",\"id\":\"%s\",\"payload\":%s}",
                type, id,
                payload == null ? "null" : "\"" + payload + "\""
        );
        Files.writeString(inboxDir.resolve(filename), json, StandardCharsets.UTF_8);
    }

    // -----------------------------------------------------------------------
    // Test 1: two valid requests → drain returns both, files are deleted
    // -----------------------------------------------------------------------
    @Test
    void drainReturnsBothRequestsAndDeletesFiles() throws IOException {
        writeRequestFile(dir, "req-t1.json", "run-now", "t1", null);
        writeRequestFile(dir, "req-a1.json", "approval", "a1", "approve");

        RequestInbox inbox = new RequestInbox(dir);
        List<RequestInbox.Request> results = inbox.drain();

        assertEquals(2, results.size(), "drain() should return 2 requests");

        // find each by id (order is not guaranteed)
        RequestInbox.Request runNow = results.stream()
                .filter(r -> "t1".equals(r.id())).findFirst()
                .orElseThrow(() -> new AssertionError("run-now request with id=t1 not found"));
        assertEquals("run-now", runNow.type());
        assertNull(runNow.payload());

        RequestInbox.Request approval = results.stream()
                .filter(r -> "a1".equals(r.id())).findFirst()
                .orElseThrow(() -> new AssertionError("approval request with id=a1 not found"));
        assertEquals("approval", approval.type());
        assertEquals("approve", approval.payload());

        // Both files must be deleted after drain
        assertFalse(Files.exists(dir.resolve("req-t1.json")), "req-t1.json should be deleted");
        assertFalse(Files.exists(dir.resolve("req-a1.json")), "req-a1.json should be deleted");

        // Second drain must return empty
        List<RequestInbox.Request> second = inbox.drain();
        assertTrue(second.isEmpty(), "second drain() should be empty");
    }

    // -----------------------------------------------------------------------
    // Test 2: missing directory → drain returns empty, no exception
    // -----------------------------------------------------------------------
    @Test
    void missingDirectoryReturnsEmpty() {
        Path missing = dir.resolve("does-not-exist");
        RequestInbox inbox = new RequestInbox(missing);
        assertDoesNotThrow(() -> {
            List<RequestInbox.Request> results = inbox.drain();
            assertTrue(results.isEmpty(), "drain() on missing dir should return empty list");
        });
    }

    // -----------------------------------------------------------------------
    // Test 3: corrupt file alongside a valid one → returns valid, no throw
    // -----------------------------------------------------------------------
    @Test
    void corruptFileSiblingIsSkippedWithoutAborting() throws IOException {
        // Write a corrupt (non-JSON) file
        Files.writeString(dir.resolve("corrupt.json"), "NOT JSON {{{{", StandardCharsets.UTF_8);
        // Write a valid request
        writeRequestFile(dir, "valid.json", "run-now", "v1", null);

        RequestInbox inbox = new RequestInbox(dir);
        List<RequestInbox.Request> results = assertDoesNotThrow(inbox::drain);

        assertEquals(1, results.size(), "only the valid request should be returned");
        assertEquals("v1", results.get(0).id());

        // Both files should be deleted after drain (corrupt file is log + skip + delete)
        assertFalse(Files.exists(dir.resolve("valid.json")), "valid.json should be deleted");
        assertFalse(Files.exists(dir.resolve("corrupt.json")), "corrupt.json should be deleted after drain");
    }

    // -----------------------------------------------------------------------
    // Test 4: write → drain round-trip (producer side)
    // -----------------------------------------------------------------------
    @Test
    void write_thenDrain_roundTrips() throws IOException {
        RequestInbox inbox = new RequestInbox(dir);

        // write a run-now request
        inbox.write(new RequestInbox.Request("run-now", "task-xyz", null));
        // write an approval request
        inbox.write(new RequestInbox.Request("approval", "appr-1", "approve"));

        List<RequestInbox.Request> results = inbox.drain();
        assertEquals(2, results.size(), "drain should return both written requests");

        RequestInbox.Request runNow = results.stream()
                .filter(r -> "task-xyz".equals(r.id())).findFirst()
                .orElseThrow(() -> new AssertionError("run-now request not found"));
        assertEquals("run-now", runNow.type());
        assertNull(runNow.payload());

        RequestInbox.Request approval = results.stream()
                .filter(r -> "appr-1".equals(r.id())).findFirst()
                .orElseThrow(() -> new AssertionError("approval request not found"));
        assertEquals("approval", approval.type());
        assertEquals("approve", approval.payload());

        // After drain, directory should be empty of .json files
        List<RequestInbox.Request> second = inbox.drain();
        assertTrue(second.isEmpty(), "second drain should be empty after files consumed");
    }

    // -----------------------------------------------------------------------
    // Test 5: write creates the directory if missing
    // -----------------------------------------------------------------------
    @Test
    void write_createsDirectoryIfMissing() throws IOException {
        Path inboxDir = dir.resolve("new-inbox");
        assertFalse(Files.exists(inboxDir), "precondition: directory must not exist");
        RequestInbox inbox = new RequestInbox(inboxDir);
        inbox.write(new RequestInbox.Request("run-now", "t1", null));
        assertTrue(Files.exists(inboxDir), "write() must create the directory");
        List<RequestInbox.Request> results = inbox.drain();
        assertEquals(1, results.size());
        assertEquals("t1", results.get(0).id());
    }

    // -----------------------------------------------------------------------
    // Test 6: each write produces a uniquely-named file (no collision)
    // -----------------------------------------------------------------------
    @Test
    void write_producesUniqueFilenames() throws IOException {
        RequestInbox inbox = new RequestInbox(dir);
        inbox.write(new RequestInbox.Request("run-now", "a", null));
        inbox.write(new RequestInbox.Request("run-now", "b", null));
        inbox.write(new RequestInbox.Request("run-now", "c", null));
        try (java.util.stream.Stream<Path> s = Files.list(dir)) {
            long count = s.filter(p -> p.getFileName().toString().endsWith(".json")).count();
            assertEquals(3, count, "each write should produce a distinct file");
        }
    }
}
