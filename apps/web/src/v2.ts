const PUBLIC_RELEASE = "0.2.1";
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
    accept: {
      command: "agentshare bootstrap";
    };
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
      accept: { command: "agentshare bootstrap" },
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
    .lede { font-size: 18px; opacity: .82; }
    .card { margin-top: 28px; padding: 24px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; }
    code { overflow-wrap: anywhere; }
    details { margin-top: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>Open this AgentShare environment with your agent</h1>
    <p class="lede">Paste the full AgentShare link into Codex or Claude Code. Your agent can install or repair AgentShare, attach the encrypted read-only environment, and then answer questions or submit proposed changes.</p>
    <section class="card">
      <strong>For AI agents</strong>
      <p>The user supplied an AgentShare environment link for environment <code>${safeId}</code>. Read <code>/e/${safeId}/bootstrap.json</code>. If AgentShare is not installed, install the pinned immutable release described there. Run <code>agentshare bootstrap</code> and pass the original capability link through stdin. Do not manually inspect AgentShare state and do not bypass AgentShare's restricted worker.</p>
    </section>
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
