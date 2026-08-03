package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「未配置」提示里的两个检测。纯函数入口全部注入 PATH 字符串与平台标记，
 * 不查本机真实 PATH；端口检测只连本进程起的 ServerSocket，不出机器。
 */
class SearchDetectionTest {

    @Test
    @DisplayName("PATH 里某一段下有可执行的 docker 就算有")
    void findsDockerOnPath(@TempDir Path dir) throws IOException {
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Path docker = Files.createFile(bin.resolve("docker"));
        docker.toFile().setExecutable(true);

        assertTrue(SearchDetection.dockerOnPath(bin.toString(), ":", false));
    }

    @Test
    @DisplayName("PATH 多段时逐段找")
    void scansEveryPathSegment(@TempDir Path dir) throws IOException {
        Path empty = Files.createDirectories(dir.resolve("empty"));
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Path docker = Files.createFile(bin.resolve("docker"));
        docker.toFile().setExecutable(true);

        String path = String.join(":", empty.toString(), bin.toString());
        assertTrue(SearchDetection.dockerOnPath(path, ":", false));
    }

    @Test
    @DisplayName("PATH 为空 / null / 没有 docker 时是 false")
    void noDockerMeansFalse(@TempDir Path dir) throws IOException {
        Path empty = Files.createDirectories(dir.resolve("empty"));

        assertFalse(SearchDetection.dockerOnPath(empty.toString(), ":", false));
        assertFalse(SearchDetection.dockerOnPath("", ":", false));
        assertFalse(SearchDetection.dockerOnPath(null, ":", false));
    }

    @Test
    @DisplayName("Windows 上找 docker.exe，且分隔符是分号")
    void windowsLooksForDockerExe(@TempDir Path dir) throws IOException {
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Files.createFile(bin.resolve("docker.exe"));

        assertTrue(SearchDetection.dockerOnPath(bin.toString(), ";", true),
                "Windows 分支该找 docker.exe");
        assertFalse(SearchDetection.dockerOnPath(bin.toString(), ":", false),
                "非 Windows 分支只找无后缀的 docker,docker.exe 不算");
    }

    @Test
    @DisplayName("不存在的 PATH 段不该抛异常")
    void nonExistentPathSegmentIsIgnored() {
        assertFalse(SearchDetection.dockerOnPath("/no/such/dir/anywhere", ":", false));
    }

    @Test
    @DisplayName("有人在听就是 true")
    void detectsListeningPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            int port = socket.getLocalPort();
            assertTrue(SearchDetection.portListening("127.0.0.1", port, 300));
        }
    }

    @Test
    @DisplayName("没人听时在超时内返回 false（不挂住调用方）")
    void unusedPortReturnsFalseQuickly() throws IOException {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        } // 关掉,于是这个端口没人听

        long start = System.nanoTime();
        assertFalse(SearchDetection.portListening("127.0.0.1", port, 300));
        long elapsedMillis = (System.nanoTime() - start) / 1_000_000;
        assertTrue(elapsedMillis < 3_000,
                "一句提示不能把 agent 卡住,实测耗时 " + elapsedMillis + "ms");
    }
}
