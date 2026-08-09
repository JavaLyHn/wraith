package com.lyhn.wraith.render.inline;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalPolicy;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.util.AnsiStyle;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Inline 形态的 HITL 审批提示。
 *
 * <p>首选项（批准 / 全部放行 / 拒绝 / 跳过 / 修改参数）通过
 * {@link Renderer#promptChoice(ChoiceRequest)} 呈现，统一交互范式；
 * 后续输入（拒绝原因、新参数 JSON、全部放行范围）回退到 {@code BufferedReader.readLine}。
 *
 * <p>有意保持和 {@link com.lyhn.wraith.render.PlainRenderer#promptApproval} 一致的语义；
 * 只是首选项交互复用统一的交互式选择器。
 */
public final class InlineApprovalPrompter {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final PrintStream out;
    private final Renderer renderer;
    private final BufferedReader stdinReader;

    public InlineApprovalPrompter(PrintStream out, Renderer renderer) {
        this(out, renderer, new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)));
    }

    InlineApprovalPrompter(PrintStream out, Renderer renderer, BufferedReader stdinReader) {
        this.out = out;
        this.renderer = renderer;
        this.stdinReader = stdinReader;
    }

    public ApprovalResult prompt(ApprovalRequest request) {
        boolean sensitive = request.sensitiveNotice() != null && !request.sensitiveNotice().isBlank();
        out.println();
        out.println(AnsiStyle.heading("⚠️  HITL 审批"));
        if (sensitive) {
            out.println("  " + request.sensitiveNotice());
        }
        out.println(request.toDisplayText());

        List<ChoiceOption> options = new ArrayList<>();
        options.add(new ChoiceOption("批准", null));
        if (!sensitive) {
            options.add(new ChoiceOption("全部放行", null));
        }
        options.add(new ChoiceOption("拒绝", null));
        options.add(new ChoiceOption("跳过", null));
        options.add(new ChoiceOption("修改参数", null));

        ChoiceRequest choiceReq = new ChoiceRequest("HITL 审批", options, false, null);
        ChoiceResult choice = renderer.promptChoice(choiceReq);

        if (choice.isCancelled()) {
            return ApprovalResult.reject("用户取消");
        }

        int idx = choice.selectedIndex();
        int approveIdx = 0;
        int approveAllIdx = sensitive ? -1 : 1;
        int rejectIdx = sensitive ? 1 : 2;
        int skipIdx = sensitive ? 2 : 3;
        int modifyIdx = sensitive ? 3 : 4;

        if (idx == approveIdx) {
            return ApprovalResult.approve();
        }
        if (idx == approveAllIdx && approveAllIdx >= 0) {
            return promptApproveAllScope(request);
        }
        if (idx == rejectIdx) {
            return ApprovalResult.reject(promptForReason());
        }
        if (idx == skipIdx) {
            return ApprovalResult.skip();
        }
        if (idx == modifyIdx) {
            ApprovalResult modified = promptForModifiedArgs(request);
            return modified != null ? modified : ApprovalResult.approve();
        }
        return ApprovalResult.reject("未识别的选择");
    }

    private String promptForReason() {
        out.print("  拒绝原因（可直接回车跳过）: ");
        out.flush();
        try {
            String line = stdinReader.readLine();
            return line == null ? "" : line.trim();
        } catch (IOException e) {
            return "";
        }
    }

    private ApprovalResult promptApproveAllScope(ApprovalRequest request) {
        String mcpServer = ApprovalPolicy.mcpServerName(request.toolName());
        if (mcpServer == null || mcpServer.isBlank()) {
            out.println(AnsiStyle.subtle("  已批准，后续 " + request.toolName() + " 自动通过"));
            return ApprovalResult.approveAll();
        }
        List<ChoiceOption> scopeOptions = List.of(
            new ChoiceOption("仅本工具", null),
            new ChoiceOption("整个 MCP server " + mcpServer, null)
        );
        ChoiceResult scopeChoice = renderer.promptChoice(
            new ChoiceRequest("全部放行范围", scopeOptions, false, null)
        );
        if (scopeChoice.isCancelled() || scopeChoice.selectedIndex() == 0) {
            out.println(AnsiStyle.subtle("  已批准 tool 范围"));
            return ApprovalResult.approveAll();
        }
        out.println(AnsiStyle.subtle("  已批准 server 范围"));
        return ApprovalResult.approveAllByServer();
    }

    private ApprovalResult promptForModifiedArgs(ApprovalRequest request) {
        out.println("  当前参数: " + request.arguments());
        out.print("  修改后的 JSON（空行 = 保留原参数）: ");
        out.flush();
        String modified;
        try {
            modified = stdinReader.readLine();
        } catch (IOException e) {
            return null;
        }
        if (modified == null || modified.isBlank()) {
            out.println(AnsiStyle.subtle("  保留原参数"));
            return ApprovalResult.approve();
        }
        String trimmed = modified.trim();
        try {
            JSON.readTree(trimmed);
        } catch (Exception e) {
            out.println(AnsiStyle.subtle("  ❌ 非法 JSON: " + e.getMessage()));
            return null;
        }
        return ApprovalResult.modify(trimmed);
    }
}
