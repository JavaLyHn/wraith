package com.lyhn.wraith.config;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WraithConfigSttTest {
    @Test void defaultsWhenSttNull() {
        WraithConfig c = new WraithConfig();
        assertEquals("siliconflow", c.getSttProviderId());
        assertEquals("FunAudioLLM/SenseVoiceSmall", c.getSttModel());
    }
    @Test void overridesWhenSet() {
        WraithConfig c = new WraithConfig();
        WraithConfig.SttConfig s = new WraithConfig.SttConfig();
        s.setProviderId("xfyun");
        s.setModel("some/model");
        c.setStt(s);
        assertEquals("xfyun", c.getSttProviderId());
        assertEquals("some/model", c.getSttModel());
    }
    @Test void blankFieldsFallBackToDefaults() {
        WraithConfig c = new WraithConfig();
        WraithConfig.SttConfig s = new WraithConfig.SttConfig();
        s.setProviderId("  "); s.setModel("");
        c.setStt(s);
        assertEquals("siliconflow", c.getSttProviderId());
        assertEquals("FunAudioLLM/SenseVoiceSmall", c.getSttModel());
    }
}
