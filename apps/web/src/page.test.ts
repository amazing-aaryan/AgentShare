import { describe, expect, it } from "vitest";
import { renderSharePage } from "./index.js";

describe("share page", () => {
  it("is self-contained and strips capability history", () => {
    const html = renderSharePage();
    expect(html).toContain('history.replaceState(null, "", original.pathname)');
    expect(html).not.toMatch(
      /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//u,
    );
    expect(html).not.toContain("analytics");
    expect(html).toContain(
      "agentshare-0.1.2.tgz -- agentshare open --target codex",
    );
  });
});
