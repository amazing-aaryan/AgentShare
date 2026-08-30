import { bootstrapDocument, renderEnvironmentPage } from "@agentshare/web/v2";

const PUBLIC_RELEASE = "0.2.1";
const PUBLIC_PACKAGE =
  `https://github.com/amazing-aaryan/AgentShare/releases/download/v${PUBLIC_RELEASE}/` +
  `agentshare-${PUBLIC_RELEASE}.tgz`;

export default {
  fetch(request: Request): Promise<Response> | Response {
    return handleRequest(request);
  },
};

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }

  const environment =
    /^\/e\/([A-Za-z][A-Za-z0-9_-]{19,99})(?:\/(bootstrap\.json))?$/u.exec(
      url.pathname,
    );
  if (environment?.[1] !== undefined) {
    try {
      validateRelayOrigin(url.searchParams.get("relay"));
    } catch {
      return new Response("Invalid AgentShare relay origin", {
        status: 400,
        headers: staticSecurityHeaders(),
      });
    }
    if (environment[2] === "bootstrap.json") {
      return Response.json(bootstrapDocument(), {
        headers: {
          "cache-control": "public, max-age=300",
          "content-security-policy": "default-src 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        },
      });
    }
    return new Response(renderEnvironmentPage(environment[1]), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...staticSecurityHeaders(),
      },
    });
  }

  if (!/^\/s\/[^/]+$/u.test(url.pathname)) {
    return new Response("Not found", { status: 404 });
  }
  const relayValue = url.searchParams.get("relay");
  let relayOrigin: string;
  try {
    relayOrigin = validateRelayOrigin(relayValue);
  } catch {
    return new Response("Invalid AgentShare relay origin", {
      status: 400,
      headers: securityHeaders("'none'"),
    });
  }
  return new Response(renderTrustedHandoffPage(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...securityHeaders(relayOrigin),
    },
  });
}

function securityHeaders(connectOrigin: string): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      `connect-src ${connectOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function staticSecurityHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function validateRelayOrigin(value: string | null): string {
  if (value === null) throw new Error("Missing relay");
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Relay must use HTTPS except on loopback");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Relay must be an origin");
  }
  return url.origin;
}

export function renderTrustedHandoffPage(): string {
  const commandPrefix = `npm exec --yes --package=${PUBLIC_PACKAGE} -- agentshare open --target `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Open shared agent context · AgentShare</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 44px 0 72px; }
    h1 { margin: 0; font-size: clamp(30px, 6vw, 44px); line-height: 1.08; }
    .lede { max-width: 650px; color: GrayText; }
    .card { margin-top: 24px; padding: 20px; border: 1px solid GrayText; border-radius: 10px; }
    .status { font-weight: 700; }
    .targets { display: flex; gap: 8px; margin: 12px 0; }
    button { min-height: 44px; padding: 8px 14px; cursor: pointer; }
    button[aria-pressed="true"] { font-weight: 800; }
    code, input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .command { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; }
    input { width: 100%; min-height: 44px; }
    .manual[hidden] { display: none; }
    .risk { color: GrayText; font-size: 0.92rem; }
    @media (max-width: 560px) { .command { grid-template-columns: 1fr; } .targets { flex-direction: column; } }
  </style>
</head>
<body>
<main>
  <h1>Open shared agent context</h1>
  <p class="lede">This trusted AgentShare page never stores ciphertext or decryption keys. It verifies availability with the relay named in the link, then lets you copy the secure capability into the local AgentShare CLI.</p>

  <section class="card" aria-live="polite">
    <div class="status" id="status">Checking secure link…</div>
    <div id="detail">The relay receives only the read capability needed to check this share. The decryption key stays in the URL fragment on this page.</div>
  </section>

  <section class="card">
    <h2>1. Choose your local agent</h2>
    <div class="targets" role="group" aria-label="Choose target agent">
      <button type="button" data-target="codex" aria-pressed="true">Codex</button>
      <button type="button" data-target="claude" aria-pressed="false">Claude Code</button>
    </div>
    <p>Use a target version explicitly supported by AgentShare v${PUBLIC_RELEASE}. The CLI checks the version and isolation controls before asking for the secure link.</p>
  </section>

  <section class="card">
    <h2>2. Run AgentShare in a new terminal</h2>
    <div class="command"><code id="command">${commandPrefix}codex</code><button type="button" id="copy-command">Copy command</button></div>
  </section>

  <section class="card">
    <h2>3. Paste the secure link into the hidden prompt</h2>
    <button type="button" id="copy-link" disabled>Copy secure link</button>
    <div class="manual" id="manual" hidden>
      <label for="manual-value">Secure link</label>
      <input id="manual-value" readonly autocomplete="off" spellcheck="false">
    </div>
    <p class="risk">Treat the entire link as a bearer secret. Do not put it in shell history, tickets, screenshots, or another chat. Relevant decrypted excerpts are sent by your local Codex or Claude CLI to that provider under your account.</p>
  </section>
</main>
<script>
(() => {
  const original = new URL(location.href);
  const capabilityLink = original.toString();
  const relayValue = original.searchParams.get("relay");
  const fragment = new URLSearchParams(original.hash.slice(1));
  const readCapability = fragment.get("r");
  const fragmentKey = fragment.get("k");
  const match = /^\\/s\\/([^/]+)$/.exec(original.pathname);
  history.replaceState(null, "", original.pathname);

  const status = document.getElementById("status");
  const detail = document.getElementById("detail");
  const command = document.getElementById("command");
  const copyCommand = document.getElementById("copy-command");
  const copyLink = document.getElementById("copy-link");
  const manual = document.getElementById("manual");
  const manualValue = document.getElementById("manual-value");
  let target = "codex";

  const validateRelayOrigin = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
      if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return null;
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
      return url.origin;
    } catch {
      return null;
    }
  };

  const relayOrigin = validateRelayOrigin(relayValue);
  const shareId = match ? decodeURIComponent(match[1]) : null;
  if (!relayOrigin || !shareId || !readCapability || !fragmentKey) {
    status.textContent = "Invalid secure link";
    detail.textContent = "Stop here and ask the sender for a new AgentShare link.";
    return;
  }

  const renderTarget = () => {
    command.textContent = ${JSON.stringify(commandPrefix)} + target;
  };
  document.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      target = button.dataset.target;
      document.querySelectorAll("[data-target]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderTarget();
    });
  });

  const copyText = async (value, fallback) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      fallback();
    }
  };
  copyCommand.addEventListener("click", () => copyText(command.textContent, () => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(command);
    selection.removeAllRanges();
    selection.addRange(range);
  }));
  copyLink.addEventListener("click", () => copyText(capabilityLink, () => {
    manual.hidden = false;
    manualValue.value = capabilityLink;
    manualValue.focus();
    manualValue.select();
  }));

  fetch(relayOrigin + "/v1/shares/" + encodeURIComponent(shareId) + "/meta", {
    headers: { authorization: "Bearer " + readCapability },
    cache: "no-store",
    credentials: "omit"
  }).then(async (response) => {
    if (!response.ok) throw new Error("Share unavailable");
    const body = await response.json();
    const expiry = Date.parse(body?.metadata?.expiresAt);
    if (body?.status !== "available" || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("Share unavailable");
    status.textContent = "Secure link ready";
    detail.textContent = "Available until " + new Date(expiry).toLocaleString() + ". Run the command, then paste the secure link only into the hidden AgentShare prompt.";
    copyLink.disabled = false;
  }).catch(() => {
    status.textContent = "Share unavailable or expired";
    detail.textContent = "Ask the sender for a new AgentShare link.";
    copyLink.disabled = true;
  });
})();
</script>
</body>
</html>`;
}
