package com.lyhn.wraith.memory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 待确认候选记忆队列 - 自动抽取的候选事实先落此处,人工批准才进长期记忆。
 * JSON 落盘 pending_facts.json,与长期记忆同目录、分文件。
 */
public class PendingMemoryStore {
    private static final Logger log = LoggerFactory.getLogger(PendingMemoryStore.class);
    private static final String STORAGE_DIR_PROPERTY = "wraith.memory.dir";
    private static final String STORAGE_DIR_ENV = "WRAITH_MEMORY_DIR";
    private static final String STORAGE_FILE = "pending_facts.json";

    private final Map<String, PendingFact> entries = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();
    private final File storageFile;

    public PendingMemoryStore() {
        this(resolveStorageDir());
    }

    public PendingMemoryStore(File storageDir) {
        this.mapper.enable(SerializationFeature.INDENT_OUTPUT);
        if (!storageDir.exists()) {
            storageDir.mkdirs();
        }
        this.storageFile = new File(storageDir, STORAGE_FILE);
        loadFromDisk();
    }

    public void add(PendingFact fact) {
        entries.put(fact.id(), fact);
        saveToDisk();
    }

    public List<PendingFact> list(String projectKey) {
        return entries.values().stream()
                .filter(f -> isVisible(f, projectKey))
                .collect(Collectors.toList());
    }

    public Optional<PendingFact> get(String id) {
        return Optional.ofNullable(entries.get(id));
    }

    public boolean remove(String id) {
        if (entries.remove(id) != null) {
            saveToDisk();
            return true;
        }
        return false;
    }

    public void clear(String projectKey) {
        List<String> toRemove = entries.values().stream()
                .filter(f -> isVisible(f, projectKey))
                .map(PendingFact::id)
                .collect(Collectors.toList());
        toRemove.forEach(entries::remove);
        saveToDisk();
    }

    private static boolean isVisible(PendingFact f, String projectKey) {
        if ("global".equals(f.scope())) {
            return true;
        }
        return projectKey != null && !projectKey.isBlank() && Objects.equals(f.project(), projectKey);
    }

    private void saveToDisk() {
        try {
            mapper.writeValue(storageFile, new ArrayList<>(entries.values()));
        } catch (IOException e) {
            log.warn("候选记忆持久化失败: {}", e.getMessage(), e);
        }
    }

    private void loadFromDisk() {
        if (!storageFile.exists()) return;
        try {
            PendingFact[] loaded = mapper.readValue(storageFile, PendingFact[].class);
            for (PendingFact f : loaded) {
                if (f != null && f.id() != null) {
                    entries.put(f.id(), f);
                }
            }
        } catch (IOException e) {
            log.warn("加载候选记忆失败: {}", e.getMessage(), e);
        }
    }

    private static File resolveStorageDir() {
        String dir = System.getProperty(STORAGE_DIR_PROPERTY);
        if (dir == null || dir.isBlank()) {
            dir = System.getenv(STORAGE_DIR_ENV);
        }
        if (dir != null && !dir.isBlank()) {
            return new File(dir);
        }
        return new File(new File(System.getProperty("user.home"), ".wraith"), "memory");
    }
}
