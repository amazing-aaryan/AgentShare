import { beforeEach, describe, expect, it, vi } from "vitest";

const { readHiddenLineMock, verifyTargetMock } = vi.hoisted(() => ({
  readHiddenLineMock: vi.fn(),
  verifyTargetMock: vi.fn(),
}));

vi.mock("./launchers.js", () => ({
  runTarget: vi.fn(),
  verifyTarget: verifyTargetMock,
}));

vi.mock("./terminal.js", () => ({
  confirm: vi.fn(),
  readHiddenLine: readHiddenLineMock,
  sanitizeTerminalText: (value: string) => value,
}));

import { openCommand } from "./commands.js";

beforeEach(() => {
  readHiddenLineMock.mockReset();
  verifyTargetMock.mockReset();
});

describe("recipient startup", () => {
  it("checks target compatibility before asking for the capability link", async () => {
    verifyTargetMock.mockRejectedValueOnce(
      new Error("Unsupported claude version"),
    );

    await expect(openCommand("claude")).rejects.toThrow(
      "Unsupported claude version",
    );
    expect(verifyTargetMock).toHaveBeenCalledWith("claude");
    expect(readHiddenLineMock).not.toHaveBeenCalled();
  });
});
