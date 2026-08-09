package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.Renderer;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class PresentOptionsTool {

    private static final int MIN_OPTIONS = 2;
    private static final int MAX_OPTIONS = 9;
    private static final int MAX_LABEL_LEN = 200;
    private static final int MAX_DESC_LEN = 500;

    private final Renderer renderer;
    private final ObjectMapper mapper;

    public PresentOptionsTool(Renderer renderer, ObjectMapper mapper) {
        this.renderer = renderer;
        this.mapper = mapper;
    }

    public String execute(Map<String, ?> args) {
        String title = args.get("title") == null ? "请选择" : args.get("title").toString();

        List<ChoiceOption> options;
        try {
            options = parseOptions(args.get("options"));
        } catch (Exception e) {
            return "present_options 失败: 选项解析错误 - " + e.getMessage();
        }

        if (options.size() < MIN_OPTIONS) {
            return "present_options 失败: 至少需要 " + MIN_OPTIONS + " 个选项,当前 " + options.size();
        }
        if (options.size() > MAX_OPTIONS) {
            return "present_options 失败: 最多 " + MAX_OPTIONS + " 个选项,当前 " + options.size();
        }

        Set<String> labels = new HashSet<>();
        for (ChoiceOption opt : options) {
            if (opt.label() == null || opt.label().isBlank()) {
                return "present_options 失败: 选项 label 不能为空";
            }
            if (opt.label().length() > MAX_LABEL_LEN) {
                return "present_options 失败: 选项 label 超过 " + MAX_LABEL_LEN + " 字符";
            }
            if (!labels.add(opt.label())) {
                return "present_options 失败: 选项 label 重复 - '" + opt.label() + "'";
            }
            if (opt.description() != null && opt.description().length() > MAX_DESC_LEN) {
                return "present_options 失败: 选项 description 超过 " + MAX_DESC_LEN + " 字符";
            }
        }

        String hint = args.get("hint") == null ? null : args.get("hint").toString();
        ChoiceRequest request = new ChoiceRequest(title, options, true, hint);
        ChoiceResult result = renderer.promptChoice(request);

        if (result.isCancelled()) {
            return "__cancelled__";
        }
        return options.get(result.selectedIndex()).label();
    }

    @SuppressWarnings("unchecked")
    private List<ChoiceOption> parseOptions(Object raw) throws Exception {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> list) {
            List<ChoiceOption> opts = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    String label = map.get("label") == null ? "" : map.get("label").toString();
                    String desc = map.get("description") == null ? null : map.get("description").toString();
                    opts.add(new ChoiceOption(label, desc));
                }
            }
            return opts;
        }
        String json = raw.toString();
        if (json.startsWith("[")) {
            JsonNode arr = mapper.readTree(json);
            List<ChoiceOption> opts = new ArrayList<>();
            for (JsonNode node : arr) {
                String label = node.has("label") ? node.get("label").asText() : "";
                String desc = node.has("description") ? node.get("description").asText() : null;
                opts.add(new ChoiceOption(label, desc));
            }
            return opts;
        }
        return List.of();
    }
}
