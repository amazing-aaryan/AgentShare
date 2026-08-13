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
      "agentshare-0.1.9.tgz -- agentshare open --target codex",
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

  it("walks the recipient through the complete handoff in order", () => {
    const html = renderSharePage();
    const steps = [
      "Choose the agent on this computer",
      "Copy and run this command in a new terminal",
      "Copy the secure link into the hidden prompt",
      "Review the summary, then ask questions",
    ];

    let previous = -1;
    for (const step of steps) {
      const position = html.indexOf(step);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(html).toContain("Node.js 22 or newer");
    expect(html).toContain("AgentShare link:");
    expect(html).toContain("agentshare&gt;");
    expect(html).toContain("/exit");
    expect(html).toContain("checks the selected CLI before requesting");
    expect(html).toContain("stops before requesting the secure link");
  });

  it("explains version recovery and material security risks", () => {
    const html = renderSharePage();
    expect(html).toContain("Know the risks before continuing");
    expect(html).toContain("The link is a bearer secret");
    expect(html).toContain("Relevant plaintext reaches your model provider");
    expect(html).toContain("Shared content may be wrong or hostile");
    expect(html).toContain("Endpoint compromise defeats local protections");
    expect(html).toContain("Expiry limits time, not prior disclosure");
    expect(html).toContain("Version not supported");
    expect(html).toContain("Do not bypass the check");
    expect(html).toContain(
      "recent questions and answers from this local session",
    );
    expect(html).toContain(
      "retrieved excerpts, your questions, and recent answers",
    );
    expect(html).toContain("0.145.0");
    expect(html).toContain("0.147.0");
    expect(html).toContain("2.1.210");
    expect(html).toContain("2.1.231");
  });

  it("uses operable target controls and announces dynamic feedback", () => {
    const html = renderSharePage();
    expect(html).toContain('role="group" aria-label="Choose target agent"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain(
      'id="copy-feedback" role="status" aria-live="polite"',
    );
    expect(html).toContain('type="button" id="copy"');
    expect(html).toContain('autocomplete="off" spellcheck="false"');
  });

  it("unlocks secret copying only after share metadata validates", () => {
    const html = renderSharePage();
    const fetchStart = html.indexOf('fetch("/v1/shares/"');
    const successfulValidation = html.indexOf(
      "copyLink.disabled = false;",
      fetchStart,
    );
    const failedValidation = html.indexOf(
      "copyLink.disabled = true;",
      successfulValidation,
    );

    expect(html).toContain('id="copy-link" disabled');
    expect(fetchStart).toBeGreaterThan(-1);
    expect(html).toContain('body?.status !== "available"');
    expect(html).toContain("expiry <= Date.now()");
    expect(successfulValidation).toBeGreaterThan(fetchStart);
    expect(failedValidation).toBeGreaterThan(successfulValidation);
  });
});
