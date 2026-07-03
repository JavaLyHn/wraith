package com.lyhn.wraith.gateway.qq;
import java.util.LinkedHashMap;
import java.util.Map;

/** msgId 去重:LRU 上限;seen(id) 首见 false、再见 true。 */
public final class Dedup {
    private final int max;
    private final Map<String, Boolean> seen;
    public Dedup(int max) {
        this.max = max;
        this.seen = new LinkedHashMap<>(16, 0.75f, false) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) { return size() > Dedup.this.max; }
        };
    }
    public synchronized boolean seen(String id) {
        if (id == null || id.isEmpty()) return false;
        return seen.put(id, Boolean.TRUE) != null;
    }
}
