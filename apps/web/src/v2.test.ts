import { describe, expect, it } from "vitest";
import { bootstrapDocument, renderEnvironmentPage } from "./v2.js";

describe("v2 environment handoff", () => {
  it("publishes machine-readable direct-paste bootstrap instructions", () => {
    const bootstrap = bootstrapDocument();
    expect(bootstrap.protocol).toBe("agentshare-bootstrap-v1");
    expect(bootstrap.environmentProtocol).toBe("agentshare-environment-v2");
    expect(bootstrap.minimumNodeVersion).toBe("22");
    expect(bootstrap.release.packageUrl).toContain("agentshare-0.2.0.tgz");
    expect(bootstrap.actions.accept.command).toBe("agentshare bootstrap");
  });

  it("tells recipients to paste the full link into their agent without reflecting secrets", () => {
    const html = renderEnvironmentPage("env_public_identifier");
    expect(html).toContain("Paste the full AgentShare link into Codex or Claude Code");
    expect(html).toContain("bootstrap.json");
    expect(html).toContain("Maximum privacy");
    expect(html).not.toContain("#r=");
    expect(html).not.toContain("#k=");
  });
});
