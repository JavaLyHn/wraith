package com.lyhn.wraith.gateway;

/** deny-all:仅放行绑定得到的 owner openid。 */
public final class Authorizer {
    private final String ownerOpenid;
    public Authorizer(String ownerOpenid) { this.ownerOpenid = ownerOpenid; }
    public boolean isAllowed(String openid) {
        return ownerOpenid != null && !ownerOpenid.isEmpty() && ownerOpenid.equals(openid);
    }
}
