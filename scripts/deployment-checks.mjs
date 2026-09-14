import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const REPOSITORY = "amazing-aaryan/AgentShare";
const MATRIX = ["ubuntu-latest", "macos-latest", "windows-latest"].flatMap(
  (os) => [22, 24].map((node) => `verify (${os}, ${node})`),
);

function requireThat(condition, message) {
  if (!condition) throw new Error(`Deployment check failed: ${message}`);
}

export function requireHttpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    /* Rejected below without echoing input. */
  }
  requireThat(
    url?.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      value === url.origin,
    "a bare, credential-free HTTPS origin is required",
  );
  return url.origin;
}

export function validateDeploymentInputs(input) {
  requireThat(
    /^[a-f0-9]{40}$/u.test(input.sha ?? ""),
    "full candidate SHA required",
  );
  requireThat(
    /^[a-f0-9]{64}$/u.test(input.digest ?? ""),
    "full package SHA-256 required",
  );
  requireThat(
    Number.isSafeInteger(input.sizeBytes) &&
      input.sizeBytes > 0 &&
      input.sizeBytes <= MAX_PACKAGE_BYTES,
    "package size must be 1 byte to 20 MiB",
  );
  requireThat(
    /^\d+\.\d+\.\d+$/u.test(input.version ?? ""),
    "an exact release version is required",
  );
  requireThat(input.repo === REPOSITORY, "unexpected repository");
  requireThat(
    input.packageUrl ===
      `https://github.com/${REPOSITORY}/releases/download/v${input.version}/agentshare-${input.version}.tgz`,
    "unexpected package URL",
  );
  requireHttpsOrigin(input.relay);
  requireHttpsOrigin(input.handoff);
  requireThat(
    input.relay !== input.handoff,
    "relay and handoff origins must differ",
  );
  return input;
}

export function selectCandidateCi(runs, sha) {
  const matching = runs
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.event === "push" &&
        run.path === ".github/workflows/ci.yml",
    )
    .sort((a, b) => b.run_number - a.run_number);
  const run = matching[0];
  requireThat(
    run?.status === "completed" && run.conclusion === "success",
    "latest candidate push CI must have succeeded",
  );
  return run;
}

export function validateCandidateJobs(jobs) {
  requireThat(
    isDeepStrictEqual(jobs.map((job) => job.name).sort(), [...MATRIX].sort()),
    "all six CI matrix jobs are required exactly once",
  );
  requireThat(
    jobs.every(
      (job) => job.status === "completed" && job.conclusion === "success",
    ),
    "CI jobs must pass without skips or cancellations",
  );
}

export function validateProductionEnvironment(environment, policies) {
  requireThat(
    environment.name === "production" &&
      environment.protection_rules?.some(
        (rule) =>
          rule.type === "required_reviewers" && rule.reviewers?.length > 0,
      ),
    "production must have at least one required human reviewer",
  );
  requireThat(
    environment.deployment_branch_policy?.custom_branch_policies === true &&
      policies.length === 1 &&
      policies[0]?.name === "master" &&
      policies[0]?.type === "branch",
    "production must allow only the master branch, not tags or wildcard branches",
  );
}

export function validateStagedRelease(release, tagCommit, expected) {
  requireThat(
    release.tag_name === `v${expected.version}` &&
      release.draft === false &&
      release.immutable === true,
    "the exact release must be published and immutable (prerelease is allowed)",
  );
  requireThat(
    tagCommit === expected.sha,
    "release tag must resolve to the exact candidate commit",
  );
  const assets = release.assets.filter(
    (asset) => asset.name === `agentshare-${expected.version}.tgz`,
  );
  requireThat(
    assets.length === 1,
    "exactly one matching package asset is required",
  );
  const asset = assets[0];
  requireThat(
    asset.state === "uploaded" &&
      asset.size === expected.sizeBytes &&
      asset.digest === `sha256:${expected.digest}` &&
      asset.browser_download_url === expected.packageUrl,
    "staged package metadata differs from the independently recorded pin",
  );
  return asset.browser_download_url;
}

export function validatePackageBytes(bytes, expected) {
  requireThat(
    bytes.length === expected.sizeBytes &&
      createHash("sha256").update(bytes).digest("hex") === expected.digest,
    "downloaded package size or SHA-256 mismatch",
  );
}

/** Bounded GET/OPTIONS only. Error messages deliberately omit URLs, bodies and headers. */
export async function readBoundedResponse(
  url,
  {
    fetcher = fetch,
    method = "GET",
    headers = {},
    maxBytes = 2 * 1024 * 1024,
    timeoutMs = 15_000,
    allowRedirect = false,
  } = {},
) {
  requireThat(
    ["GET", "OPTIONS"].includes(method),
    "read-only HTTP method required",
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Deployment request timed out")),
    timeoutMs,
  );
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    if (allowRedirect && [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      return { response, bytes: Buffer.alloc(0) };
    }
    requireThat(response.ok, `HTTP status ${response.status}`);
    const declared = response.headers.get("content-length");
    requireThat(
      declared === null ||
        (/^\d+$/u.test(declared) && Number(declared) <= maxBytes),
      "response too large",
    );
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.length;
        requireThat(size <= maxBytes, "response too large");
        chunks.push(chunk);
      }
    }
    return { response, bytes: Buffer.concat(chunks, size) };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
}

/** No GitHub authorization token is ever sent to an asset or redirect destination. */
export async function downloadPackage(url, { fetcher = fetch } = {}) {
  const allowed = new Set([
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
  ]);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const target = new URL(url);
    requireThat(
      target.protocol === "https:" &&
        !target.username &&
        !target.password &&
        !target.hash &&
        allowed.has(target.hostname),
      "untrusted package download destination",
    );
    const { response, bytes } = await readBoundedResponse(target.href, {
      fetcher,
      maxBytes: MAX_PACKAGE_BYTES,
      allowRedirect: true,
    });
    if (response.ok) return bytes;
    const location = response.headers.get("location");
    requireThat(location, "asset redirect is missing its destination");
    url = new URL(location, target).href;
  }
  throw new Error("Deployment check failed: too many package redirects");
}

function securityHeaders(response, { cache, html = false }) {
  for (const [name, value] of Object.entries({
    "cache-control": cache,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  }))
    requireThat(
      response.headers.get(name) === value,
      `incorrect ${name} header`,
    );
  if (html)
    requireThat(
      response.headers.get("content-type")?.startsWith("text/html"),
      "HTML content type missing",
    );
  const csp = response.headers.get("content-security-policy") ?? "";
  const directives = new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/u);
      return [name, values.join(" ")];
    }),
  );
  requireThat(
    directives.get("default-src") === "'none'",
    "restrictive default CSP missing",
  );
  if (html)
    for (const name of ["base-uri", "form-action", "frame-ancestors"])
      requireThat(
        directives.get(name) === "'none'",
        `restrictive ${name} CSP missing`,
      );
  return directives;
}

/** No capability secrets or stored content are sent, created, changed or revoked. */
export async function smokeDeployment({
  relay,
  handoff,
  bootstrap,
  fetcher = fetch,
}) {
  requireHttpsOrigin(relay);
  requireHttpsOrigin(handoff);
  requireThat(relay !== handoff, "relay and handoff origins must differ");
  const id = `e${randomUUID().replaceAll("-", "")}`;
  const query = `?relay=${encodeURIComponent(relay)}`;
  const legacy = await readBoundedResponse(`${handoff}/s/${id}${query}`, {
    fetcher,
  });
  const csp = securityHeaders(legacy.response, {
    cache: "no-store",
    html: true,
  });
  requireThat(
    csp.get("connect-src") === relay,
    "v1 CSP must connect only to the configured relay",
  );
  requireThat(
    legacy.bytes.toString("utf8").includes(bootstrap.release.packageUrl),
    "v1 package pin mismatch",
  );
  const page = await readBoundedResponse(`${handoff}/e/${id}${query}`, {
    fetcher,
  });
  securityHeaders(page.response, { cache: "no-store", html: true });
  requireThat(
    page.bytes.toString("utf8").includes("AgentShare"),
    "v2 handoff content missing",
  );
  const metadata = await readBoundedResponse(
    `${handoff}/e/${id}/bootstrap.json${query}`,
    { fetcher },
  );
  securityHeaders(metadata.response, { cache: "public, max-age=300" });
  requireThat(
    isDeepStrictEqual(JSON.parse(metadata.bytes.toString("utf8")), bootstrap),
    "bootstrap schema or release pin mismatch",
  );
  const routing = await readBoundedResponse(`${relay}/v2/environments`, {
    method: "OPTIONS",
    fetcher,
  });
  requireThat(routing.response.status === 204, "v2 relay route unavailable");
  return {
    checks: 4,
    nativeAcceptance: false,
    verification: "read-only-public-surfaces",
  };
}
