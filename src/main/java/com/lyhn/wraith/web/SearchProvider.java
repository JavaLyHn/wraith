package com.lyhn.wraith.web;

import java.io.IOException;
import java.util.List;

/**
 * 搜索引擎抽象。
 *
 * 当前实现：
 * - {@link ZhipuSearchProvider}：智谱 Web Search，需 GLM_API_KEY（与 GLM 推理共用同一个 key）
 * - {@link SerpApiSearchProvider}：商业聚合 API，需 API Key，开箱即用
 * - {@link SearxngSearchProvider}：开源元搜索引擎，需要本地或可访问的 SearXNG 实例，免费无需 key
 * - {@link DuckDuckGoSearchProvider}：<b>显式可选</b>的零 key 应急后端，靠抓 HTML，
 *   自动选择链永不返回它（理由见该类 Javadoc）
 * - {@link UnconfiguredSearchProvider}：三条路都没配时的话术载体，{@code isReady()} 恒为 false
 *
 * 让用户根据成本 / 数据合规 / 离线需求自由切换 provider。
 * 后续如果新增 Brave / Tavily / Exa 等实现，只要继续实现这个接口，无需改动调用方。
 */
public interface SearchProvider {

    /**
     * @return provider 名称（如 "serpapi"、"searxng"），用于错误信息和日志
     */
    String name();

    /**
     * @return 是否可用（如必要 API Key 已配置 / 服务地址可访问）
     */
    boolean isReady();

    /**
     * @return 当 {@link #isReady()} 为 false 时给用户的提示，例如「请配置 SERPAPI_KEY」
     */
    String unavailableHint();

    /**
     * 执行搜索。
     *
     * @param query 搜索关键词，不可为 null/blank
     * @param topK  期望返回结果数量，实现可酌情截断
     */
    List<SearchResult> search(String query, int topK) throws IOException;
}
