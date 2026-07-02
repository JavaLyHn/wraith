package com.lyhn.wraith.mcp.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * mcp.json 树式读改写:只动目标 server 的 command/args/env,顶层与 server 级未知字段原样保留
 * (McpConfigFile 是 ignoreUnknown 的读侧类,经它回写会丢字段——所以必须走 JsonNode 树)。
 * 坏 JSON 一律抛 IOException,绝不覆盖用户手写内容。
 */
public final class McpConfigWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private McpConfigWriter() { }

    public static synchronized void upsert(Path file, String name, String command,
                                           List<String> args, Map<String, String> env) throws IOException {
        ObjectNode root = readTree(file);
        ObjectNode servers = objectChild(root, "mcpServers", true);
        ObjectNode entry = objectChild(servers, name, true);

        entry.put("command", command);
        ArrayNode argsNode = entry.putArray("args");
        args.forEach(argsNode::add);
        // stdio 覆盖:清 http 字段,否则 transport 二选一校验会拒启
        entry.remove("url");
        entry.remove("headers");

        ObjectNode oldEnv = entry.has("env") && entry.get("env").isObject() ? (ObjectNode) entry.get("env") : null;
        ObjectNode envNode = MAPPER.createObjectNode();
        for (Map.Entry<String, String> e : env.entrySet()) {
            if (e.getValue() != null && e.getValue().isEmpty()) {
                // 空串 = 保留现值(密钥编辑语义);原无此 key 则忽略
                if (oldEnv != null && oldEnv.hasNonNull(e.getKey())) envNode.set(e.getKey(), oldEnv.get(e.getKey()));
            } else {
                envNode.put(e.getKey(), e.getValue());
            }
        }
        if (envNode.size() > 0) entry.set("env", envNode); else entry.remove("env");

        if (file.getParent() != null) Files.createDirectories(file.getParent());
        Files.writeString(file, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
    }

    public static synchronized boolean remove(Path file, String name) throws IOException {
        if (!Files.exists(file)) return false;
        ObjectNode root = readTree(file);
        JsonNode servers = root.get("mcpServers");
        if (!(servers instanceof ObjectNode s) || !s.has(name)) return false;
        s.remove(name);
        Files.writeString(file, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
        return true;
    }

    private static ObjectNode readTree(Path file) throws IOException {
        if (!Files.exists(file)) return MAPPER.createObjectNode();
        JsonNode n;
        try {
            n = MAPPER.readTree(file.toFile());
        } catch (IOException e) {
            throw new IOException("mcp.json 解析失败,拒绝覆盖: " + file, e);
        }
        if (n instanceof ObjectNode o) return o;
        throw new IOException("mcp.json 顶层不是对象,拒绝覆盖: " + file);
    }

    private static ObjectNode objectChild(ObjectNode parent, String field, boolean create) {
        JsonNode child = parent.get(field);
        if (child instanceof ObjectNode o) return o;
        if (!create) return null;
        return parent.putObject(field);
    }
}
