import { describe, expect, it } from "vitest";
import { handleRequest, renderTrustedHandoffPage } from "./index.js";

describe("trusted handoff worker", () => {
  it("serves only the static handoff page with restrictive headers", async () => {
    const response = handleRequest(
      new Request(
        "https://handoff.example/s/abcdefghijklmnopqrstuvwx?relay=https%3A%2F%2Frelay.example",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    await expect(response.text()).resolves.toContain(
      "Open shared agent context",
    );

    const missing = handleRequest(new Request("https://handoff.example/"));
    expect(missing.status).toBe(404);
  });

  it("requires an explicit relay origin and never sends the fragment key", () => {
    const html = renderTrustedHandoffPage();

    expect(html).toContain('original.searchParams.get("relay")');
    expect(html).toContain("validateRelayOrigin(relayValue)");
    expect(html).toContain('history.replaceState(null, "", original.pathname)');
    expect(html).toContain(
      'fetch(relayOrigin + "/v1/shares/" + encodeURIComponent(shareId) + "/meta"',
    );
    expect(html).not.toContain("fetch(original.origin");
    expect(html).not.toMatch(/fetch\([^)]*fragmentKey/u);
    expect(html).toContain("agentshare-0.1.10.tgz");
  });
});
