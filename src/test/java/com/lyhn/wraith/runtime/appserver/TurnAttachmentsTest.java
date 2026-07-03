package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TurnAttachments 纯函数测试 — 真文件，禁 Mockito。
 */
class TurnAttachmentsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path tmp;

    // --- helpers ---

    private ArrayNode arr(String path, String kind) {
        ArrayNode a = MAPPER.createArrayNode();
        ObjectNode item = MAPPER.createObjectNode();
        item.put("path", path);
        item.put("kind", kind);
        a.add(item);
        return a;
    }

    // --- 1. null / 空 → Resolved 空 ---

    @Test
    void nullAttachmentsReturnsEmpty() throws IOException {
        TurnAttachments.Resolved r = TurnAttachments.resolve(null);
        assertEquals("", r.textPrefix());
        assertEquals(List.of(), r.imageParts());
        assertEquals(List.of(), r.imageNames());
    }

    @Test
    void emptyArrayReturnsEmpty() throws IOException {
        TurnAttachments.Resolved r = TurnAttachments.resolve(MAPPER.createArrayNode());
        assertEquals("", r.textPrefix());
        assertTrue(r.imageParts().isEmpty());
    }

    // --- 2. 文本注入格式 ---

    @Test
    void textFileIsInjectedWithFencedBlock() throws IOException {
        Path f = tmp.resolve("hello.txt");
        Files.writeString(f, "world content", StandardCharsets.UTF_8);

        TurnAttachments.Resolved r = TurnAttachments.resolve(arr(f.toString(), "text"));

        assertTrue(r.textPrefix().contains("```hello.txt\n"),
                "textPrefix 应含开头 fence + 文件名");
        assertTrue(r.textPrefix().contains("world content"),
                "textPrefix 应含文件内容");
        assertTrue(r.textPrefix().contains("\n```\n"),
                "textPrefix 应含关闭 fence");
        assertTrue(r.imageParts().isEmpty());
        assertTrue(r.imageNames().isEmpty());
    }

    // --- 3. 图片附件 ---

    @Test
    void imageFileProducesContentPartAndName() throws IOException {
        // 最小合法 1×1 PNG（89 bytes）
        byte[] pngBytes = new byte[]{
            (byte)0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
            0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
            0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
            0x08,0x02,0x00,0x00,0x00,0x10,(byte)0xD3,0x4D,
            (byte)0xCA,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,
            0x54,0x08,(byte)0xD7,0x63,(byte)0xF8,(byte)0xCF,(byte)0xC0,0x00,0x00,
            0x00,0x02,0x00,0x01,(byte)0xE2,0x21,(byte)0xBC,0x33,
            0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,
            (byte)0xAE,0x42,0x60,(byte)0x82
        };
        Path img = tmp.resolve("photo.png");
        Files.write(img, pngBytes);

        TurnAttachments.Resolved r = TurnAttachments.resolve(arr(img.toString(), "image"));

        assertEquals(1, r.imageParts().size());
        LlmClient.ContentPart cp = r.imageParts().get(0);
        assertEquals("image_base64", cp.type());
        assertEquals("image/png", cp.mimeType());
        assertNotNull(cp.imageBase64());
        assertEquals(List.of("photo.png"), r.imageNames());
        assertEquals("", r.textPrefix());
    }

    // --- 4. 上限校验 ---

    @Test
    void textFileOverLimitThrowsWithFileName() throws IOException {
        // 写一个 >512 KB 的文件
        Path big = tmp.resolve("big.txt");
        byte[] data = new byte[(int)(TurnAttachments.TEXT_MAX + 1)];
        Files.write(big, data);

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr(big.toString(), "text")));
        assertTrue(ex.getMessage().contains("big.txt"),
                "错误信息应含文件名");
        assertTrue(ex.getMessage().contains("512 KB") || ex.getMessage().contains("512"),
                "错误信息应提及上限");
    }

    @Test
    void imageFileOverLimitThrowsWithFileName() throws IOException {
        Path bigImg = tmp.resolve("big.png");
        byte[] data = new byte[(int)(TurnAttachments.IMAGE_MAX + 1)];
        Files.write(bigImg, data);

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr(bigImg.toString(), "image")));
        assertTrue(ex.getMessage().contains("big.png"),
                "错误信息应含文件名");
    }

    @Test
    void totalSizeOverLimitThrows() throws IOException {
        // 两个 PNG 图片，每张 ~1.1 MB（< 4 MB 单张上限），合计 > 2 MB
        Path f1 = tmp.resolve("img1.png");
        Path f2 = tmp.resolve("img2.png");
        byte[] chunk = new byte[1100 * 1024];
        Files.write(f1, chunk);
        Files.write(f2, chunk);

        ArrayNode a = MAPPER.createArrayNode();
        ObjectNode i1 = MAPPER.createObjectNode(); i1.put("path", f1.toString()); i1.put("kind", "image"); a.add(i1);
        ObjectNode i2 = MAPPER.createObjectNode(); i2.put("path", f2.toString()); i2.put("kind", "image"); a.add(i2);

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(a));
        assertTrue(ex.getMessage().contains("2 MB") || ex.getMessage().contains("总量"),
                "错误信息应说明总量超限: " + ex.getMessage());
    }

    // --- 5. 路径/kind 异常 ---

    @Test
    void nonExistentPathThrows() {
        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr("/nonexistent/ghost.txt", "text")));
        assertTrue(ex.getMessage().contains("ghost.txt"),
                "错误信息应含文件名");
    }

    @Test
    void directoryPathThrows() throws IOException {
        Path dir = tmp.resolve("subdir");
        Files.createDirectory(dir);

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr(dir.toString(), "text")));
        assertNotNull(ex.getMessage());
    }

    @Test
    void illegalKindThrows() throws IOException {
        Path f = tmp.resolve("doc.txt");
        Files.writeString(f, "x");

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr(f.toString(), "video")));
        assertTrue(ex.getMessage().contains("kind") || ex.getMessage().contains("video"),
                "错误信息应说明 kind 非法");
    }

    @Test
    void imageWithUnsupportedExtensionThrows() throws IOException {
        Path f = tmp.resolve("file.bmp");
        Files.write(f, new byte[]{0x42, 0x4D});

        IOException ex = assertThrows(IOException.class,
                () -> TurnAttachments.resolve(arr(f.toString(), "image")));
        assertTrue(ex.getMessage().contains("bmp") || ex.getMessage().contains("file.bmp"),
                "错误信息应含扩展名或文件名");
    }
}
