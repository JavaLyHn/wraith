package com.lyhn.wraith.gateway.qq;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class QqTextTest {
    @Test void shortTextOneChunk() {
        assertEquals(List.of("hi"), QqText.chunk("hi", 4000));
    }
    @Test void splitsOnNewlineWithinLimit() {
        String t = "a".repeat(3990) + "\n" + "b".repeat(20);
        List<String> cs = QqText.chunk(t, 4000);
        assertEquals(2, cs.size());
        assertTrue(cs.get(0).length() <= 4000);
        assertEquals("a".repeat(3990), cs.get(0));   // 在换行断
        assertEquals("b".repeat(20), cs.get(1));
    }
    @Test void hardSplitWhenNoNewline() {
        List<String> cs = QqText.chunk("x".repeat(9000), 4000);
        assertEquals(3, cs.size());
        assertEquals(4000, cs.get(0).length());
        assertEquals(1000, cs.get(2).length());
    }
    @Test void msgSeqInRangeAndIncrements() {
        AtomicInteger c = new AtomicInteger(0);
        int a = QqText.nextMsgSeq(c), b = QqText.nextMsgSeq(c);
        assertTrue(a >= 1 && a <= 65535);
        assertNotEquals(a, b);
    }
}
