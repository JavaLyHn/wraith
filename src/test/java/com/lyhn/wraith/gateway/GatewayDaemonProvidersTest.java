package com.lyhn.wraith.gateway;

import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.gateway.spi.ImProvider;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

class GatewayDaemonProvidersTest {

    private WraithConfig cfgWithQq() {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.GatewayQqConfig qq = new WraithConfig.GatewayQqConfig();
        qq.setAppId("appid-x");
        qq.setClientSecret("secret-x");
        qq.setOwnerOpenid("owner-x");
        qq.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setQq(qq);
        cfg.setGateway(gw);
        return cfg;
    }

    @Test
    void buildsQqProviderWhenQqConfigured(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        // client=null: buildProviders does not touch the LLM (session factory is lazy).
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(cfgWithQq(), null, new QqPendingStore(dir), new com.lyhn.wraith.wechat.WechatAccountStore(dir), pending);
        assertEquals(1, providers.size());
        assertEquals("qq", providers.get(0).platform());
        assertTrue(providers.get(0).deliveryAdapter().isPresent());
    }

    @Test
    void buildsEmptyWhenNoGateway(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(new WraithConfig(), null, new QqPendingStore(dir), new com.lyhn.wraith.wechat.WechatAccountStore(dir), pending);
        assertTrue(providers.isEmpty());
    }

    @Test
    void buildsEmptyWhenGatewayHasNoQq(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        WraithConfig cfg = new WraithConfig();
        cfg.setGateway(new WraithConfig.GatewayConfig()); // qq == null
        List<ImProvider> providers =
                GatewayDaemon.buildProviders(cfg, null, new QqPendingStore(dir), new com.lyhn.wraith.wechat.WechatAccountStore(dir), pending);
        assertTrue(providers.isEmpty());
    }

    private WraithConfig cfgWithFeishu() {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.GatewayFeishuConfig fs = new WraithConfig.GatewayFeishuConfig();
        fs.setAppId("cli_x");
        fs.setAppSecret("sec_x");
        fs.setOwnerOpenid("ou_owner");
        fs.setRegion("feishu");
        fs.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setFeishu(fs);
        cfg.setGateway(gw);
        return cfg;
    }

    @Test
    void buildsFeishuProviderWhenFeishuConfigured(@TempDir Path dir) {
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers = GatewayDaemon.buildProviders(cfgWithFeishu(), null, new QqPendingStore(dir), new com.lyhn.wraith.wechat.WechatAccountStore(dir), pending);
        assertEquals(1, providers.size());
        assertEquals("feishu", providers.get(0).platform());
        assertTrue(providers.get(0).deliveryAdapter().isPresent());
    }

    @Test
    void buildsBothProvidersWhenBothConfigured(@TempDir Path dir) {
        WraithConfig cfg = cfgWithQq();
        cfg.getGateway().setFeishu(cfgWithFeishu().getGateway().getFeishu());
        Map<String, CompletableFuture<ApprovalResult>> pending = new ConcurrentHashMap<>();
        List<ImProvider> providers = GatewayDaemon.buildProviders(cfg, null, new QqPendingStore(dir), new com.lyhn.wraith.wechat.WechatAccountStore(dir), pending);
        assertEquals(2, providers.size());
        assertEquals("qq", providers.get(0).platform());     // QQ 在前
        assertEquals("feishu", providers.get(1).platform());
    }
}
