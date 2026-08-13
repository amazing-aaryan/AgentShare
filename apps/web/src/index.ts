const PUBLIC_RELEASE = "0.1.9";
const PUBLIC_PACKAGE =
  `https://github.com/amazing-aaryan/AgentShare/releases/download/v${PUBLIC_RELEASE}/` +
  `agentshare-${PUBLIC_RELEASE}.tgz`;

const TARGET_PROFILES = {
  codex: {
    name: "Codex CLI",
    reviewed: "0.145.0, 0.146.0, or 0.147.0",
    versionCommand: "codex --version",
  },
  claude: {
    name: "Claude Code",
    reviewed: "any published 2.1.210–2.1.231 except 2.1.230",
    versionCommand: "claude --version",
  },
} as const;

export function renderSharePage(): string {
  const cliCommand = `npm exec --yes --package=${PUBLIC_PACKAGE} -- agentshare open --target `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Open secure agent context · AgentShare</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18181b; background: #f7f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; line-height: 1.55; }
    header { min-height: 56px; display: flex; align-items: center; padding: 10px 24px; color: #fff; background: #18181b; border-bottom: 3px solid #f05a3c; }
    .mark { width: 26px; height: 26px; margin-right: 10px; display: grid; place-items: center; background: #f05a3c; color: #fff; font: 800 13px/1 ui-monospace, monospace; border-radius: 4px; }
    .brand { font-size: 17px; font-weight: 750; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
    h1 { max-width: 650px; margin: 0; font-size: clamp(30px, 5vw, 42px); line-height: 1.1; letter-spacing: -0.025em; }
    .lede { max-width: 650px; margin: 14px 0 0; color: #52525b; font-size: 16px; }
    .status-box { display: grid; grid-template-columns: auto 1fr; gap: 10px; margin: 26px 0 34px; padding: 14px 16px; border: 1px solid #d7d7d2; border-radius: 7px; background: #fff; }
    .dot { width: 10px; height: 10px; margin-top: 7px; border-radius: 50%; background: #e0a126; }
    .dot.ready { background: #16865b; }
    .dot.error { background: #c0362c; }
    .status-title { display: block; font-weight: 700; }
    .status-help { display: block; margin-top: 2px; color: #606068; font-size: 13px; }
    .steps { counter-reset: handoff-step; }
    .step-card { position: relative; padding: 28px 0 30px 54px; border-top: 1px solid #d7d7d2; }
    .step-card::before { counter-increment: handoff-step; content: counter(handoff-step); position: absolute; top: 27px; left: 0; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #18181b; font-weight: 750; }
    h2 { margin: 0 0 8px; font-size: 19px; line-height: 1.3; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    p { margin: 0; }
    .instruction { margin-bottom: 16px; color: #52525b; }
    .targets { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-bottom: 14px; }
    .target { min-height: 48px; border: 1px solid #a8a8a1; border-radius: 6px; background: #fff; color: #333337; font: 650 15px/1 inherit; cursor: pointer; }
    .target[aria-pressed="true"] { border-color: #18181b; background: #18181b; color: #fff; }
    .compatibility { padding: 14px 16px; border-left: 4px solid #e0a126; background: #fff8e8; font-size: 14px; }
    .compatibility p + p { margin-top: 5px; }
    .inline-code { display: inline; padding: 2px 5px; border-radius: 3px; background: #ecece8; }
    .command { min-height: 64px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 10px 10px 10px 16px; border: 1px solid #a8a8a1; border-radius: 6px; background: #fff; }
    code { min-width: 0; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .copy { min-width: 116px; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 5px; color: #fff; background: #d8482c; font: 700 14px/1.2 inherit; cursor: pointer; }
    .copy-link { margin-top: 12px; color: #18181b; background: #deded8; }
    .copy:disabled { color: #71716b; background: #e8e8e3; cursor: not-allowed; }
    .copy:focus-visible, .target:focus-visible, summary:focus-visible, input:focus-visible { outline: 3px solid #2563b8; outline-offset: 3px; }
    .manual-link { margin-top: 12px; }
    .manual-link[hidden] { display: none; }
    .manual-link label { display: block; margin-bottom: 6px; color: #52525b; font-size: 13px; }
    .manual-link input { width: 100%; min-height: 44px; padding: 10px; border: 1px solid #a8a8a1; border-radius: 4px; background: #fff; font: 13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .notice { margin-top: 12px; color: #52525b; font-size: 13px; }
    .terminal-flow { margin: 14px 0 0; padding-left: 20px; }
    .terminal-flow li + li { margin-top: 7px; }
    .share-detail { padding: 24px 0; border-top: 1px solid #d7d7d2; }
    .detail { display: grid; grid-template-columns: 130px 1fr; gap: 9px; margin: 0; font-size: 14px; }
    dt { color: #6b6b74; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .risks { margin-top: 6px; padding: 24px; border: 1px solid #d8c7bd; border-radius: 8px; background: #fffaf6; }
    .risk-list { margin: 12px 0 0; padding-left: 20px; }
    .risk-list li + li { margin-top: 10px; }
    .risk-list strong { display: block; }
    .risk-list span { color: #52525b; font-size: 14px; }
    details { margin-top: 18px; border-top: 1px solid #dfd3ca; padding-top: 16px; }
    summary { min-height: 32px; display: flex; align-items: center; font-weight: 700; cursor: pointer; }
    .troubleshooting { margin: 12px 0 0; padding-left: 20px; font-size: 14px; }
    .troubleshooting li + li { margin-top: 8px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 560px) { main { padding-top: 32px; } .step-card { padding-left: 46px; } .targets, .command { grid-template-columns: 1fr; } .command .copy { width: 100%; } .detail { grid-template-columns: 1fr; gap: 2px; } dd { margin-bottom: 8px; } .risks { padding: 20px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <header><span class="mark" aria-hidden="true">AS</span><span class="brand">AgentShare</span></header>
  <main>
    <h1>Open shared agent context safely</h1>
    <p class="lede">Follow these steps in order. Context stays encrypted on the relay and decrypts on your device before a restricted Codex or Claude session answers questions.</p>
    <div class="status-box" role="status" aria-live="polite">
      <span class="dot" id="dot" aria-hidden="true"></span>
      <span><span class="status-title" id="status">Checking secure link…</span><span class="status-help" id="status-help">Verifying that this encrypted share still exists.</span></span>
    </div>

    <div class="steps" aria-label="Secure handoff steps">
      <section class="step-card">
        <h2>Choose the agent on this computer</h2>
        <p class="instruction">You need Node.js 22 or newer, plus an installed and signed-in target CLI.</p>
        <div class="targets" role="group" aria-label="Choose target agent">
          <button class="target" type="button" data-target="codex" aria-pressed="true">Codex</button>
          <button class="target" type="button" data-target="claude" aria-pressed="false">Claude Code</button>
        </div>
        <div class="compatibility" aria-live="polite">
          <p><strong id="host-name">Codex CLI</strong> must report reviewed version <strong id="reviewed-version">0.145.0, 0.146.0, or 0.147.0</strong> for public AgentShare v${PUBLIC_RELEASE}.</p>
          <p>Check first: <code class="inline-code" id="version-command">codex --version</code>. A newer AgentShare release may support more versions.</p>
        </div>
      </section>

      <section class="step-card">
        <h2>Copy and run this command in a new terminal</h2>
        <p class="instruction">Read the command, then run it. It downloads immutable AgentShare v${PUBLIC_RELEASE} and checks the selected CLI before requesting the secure link.</p>
        <div class="command"><code id="command">${cliCommand}codex</code><button class="copy" type="button" id="copy">Copy command</button></div>
        <p class="notice">If the version or required isolation controls are unsupported, AgentShare stops before requesting the secure link. Do not bypass this protection.</p>
      </section>

      <section class="step-card">
        <h2>Copy the secure link into the hidden prompt</h2>
        <p class="instruction">Wait for <code class="inline-code">AgentShare link:</code> in the terminal. Copy this link, paste it there, then press Enter. Input is hidden.</p>
        <button class="copy copy-link" type="button" id="copy-link" disabled>Copy secure link</button>
        <div class="manual-link" id="manual-link" hidden><label for="manual-link-value">Secure link—selected for manual copying</label><input id="manual-link-value" type="text" readonly autocomplete="off" spellcheck="false"></div>
        <p class="notice"><strong>Never</strong> add the secure link to the command, a chat message, ticket, screenshot, or public terminal history. Anyone holding it before expiry may retrieve the encrypted bundle and its decryption key.</p>
      </section>

      <section class="step-card">
        <h2>Review the summary, then ask questions</h2>
        <p class="instruction">AgentShare decrypts locally and shows the share title, source, and expiry.</p>
        <ol class="terminal-flow">
          <li>Confirm the displayed share is the one you expected.</li>
          <li>At <code class="inline-code">agentshare&gt;</code>, ask a focused question about the shared context.</li>
          <li>AgentShare sends relevant excerpts, your current question, and recent questions and answers from this local session to the selected model provider.</li>
          <li>Ask follow-ups as needed. Type <code class="inline-code">/exit</code> when finished.</li>
        </ol>
      </section>
    </div>

    <section class="share-detail" aria-labelledby="share-heading">
      <h2 id="share-heading">About this share</h2>
      <dl class="detail"><dt>Source</dt><dd>Encrypted Agent Context Bundle</dd><dt>Expires</dt><dd id="expires">Loading…</dd><dt>Relay access</dt><dd>Ciphertext and operational metadata only; no decryption key</dd></dl>
    </section>

    <section class="risks" aria-labelledby="risks-heading">
      <h2 id="risks-heading">Know the risks before continuing</h2>
      <ul class="risk-list">
        <li><strong>The link is a bearer secret.</strong><span> Anyone who obtains it before expiry may access the share. Clipboard managers, screenshots, browser extensions, shell history, and forwarded messages can leak it.</span></li>
        <li><strong>Relevant plaintext reaches your model provider.</strong><span> Decryption happens locally, but retrieved excerpts, your questions, and recent answers are sent through your signed-in Codex or Claude account under that provider’s terms.</span></li>
        <li><strong>Shared content may be wrong or hostile.</strong><span> AgentShare restricts recipient filesystem, tools, and network access, but you must still verify claims before acting on them.</span></li>
        <li><strong>Endpoint compromise defeats local protections.</strong><span> Malware, browser extensions, screen recording, or another person with access to this device may capture plaintext or the link.</span></li>
        <li><strong>Expiry limits time, not prior disclosure.</strong><span> Expiry or sender revocation blocks future retrieval; it cannot erase copies already viewed or retained by a model provider.</span></li>
      </ul>
      <details>
        <summary>Errors and recovery</summary>
        <ul class="troubleshooting">
          <li><strong>“Version not supported”:</strong> confirm <code class="inline-code" id="error-version-command">codex --version</code>. Install a version reviewed by the pinned AgentShare release, or use a newer AgentShare release that explicitly lists your version. Do not bypass the check.</li>
          <li><strong>“Share unavailable or expired”:</strong> reload once. If it remains unavailable, ask the sender for a new link.</li>
          <li><strong>Clipboard blocked:</strong> the secure-link field appears selected so you can use your system copy shortcut.</li>
          <li><strong>Unexpected title or source:</strong> type <code class="inline-code">/exit</code>, close the terminal, and verify the link with the sender through a separate channel.</li>
        </ul>
      </details>
    </section>
    <p class="sr-only" id="copy-feedback" role="status" aria-live="polite"></p>
  </main>
  <script>
    (() => {
      "use strict";
      const original = new URL(window.location.href);
      const capabilityLink = original.toString();
      const fragment = new URLSearchParams(original.hash.slice(1));
      const read = fragment.get("r") || original.searchParams.get("r");
      const key = fragment.get("k");
      const match = /^\\/s\\/([^/]+)$/.exec(original.pathname);
      history.replaceState(null, "", original.pathname);
      const profiles = ${JSON.stringify(TARGET_PROFILES)};
      let target = "codex";
      const command = document.getElementById("command");
      const copy = document.getElementById("copy");
      const copyLink = document.getElementById("copy-link");
      const manualLink = document.getElementById("manual-link");
      const manualLinkValue = document.getElementById("manual-link-value");
      const copyFeedback = document.getElementById("copy-feedback");
      const status = document.getElementById("status");
      const statusHelp = document.getElementById("status-help");
      const dot = document.getElementById("dot");
      const expires = document.getElementById("expires");
      const renderTarget = () => {
        const profile = profiles[target];
        command.textContent = ${JSON.stringify(cliCommand)} + target;
        document.getElementById("host-name").textContent = profile.name;
        document.getElementById("reviewed-version").textContent = profile.reviewed;
        document.getElementById("version-command").textContent = profile.versionCommand;
        document.getElementById("error-version-command").textContent = profile.versionCommand;
      };
      renderTarget();
      document.querySelectorAll(".target").forEach((button) => button.addEventListener("click", () => {
        target = button.dataset.target;
        document.querySelectorAll(".target").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        renderTarget();
      }));
      const announceCopy = (message) => { copyFeedback.textContent = ""; requestAnimationFrame(() => { copyFeedback.textContent = message; }); };
      const finishCopy = (button, idleText, message) => {
        button.textContent = "Copied";
        announceCopy(message);
        setTimeout(() => { button.textContent = idleText; }, 1600);
      };
      const selectCommand = () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(command);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("copy");
        copy.textContent = "Command selected";
        announceCopy("Command selected. Use your system copy shortcut if it was not copied.");
      };
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(command.textContent);
          finishCopy(copy, "Copy command", "Command copied.");
        } catch {
          selectCommand();
        }
      });
      copyLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(capabilityLink);
          finishCopy(copyLink, "Copy secure link", "Secure link copied. Paste it only into the hidden AgentShare prompt.");
        } catch {
          manualLink.hidden = false;
          manualLinkValue.value = capabilityLink;
          manualLinkValue.focus();
          manualLinkValue.select();
          document.execCommand("copy");
          copyLink.textContent = "Secure link selected";
          announceCopy("Secure link selected. Use your system copy shortcut, then paste it only into the hidden AgentShare prompt.");
        }
      });
      if (!read || !key || !match) {
        status.textContent = "Invalid secure link";
        statusHelp.textContent = "Stop here and ask the sender for a new AgentShare link.";
        dot.className = "dot error";
        expires.textContent = "Unavailable";
        return;
      }
      fetch("/v1/shares/" + encodeURIComponent(decodeURIComponent(match[1])) + "/meta", {
        headers: { authorization: "Bearer " + read }, cache: "no-store", credentials: "omit"
      }).then(async (response) => {
        if (!response.ok) throw new Error("Share unavailable");
        const body = await response.json();
        const expiry = Date.parse(body?.metadata?.expiresAt);
        if (body?.status !== "available" || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("Share unavailable");
        status.textContent = "Secure link ready";
        statusHelp.textContent = "Complete the four steps below in order.";
        dot.className = "dot ready";
        expires.textContent = new Date(expiry).toLocaleString();
        copyLink.disabled = false;
      }).catch(() => {
        status.textContent = "Share unavailable or expired";
        statusHelp.textContent = "Reload once, then ask the sender for a new link if this remains unavailable.";
        dot.className = "dot error";
        expires.textContent = "Unavailable";
        copyLink.disabled = true;
      });
    })();
  </script>
</body>
</html>`;
}
