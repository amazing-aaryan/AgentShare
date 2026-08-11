export function renderSharePage(): string {
  const cliCommand =
    "npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.4/agentshare-0.1.4.tgz -- agentshare open --target ";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>AgentShare</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18181b; background: #f7f7f5; letter-spacing: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    header { height: 56px; display: flex; align-items: center; padding: 0 24px; color: #fff; background: #18181b; border-bottom: 3px solid #f05a3c; }
    .mark { width: 24px; height: 24px; margin-right: 10px; display: grid; place-items: center; background: #f05a3c; color: #fff; font: 800 13px/1 ui-monospace, monospace; border-radius: 4px; }
    .brand { font-size: 17px; font-weight: 700; }
    main { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
    h1 { margin: 0; font-size: 34px; line-height: 1.15; font-weight: 720; }
    .status { display: flex; align-items: center; gap: 8px; margin: 18px 0 36px; color: #52525b; font-size: 14px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #e0a126; }
    .dot.ready { background: #16865b; }
    .dot.error { background: #c0362c; }
    section { padding: 28px 0; border-top: 1px solid #d7d7d2; }
    h2 { margin: 0 0 16px; font-size: 15px; font-weight: 700; }
    .targets { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-bottom: 14px; }
    .target { min-height: 42px; border: 1px solid #b9b9b3; border-radius: 5px; background: #fff; color: #333337; font: inherit; cursor: pointer; }
    .target[aria-selected="true"] { border-color: #18181b; background: #18181b; color: #fff; }
    .command { min-height: 58px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 14px; padding: 10px 10px 10px 16px; border: 1px solid #b9b9b3; border-radius: 6px; background: #fff; }
    code { min-width: 0; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .copy { min-width: 112px; height: 38px; border: 0; border-radius: 4px; color: #fff; background: #f05a3c; font: 650 14px/1 inherit; cursor: pointer; }
    .copy-link { margin-top: 10px; color: #18181b; background: #e4e4df; }
    .manual-link { margin-top: 12px; }
    .manual-link[hidden] { display: none; }
    .manual-link label { display: block; margin-bottom: 6px; color: #52525b; font-size: 13px; }
    .manual-link input { width: 100%; padding: 10px; border: 1px solid #b9b9b3; border-radius: 4px; background: #fff; font: 13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .copy:disabled { color: #8a8a84; background: #ecece8; cursor: not-allowed; }
    .copy:focus-visible, .target:focus-visible { outline: 3px solid #4d8ee8; outline-offset: 2px; }
    .detail { display: grid; grid-template-columns: 120px 1fr; gap: 10px; margin: 0; font-size: 14px; }
    dt { color: #71717a; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .notice { margin-top: 14px; color: #52525b; font-size: 13px; line-height: 1.5; }
    @media (max-width: 520px) { main { padding-top: 32px; } h1 { font-size: 28px; } .targets { grid-template-columns: 1fr; } .detail { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 8px; } }
  </style>
</head>
<body>
  <header><span class="mark" aria-hidden="true">AS</span><span class="brand">AgentShare</span></header>
  <main>
    <h1>Agent context received</h1>
    <div class="status" role="status"><span class="dot" id="dot"></span><span id="status">Checking capability...</span></div>
    <section>
      <h2>Open with</h2>
      <div class="targets" role="tablist" aria-label="Target agent">
        <button class="target" role="tab" data-target="codex" aria-selected="true">Codex</button>
        <button class="target" role="tab" data-target="claude" aria-selected="false">Claude Code</button>
      </div>
      <div class="command"><code id="command">${cliCommand}codex</code><button class="copy" id="copy">Copy command</button></div>
      <button class="copy copy-link" id="copy-link" disabled>Copy secure link</button>
      <div class="manual-link" id="manual-link" hidden><label for="manual-link-value">Secure link</label><input id="manual-link-value" type="text" readonly></div>
      <div class="notice">Run the command, then paste the secure link at the hidden terminal prompt.</div>
    </section>
    <section>
      <h2>Share</h2>
      <dl class="detail"><dt>Source</dt><dd>Encrypted Agent Context Bundle</dd><dt>Expires</dt><dd id="expires">Loading...</dd><dt>Relay access</dt><dd>Ciphertext only</dd></dl>
    </section>
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
      let target = "codex";
      const command = document.getElementById("command");
      const copy = document.getElementById("copy");
      const copyLink = document.getElementById("copy-link");
      const manualLink = document.getElementById("manual-link");
      const manualLinkValue = document.getElementById("manual-link-value");
      const status = document.getElementById("status");
      const dot = document.getElementById("dot");
      const expires = document.getElementById("expires");
      const renderCommand = () => { command.textContent = ${JSON.stringify(cliCommand)} + target; };
      renderCommand();
      document.querySelectorAll(".target").forEach((button) => button.addEventListener("click", () => {
        target = button.dataset.target;
        document.querySelectorAll(".target").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
        renderCommand();
      }));
      const finishCopy = (button, idleText) => {
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = idleText; }, 1600);
      };
      const legacyCopy = (value) => {
        const input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        return copied;
      };
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(command.textContent);
          finishCopy(copy, "Copy command");
        } catch {
          if (legacyCopy(command.textContent)) finishCopy(copy, "Copy command");
          else copy.textContent = "Copy failed";
        }
      });
      copyLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(capabilityLink);
          finishCopy(copyLink, "Copy secure link");
        } catch {
          if (legacyCopy(capabilityLink)) {
            finishCopy(copyLink, "Copy secure link");
            return;
          }
          manualLink.hidden = false;
          manualLinkValue.value = capabilityLink;
          manualLinkValue.focus();
          manualLinkValue.select();
          copyLink.textContent = "Select secure link";
        }
      });
      if (!read || !key || !match) {
        status.textContent = "Invalid capability link";
        dot.className = "dot error";
        expires.textContent = "Unavailable";
        return;
      }
      copyLink.disabled = false;
      fetch("/v1/shares/" + encodeURIComponent(decodeURIComponent(match[1])) + "/meta", {
        headers: { authorization: "Bearer " + read }, cache: "no-store", credentials: "omit"
      }).then(async (response) => {
        if (!response.ok) throw new Error("Share unavailable");
        const body = await response.json();
        status.textContent = "Ready for secure handoff";
        dot.className = "dot ready";
        expires.textContent = new Date(body.metadata.expiresAt).toLocaleString();
      }).catch(() => {
        status.textContent = "Share unavailable or expired";
        dot.className = "dot error";
        expires.textContent = "Unavailable";
      });
    })();
  </script>
</body>
</html>`;
}
