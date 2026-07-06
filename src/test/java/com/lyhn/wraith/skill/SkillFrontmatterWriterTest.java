package com.lyhn.wraith.skill;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class SkillFrontmatterWriterTest {

    private SkillFrontmatterParser.ParseResult roundTrip(
            String name, String desc, String version, String author, List<String> tags, String body) {
        String md = SkillFrontmatterWriter.serialize(name, desc, version, author, tags, body);
        return SkillFrontmatterParser.parse(md);
    }

    @Test void roundTripsAllFields() {
        var r = roundTrip("web-access", "联网访问手册", "1.0.0", "Wraith CLI",
                List.of("web", "browser"), "# 正文\n步骤一\n");
        Map<String, Object> fm = r.frontmatter();
        assertEquals("web-access", fm.get("name"));
        assertEquals("联网访问手册", fm.get("description"));
        assertEquals("1.0.0", fm.get("version"));
        assertEquals("Wraith CLI", fm.get("author"));
        assertEquals(List.of("web", "browser"), fm.get("tags"));
        assertEquals("# 正文\n步骤一\n", r.body());
        assertTrue(r.warnings().isEmpty());
    }

    @Test void descriptionWithColonAndBracketsRoundTrips() {
        var r = roundTrip("x", "用法: 见 [文档] 和 a:b", null, null, List.of(), "body");
        assertEquals("用法: 见 [文档] 和 a:b", r.frontmatter().get("description"));
    }

    @Test void authorWithSpacesAndColonRoundTrips() {
        var r = roundTrip("x", "d", "2", "Team: Wraith", List.of(), "b");
        assertEquals("Team: Wraith", r.frontmatter().get("author"));
        assertEquals("2", r.frontmatter().get("version"));
    }

    @Test void emptyOptionalFieldsAreOmitted() {
        String md = SkillFrontmatterWriter.serialize("x", "d", null, "", List.of(), "b");
        assertFalse(md.contains("version:"));
        assertFalse(md.contains("author:"));
        assertFalse(md.contains("tags:"));
        var r = SkillFrontmatterParser.parse(md);
        assertNull(r.frontmatter().get("version"));
        assertNull(r.frontmatter().get("author"));
    }

    @Test void bodyPreservedExactly() {
        var r = roundTrip("x", "d", null, null, List.of(), "line1\nline2\n");
        assertEquals("line1\nline2\n", r.body());
    }
}
