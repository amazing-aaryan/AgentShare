import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "./terminal.js";

describe("terminal output safety", () => {
  it("neutralizes terminal and bidirectional control characters", () => {
    const hostile =
      "before\u001b]52;c;U0VDUkVU\u0007after\rforged\u009b31mred\u202espoof";

    const sanitized = sanitizeTerminalText(hostile);

    expect(sanitized).toBe("before]52;c;U0VDUkVUafterforged31mredspoof");
    expect(
      Array.from(sanitized).map((character) => character.codePointAt(0)),
    ).not.toEqual(expect.arrayContaining([0x1b, 0x07, 0x0d, 0x9b, 0x202e]));
  });

  it("preserves printable text, tabs, and newlines", () => {
    expect(sanitizeTerminalText("alpha\tbeta\ngamma")).toBe(
      "alpha\tbeta\ngamma",
    );
  });

  it("removes directional marks and deprecated bidi formatting controls", () => {
    expect(sanitizeTerminalText("a\u061cb\u200ec\u200fd\u206ae\u206ff")).toBe(
      "abcdef",
    );
  });
});
