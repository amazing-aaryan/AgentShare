import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "./terminal.js";

describe("terminal output safety", () => {
  it("neutralizes terminal and bidirectional control characters", () => {
    const hostile =
      "before\u001b]52;c;U0VDUkVU\u0007after\rforged\u009b31mred\u202espoof";

    const sanitized = sanitizeTerminalText(hostile);

    expect(sanitized).toBe("before]52;c;U0VDUkVUafterforged31mredspoof");
    expect(sanitized).not.toMatch(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
    );
  });

  it("preserves printable text, tabs, and newlines", () => {
    expect(sanitizeTerminalText("alpha\tbeta\ngamma")).toBe(
      "alpha\tbeta\ngamma",
    );
  });
});
