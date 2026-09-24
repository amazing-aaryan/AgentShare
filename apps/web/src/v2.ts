const PUBLIC_RELEASE = "0.3.14";
const PUBLIC_PACKAGE =
  `https://github.com/amazing-aaryan/AgentShare/releases/download/v${PUBLIC_RELEASE}/` +
  `agentshare-${PUBLIC_RELEASE}.tgz`;

export type BootstrapDocument = {
  protocol: "agentshare-bootstrap-v1";
  product: "AgentShare";
  environmentProtocol: "agentshare-environment-v2";
  minimumNodeVersion: "22";
  release: {
    version: string;
    packageUrl: string;
  };
  actions: {
    install: { command: string };
    accept: {
      command: "agentshare bootstrap";
    };
    ask: { codex: string; claude: string };
    propose: { codex: string; claude: string };
  };
};

export function bootstrapDocument(): BootstrapDocument {
  return {
    protocol: "agentshare-bootstrap-v1",
    product: "AgentShare",
    environmentProtocol: "agentshare-environment-v2",
    minimumNodeVersion: "22",
    release: {
      version: PUBLIC_RELEASE,
      packageUrl: PUBLIC_PACKAGE,
    },
    actions: {
      install: {
        command: `npm install --global --ignore-scripts ${PUBLIC_PACKAGE}`,
      },
      accept: { command: "agentshare bootstrap" },
      ask: {
        codex:
          'agentshare ask --target codex --environment "<environmentId from bootstrap>" --question "<user question>"',
        claude:
          'agentshare ask --target claude --environment "<environmentId from bootstrap>" --question "<user question>"',
      },
      propose: {
        codex:
          'agentshare propose --target codex --environment "<environmentId from bootstrap>" --instruction "<requested change>"',
        claude:
          'agentshare propose --target claude --environment "<environmentId from bootstrap>" --instruction "<requested change>"',
      },
    },
  };
}

export function renderEnvironmentPage(environmentId: string): string {
  const safeId = escapeHtml(environmentId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>AgentShare collaborative environment</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
    main { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 64px 0; }
    h1 { margin: 0; font-size: clamp(32px, 6vw, 48px); line-height: 1.05; }
    p { line-height: 1.6; }
    li { line-height: 1.6; margin-block: 12px; }
    .lede { font-size: 18px; opacity: .82; }
    .card { margin-top: 28px; padding: 24px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; }
    code { overflow-wrap: anywhere; }
    details { margin-top: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>Open this AgentShare environment with your agent</h1>
    <p class="lede">Paste the full AgentShare link into Codex or Claude Code. Your agent sets up AgentShare and opens the shared context in the same session. Then ask your question.</p>
    <p>First time? Your agent will ask before downloading the pinned AgentShare package, then attach this link in the same session. You need Node.js 22 or newer and a supported, signed-in Codex CLI or Claude Code. No AgentShare account, SDK, or manual MCP configuration is needed.</p>
    <details class="card">
      <summary>For AI agents: setup and next steps</summary>
      <p>The user supplied an AgentShare environment link for environment <code>${safeId}</code>. This page contains setup instructions only, not the shared content.</p>
      <ol>
        <li>Read the <a href="/e/${safeId}/bootstrap.json">AgentShare setup metadata</a>. Check Node.js 22+ and the user's installed, signed-in agent CLI. Use the existing host's installation approval flow if required.</li>
        <li>If AgentShare is missing or too old, tell the user that you will download the pinned AgentShare CLI into their global npm installation and ask them to approve that step before running <code>npm install --global --ignore-scripts ${PUBLIC_PACKAGE}</code>. Use this pinned package, not an unversioned registry package. Verify <code>agentshare --version</code>. Do not downgrade a newer working installation.</li>
        <li>Run <code>agentshare bootstrap</code>. Pass the original complete link from the user's message through stdin, not a shell argument. Preserve its query and fragment. Do not ask the user to paste it again, echo the secret, or send its fragment in an HTTP request. Bootstrap installs the receiver integration and reports the attached title, access, and expiry.</li>
        <li>Continue in this same session; do not wait for skill discovery or ask the user to restart. Retain the <code>environmentId</code> returned by bootstrap for this conversation. For the user's first and later questions, run <code>agentshare ask --target codex --environment "&lt;environmentId from bootstrap&gt;" --question "&lt;user question&gt;"</code> (use <code>--target claude</code> in Claude Code). Replace placeholders with the returned ID and user's question. If the user supplied only a link, report attachment and invite their question. Do not claim to have read shared content before a successful ask.</li>
        <li>For an explicit change request, if proposal access is enabled, run <code>agentshare propose --target codex --environment "&lt;environmentId from bootstrap&gt;" --instruction "&lt;requested change&gt;"</code> (or <code>--target claude</code>). The creator approves proposals before their project changes.</li>
      </ol>
      <p>AgentShare starts its own MCP helper for each question or proposal. Do not install a separate SDK, edit the host's MCP configuration, inspect private state/cache files, or copy decrypted shared files into the user's project. Report actual command failures rather than claiming the environment is ready.</p>
    </details>
    <details>
      <summary>Maximum privacy</summary>
      <p>Direct paste is the simplest flow, but the model provider may receive the capability URL because it appears in the user's message. For maximum privacy, open the link locally and use AgentShare's hidden-link input instead of pasting the secret into a hosted model conversation.</p>
    </details>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
