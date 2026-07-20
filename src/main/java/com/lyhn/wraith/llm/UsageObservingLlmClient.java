package com.lyhn.wraith.llm;

import java.io.IOException;
import java.util.List;
import java.util.function.Consumer;

/**
 * 透明包装 LlmClient:每次 chat 返回后把真实用量回调出去,其余方法全委托。
 * 用于 Plan/Team 模式——把子 agent(含计划生成)的每次真实 LLM 用量上报给主 curator,
 * 让水位/成本能反映这些"外部执行"的消耗(它们不走 react 的 onUsage 埋点)。
 * 回调异常一律吞掉,绝不影响主 LLM 调用。
 */
public final class UsageObservingLlmClient implements LlmClient {
    private final LlmClient delegate;
    private final Consumer<ChatResponse> observer;

    public UsageObservingLlmClient(LlmClient delegate, Consumer<ChatResponse> observer) {
        this.delegate = delegate;
        this.observer = observer;
    }

    private ChatResponse observed(ChatResponse r) {
        if (r != null && observer != null) {
            try { observer.accept(r); } catch (Exception ignored) { /* 观测失败不影响主流程 */ }
        }
        return r;
    }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
        return observed(delegate.chat(messages, tools));
    }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
        return observed(delegate.chat(messages, tools, listener));
    }

    @Override public String getModelName() { return delegate.getModelName(); }
    @Override public String getProviderName() { return delegate.getProviderName(); }
    @Override public int maxContextWindow() { return delegate.maxContextWindow(); }
    @Override public boolean supportsPromptCaching() { return delegate.supportsPromptCaching(); }
    @Override public boolean supportsTools() { return delegate.supportsTools(); }
    @Override public String promptCacheMode() { return delegate.promptCacheMode(); }
}
