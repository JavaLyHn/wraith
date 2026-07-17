package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import java.util.List;

/** 事前 token 计数抽象(spec §3):默认校准估算;将来精确 tokenizer 作为另一实现可插。 */
public interface TokenCounter {
    long estimate(String modelKey, List<Message> messages);
    void calibrate(String modelKey, long realInput, long rawEstimateAtCall);
    double factor(String modelKey);
}
