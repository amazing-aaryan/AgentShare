import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import * as launchers from "./launchers.js";

describe("target process lifecycle", () => {
  it("waits for close so inherited stdout is fully drained", async () => {
    const waitForTargetClose = Reflect.get(
      launchers,
      "waitForTargetClose",
    ) as unknown;
    expect(waitForTargetClose).toBeTypeOf("function");
    if (typeof waitForTargetClose !== "function") return;

    const child = new EventEmitter();
    let settled = false;
    const result = Reflect.apply(waitForTargetClose, undefined, [child]).then(
      (exitCode: number) => {
        settled = true;
        return exitCode;
      },
    );
    child.emit("exit", 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", 0);
    await expect(result).resolves.toBe(0);
  });
});
