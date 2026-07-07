package com.lyhn.wraith.stt;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SttClientTest {
    @Test void parsesTextField() {
        assertEquals("你好 world", SttClient.parseTranscription("{\"text\":\"你好 world\"}"));
    }
    @Test void trimsWhitespace() {
        assertEquals("hi", SttClient.parseTranscription("{\"text\":\"  hi \"}"));
    }
    @Test void missingTextThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("{\"foo\":1}"));
    }
    @Test void emptyTextThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("{\"text\":\"   \"}"));
    }
    @Test void malformedJsonThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("not json"));
    }
}
