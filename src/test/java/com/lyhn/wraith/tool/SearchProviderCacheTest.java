package com.lyhn.wraith.tool;

import com.lyhn.wraith.web.SearchProvider;
import com.lyhn.wraith.web.SearchResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * web_search 的 provider 缓存此前<b>没有任何失效路径，也没有注入口</b>：
 * 用户配好搜索后，本次会话依然报「未配置」，必须重启后端。
 * 这是本仓库第五次栽在 snapshot-vs-live 上（前四次：沙箱护盾、动作卡、pet 窗口、补全）。
 *
 * <p>既然本次引入了一个<b>可写</b>的配置节，这个缺陷会立刻变成用户可见的困惑。
 */
class SearchProviderCacheTest {

    /** 不发请求的假 provider —— 这个测试只关心「缓存里放的是谁」。 */
    private static SearchProvider stub(String name) {
        return new SearchProvider() {
            @Override public String name() { return name; }
            @Override public boolean isReady() { return true; }
            @Override public String unavailableHint() { return ""; }
            @Override public List<SearchResult> search(String query, int topK) { return List.of(); }
        };
    }

    @Test
    @DisplayName("invalidateSearchProvider() 之后缓存是空的，下次会重建")
    void invalidateClearsTheCachedProvider() {
        ToolRegistry registry = new ToolRegistry();
        SearchProvider injected = stub("injected");

        registry.setSearchProviderForTest(injected);
        assertSame(injected, registry.searchProviderSnapshotForTest());

        registry.invalidateSearchProvider();

        // 判别力自证：把 invalidateSearchProvider() 的 `searchProvider = null` 注释掉,
        // 这一行变红。
        assertNull(registry.searchProviderSnapshotForTest(),
                "不置空则本次会话继续用旧 provider —— 第五次 snapshot-vs-live");
    }

    @Test
    @DisplayName("没构造过时快照是 null（不该顺手替调用方构造一个）")
    void snapshotIsNullBeforeFirstUse() {
        assertNull(new ToolRegistry().searchProviderSnapshotForTest());
    }
}
