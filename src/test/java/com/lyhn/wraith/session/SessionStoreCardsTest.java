package com.lyhn.wraith.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SessionStoreCardsTest {

    private List<LlmClient.Message> sampleHistory() {
        return List.of(
                LlmClient.Message.system("SYS"),
                LlmClient.Message.user("hello"),
                LlmClient.Message.assistant("hi"));
    }

    @Test
    void appendAndReadCards(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/cards", "p", "m");
        store.persist(sampleHistory());
        String id = store.currentId();
        assertNotNull(id);

        // appendCard: turn 0
        store.appendCard(id, 0, "[{\"method\":\"team.started\",\"params\":{}}]");

        List<JsonNode> cards = store.readCards(id);
        assertEquals(1, cards.size());
        JsonNode c0 = cards.get(0);
        assertEquals(0, c0.get("turnOrdinal").asInt());
        assertTrue(c0.get("events").isArray(), "events should be array");
        assertEquals(1, c0.get("events").size());
        assertEquals("team.started", c0.get("events").get(0).get("method").asText());

        // appendCard: turn 1
        store.appendCard(id, 1, "[{\"method\":\"team.finished\",\"params\":{}}]");

        List<JsonNode> cards2 = store.readCards(id);
        assertEquals(2, cards2.size());
        assertEquals(0, cards2.get(0).get("turnOrdinal").asInt());
        assertEquals(1, cards2.get(1).get("turnOrdinal").asInt());
    }

    @Test
    void readCardsAbsentFileReturnsEmpty(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/cards2", "p", "m");
        List<JsonNode> result = store.readCards("nonexistent-id");
        assertNotNull(result);
        assertTrue(result.isEmpty());
    }

    @Test
    void deleteByIdRemovesCardsFile(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/cards3", "p", "m");
        store.persist(sampleHistory());
        String id = store.currentId();
        assertNotNull(id);

        store.appendCard(id, 0, "[{\"method\":\"team.started\",\"params\":{}}]");
        assertEquals(1, store.readCards(id).size());

        // deleteById should remove both .jsonl and .cards.jsonl
        store.deleteById(id);

        assertTrue(store.readCards(id).isEmpty(), "readCards after delete should be empty");

        // Verify .cards.jsonl file is physically gone
        Path dir = home.resolve(".wraith").resolve("sessions").resolve(SessionStore.hash("/proj/cards3"));
        Path cardsFile = dir.resolve(id + ".cards.jsonl");
        assertFalse(Files.exists(cardsFile), ".cards.jsonl file should not exist after deleteById");
    }

    @Test
    void deleteCurrentRemovesCardsFile(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/cards4", "p", "m");
        store.persist(sampleHistory());
        String id = store.currentId();
        assertNotNull(id);

        store.appendCard(id, 0, "[{\"method\":\"team.started\",\"params\":{}}]");

        store.deleteCurrent();

        // After deleteCurrent, the sidecar should be gone
        Path dir = home.resolve(".wraith").resolve("sessions").resolve(SessionStore.hash("/proj/cards4"));
        Path cardsFile = dir.resolve(id + ".cards.jsonl");
        assertFalse(Files.exists(cardsFile), ".cards.jsonl file should not exist after deleteCurrent");
    }

    @Test
    void appendCardGuardsNullOrBlankInputs(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/cards5", "p", "m");
        store.persist(sampleHistory());
        String id = store.currentId();

        // These should not throw
        assertDoesNotThrow(() -> store.appendCard(null, 0, "[{}]"));
        assertDoesNotThrow(() -> store.appendCard("  ", 0, "[{}]"));
        assertDoesNotThrow(() -> store.appendCard(id, 0, null));

        // None of the bad inputs should have written anything
        assertTrue(store.readCards(id).isEmpty());
    }
}
