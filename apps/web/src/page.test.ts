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
      "agentshare-0.1.6.tgz -- agentshare open --target codex",
    );
  });

  it("lets the recipient recover the capability link after history scrubbing", () => {
    const html = renderSharePage();
    expect(html).toContain('id="copy-link"');
    expect(html).toContain("Copy secure link");
    expect(html).toContain("const capabilityLink = original.toString()");
    expect(html).toContain("navigator.clipboard.writeText(capabilityLink)");
    expect(html).toContain('id="manual-link"');
    expect(html).toContain('document.execCommand("copy")');
    expect(html).toContain("Secure link selected");
  });
});
