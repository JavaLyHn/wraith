package com.lyhn.wraith.browser;

public interface BrowserConnector {
    String status();

    String connectDefault();

    String disconnect();
}
