import { describe, expect, it } from "vitest";
import {
  defaultShareSelection,
  moveSelection,
  selectionToShareOptions,
} from "./share-flow.js";

describe("creator share TUI state", () => {
  it("defaults to conversation plus project, read plus propose, and 24 hours", () => {
    const selection = defaultShareSelection();
    expect(selection).toEqual({ scope: 0, access: 0, expiry: 1 });
    expect(selectionToShareOptions(selection)).toEqual({
      includeConversation: true,
      includeWorkspace: true,
      proposalsEnabled: true,
      ttlSeconds: 86400,
    });
  });

  it("wraps arrow selection without requiring typed values", () => {
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(1, 1, 3)).toBe(2);
  });

  it("maps alternate choices to explicit share options", () => {
    expect(
      selectionToShareOptions({ scope: 1, access: 1, expiry: 0 }),
    ).toEqual({
      includeConversation: true,
      includeWorkspace: false,
      proposalsEnabled: false,
      ttlSeconds: 3600,
    });
    expect(
      selectionToShareOptions({ scope: 2, access: 0, expiry: 2 }),
    ).toEqual({
      includeConversation: false,
      includeWorkspace: true,
      proposalsEnabled: true,
      ttlSeconds: 259200,
    });
  });
});
