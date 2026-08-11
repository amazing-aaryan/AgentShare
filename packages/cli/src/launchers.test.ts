import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { waitForTargetClose } from "./launchers.js";

describe("target process lifecycle", () => {
  it("waits for close so inherited stdout is fully drained", async () => {
    const child = new EventEmitter();
    let settled = false;
    const result = waitForTargetClose(child).then((exitCode) => {
      settled = true;
      return exitCode;
    });
    child.emit("exit", 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", 0);
    await expect(result).resolves.toBe(0);
  });
});
