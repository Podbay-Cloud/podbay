import { describe, expect, it } from "vitest";
import { keydownToSeq, type KeyLike } from "../lib/term-keys";

const k = (over: Partial<KeyLike>): KeyLike => ({
  key: "",
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...over,
});

describe("keydownToSeq", () => {
  it("Shift+Enter and Alt+Enter insert a newline (ESC+CR), not submit", () => {
    expect(keydownToSeq(k({ key: "Enter", shiftKey: true }))).toBe("\x1b\r");
    expect(keydownToSeq(k({ key: "Enter", altKey: true }))).toBe("\x1b\r");
  });

  it("plain Enter submits (handled by xterm, not us)", () => {
    expect(keydownToSeq(k({ key: "Enter" }))).toBeNull();
  });

  it("Alt+Left/Right move by word", () => {
    expect(keydownToSeq(k({ key: "ArrowLeft", altKey: true }))).toBe("\x1bb");
    expect(keydownToSeq(k({ key: "ArrowRight", altKey: true }))).toBe("\x1bf");
  });

  it("Alt+Backspace deletes the previous word", () => {
    expect(keydownToSeq(k({ key: "Backspace", altKey: true }))).toBe("\x1b\x7f");
  });

  it("Cmd+Left/Right jump to line start/end (Ctrl-A/E)", () => {
    expect(keydownToSeq(k({ key: "ArrowLeft", metaKey: true }))).toBe("\x01");
    expect(keydownToSeq(k({ key: "ArrowRight", metaKey: true }))).toBe("\x05");
  });

  it("leaves plain arrows and letters to xterm", () => {
    expect(keydownToSeq(k({ key: "ArrowLeft" }))).toBeNull();
    expect(keydownToSeq(k({ key: "a" }))).toBeNull();
    expect(keydownToSeq(k({ key: "ArrowRight", ctrlKey: true }))).toBeNull();
  });
});
