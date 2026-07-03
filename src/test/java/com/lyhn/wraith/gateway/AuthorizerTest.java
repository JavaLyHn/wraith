package com.lyhn.wraith.gateway;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AuthorizerTest {
    @Test void ownerAllowedOthersDenied() {
        Authorizer a = new Authorizer("owner-123");
        assertTrue(a.isAllowed("owner-123"));
        assertFalse(a.isAllowed("someone-else"));
        assertFalse(a.isAllowed(null));
        assertFalse(a.isAllowed(""));
    }
    @Test void nullOwnerDeniesAll() {
        assertFalse(new Authorizer(null).isAllowed("anyone"));
    }
}
