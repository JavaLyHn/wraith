package com.lyhn.wraith.gateway.qq;
public record InboundMsg(String openid, String text, String msgId, long ts) {}
