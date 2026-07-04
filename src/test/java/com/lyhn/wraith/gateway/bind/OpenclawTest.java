package com.lyhn.wraith.gateway.bind;

import org.junit.jupiter.api.Test;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OpenclawTest {

    /** 用同一把 key 现加密再解密，验证 IV|ct|tag 布局解析。 */
    @Test
    void decryptsAesGcm() throws Exception {
        byte[] key = new byte[32];
        for (int i = 0; i < 32; i++) key[i] = (byte) i;
        byte[] iv = new byte[12];
        for (int i = 0; i < 12; i++) iv[i] = (byte) (i + 1);

        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal("SECRET-XYZ".getBytes(StandardCharsets.UTF_8)); // ct 末尾含 16B tag

        byte[] packed = ByteBuffer.allocate(12 + ct.length).put(iv).put(ct).array();
        String b64 = Base64.getEncoder().encodeToString(packed);

        assertEquals("SECRET-XYZ", Openclaw.decryptSecret(b64, key));
    }
}
