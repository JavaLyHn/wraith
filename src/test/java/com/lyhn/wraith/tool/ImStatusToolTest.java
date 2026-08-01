package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * im_status 是只读工具:回答「现在接通了哪些 IM」时给模型真实的绑定/配置状态,而不是让它凭
 * capabilities.md 里的静态支持列表瞎猜(修「面板显示 QQ 已配置,聊天里却说全部未接通」的缺口)。
 *
 * 测试隔离说明:该工具内部经 WraithConfig.load() 读取 ~/.wraith/config.json。本类保持不重定向、
 * 不写入该路径,因此不对配置内容做任何强断言(不能保证也不能伪造开发机上的真实绑定状态)。
 * (若后续要伪造配置,WraithConfig 现已支持 -Dwraith.config.dir 重定向,见 EmbeddingConfigWiringTest。)
 * 断言范围收窄到:
 * 工具已注册且暴露给 LLM、输出必含四个平台名与「已配置≠守护进程运行中」的免责声明、
 * 在配置缺失/异常时绝不抛异常、以及该工具不在 ApprovalPolicy.DANGEROUS_TOOLS 里(只读,不设审批闸)。
 */
class ImStatusToolTest {

    @Test
    void isRegisteredAndExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.hasTool("im_status"), "im_status 应已注册");
        boolean exposed = reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals("im_status"));
        assertTrue(exposed, "im_status 应出现在 getToolDefinitions()");
    }

    @Test
    void outputNamesAllFourPlatforms() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_status", "{}");
        assertNotNull(out);
        assertTrue(out.contains("QQ"), "输出应提及 QQ;实际: " + out);
        assertTrue(out.contains("微信"), "输出应提及 微信;实际: " + out);
        assertTrue(out.contains("企业微信"), "输出应提及 企业微信;实际: " + out);
        assertTrue(out.contains("飞书"), "输出应提及 飞书;实际: " + out);
    }

    @Test
    void outputContainsDaemonScopeCaveat() {
        // 「已配置」≠「网关守护进程正在运行」;守护进程是桌面端另起的独立进程,后端在此看不到其运行态。
        // 少了这句话,模型会把「已配置」直接说成「已接通」,对用户造成误导。
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_status", "{}");
        assertTrue(out.contains("守护进程"), "输出应含守护进程运行态的免责声明;实际: " + out);
    }

    @Test
    void neverThrowsRegardlessOfLocalConfigState() {
        // 不对开发机真实配置做任何假设(可能已绑定 QQ,也可能全空);只保证工具在任何本机状态下都不抛异常。
        ToolRegistry reg = new ToolRegistry();
        assertDoesNotThrow(() -> reg.executeTool("im_status", "{}"));
        // 重复调用同样不应抛异常(纯读,幂等)
        assertDoesNotThrow(() -> reg.executeTool("im_status", "{}"));
    }

    @Test
    void outputNeverLeaksSecretLikeContent() {
        // 密钥红线:即使开发机真的绑定了某平台,输出也绝不能包含 secret/token 等字段名或明文提示。
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_status", "{}").toLowerCase(java.util.Locale.ROOT);
        assertFalse(out.contains("secret"), "输出绝不能出现 secret 字样;实际: " + out);
        assertFalse(out.contains("token"), "输出绝不能出现 token 字样;实际: " + out);
        assertFalse(out.contains("clientsecret"), "输出绝不能出现 clientSecret 字样;实际: " + out);
        assertFalse(out.contains("appsecret"), "输出绝不能出现 appSecret 字样;实际: " + out);
    }

    @Test
    void isNotInDangerousToolsAndDoesNotRequireApproval() {
        // 只读工具,不设审批闸;也不应混进 ApprovalPolicy.DANGEROUS_TOOLS。
        assertFalse(com.lyhn.wraith.hitl.ApprovalPolicy.getDangerousTools().contains("im_status"),
                "im_status 是只读工具,不该出现在 ApprovalPolicy.DANGEROUS_TOOLS");
        assertFalse(com.lyhn.wraith.hitl.ApprovalPolicy.requiresApproval("im_status"),
                "im_status 是只读工具,不该走 HITL 审批");
    }

    @Test
    void takesNoParametersAndIgnoresGarbageArgs() {
        // im_status 无参数;传垂悬/畸形参数也不该炸掉,只需照常返回状态报告。
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_status", "{\"whatever\":\"ignored\"}");
        assertNotNull(out);
        assertTrue(out.contains("QQ"));
    }
}
