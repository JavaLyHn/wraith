package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.PrintStream;
import java.io.ByteArrayOutputStream;
import java.io.StringReader;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlainRendererPromptChoiceTest {

    @Test
    void promptChoiceReturnsSelectedIndex() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("2\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);
        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
                "选择方案",
                List.of(new ChoiceOption("A", "desc A"), new ChoiceOption("B", "desc B")),
                true, null
        ));
        assertEquals(1, result.selectedIndex());
        assertFalse(result.isCancelled());
    }

    @Test
    void promptChoiceReturnsCancelledOnEmptyInput() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);
        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
                "选择",
                List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)),
                true, null
        ));
        assertTrue(result.isCancelled());
    }

    @Test
    void promptChoiceReturnsCancelledOnInvalidNumber() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("abc\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);
        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
                "选择",
                List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)),
                true, null
        ));
        assertTrue(result.isCancelled());
    }

    @Test
    void promptChoiceReturnsCancelledForEmptyOptions() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader(""));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);
        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
                "选择", List.of(), true, null
        ));
        assertTrue(result.isCancelled());
    }

    @Test
    void promptChoicePrintsDescriptionWhenPresent() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("1\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);
        renderer.promptChoice(new ChoiceRequest(
                "选择",
                List.of(new ChoiceOption("A", "描述A"), new ChoiceOption("B", null)),
                true, null
        ));
        String output = baos.toString();
        assertTrue(output.contains("描述A"));
    }
}
