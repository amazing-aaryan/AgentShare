import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as checks from "./deployment-checks.mjs";

// Synthetic metadata and HTTP responses, not release or native-host evidence.
const sha = "a".repeat(40);
const bytes = Buffer.from("synthetic package bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
const version = "0.3.1";
const repo = "amazing-aaryan/AgentShare";
const packageUrl = `https://github.com/${repo}/releases/download/v${version}/agentshare-${version}.tgz`;
const expected = {
  sha,
  version,
  digest,
  sizeBytes: bytes.length,
  repo,
  packageUrl,
};
const matrix = ["ubuntu-latest", "macos-latest", "windows-latest"].flatMap(
  (os) => [22, 24].map((node) => `verify (${os}, ${node})`),
);
const run = {
  id: 1,
  run_number: 1,
  head_sha: sha,
  event: "push",
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
};
const jobs = matrix.map((name) => ({
  name,
  status: "completed",
  conclusion: "success",
}));
const release = {
  tag_name: `v${version}`,
  draft: false,
  immutable: true,
  prerelease: true,
  assets: [
    {
      name: `agentshare-${version}.tgz`,
      size: bytes.length,
      state: "uploaded",
      digest: `sha256:${digest}`,
      browser_download_url: packageUrl,
    },
  ],
};

function invoke(name, ...args) {
  assert.equal(typeof checks[name], "function", `${name} must be implemented`);
  return checks[name](...args);
}

test("deployment inputs require exact digests, bounded package size and distinct bare HTTPS origins", () => {
  const input = {
    ...expected,
    relay: "https://relay.example.test",
    handoff: "https://handoff.example.test",
  };
  assert.deepEqual(invoke("validateDeploymentInputs", input), input);
  for (const patch of [
    { sha: "short" },
    { digest: "b".repeat(63) },
    { sizeBytes: 0 },
    { sizeBytes: 21 * 1024 * 1024 },
    { version: "latest" },
    { relay: input.handoff },
    { relay: `${input.relay}/path` },
    { relay: "http://relay.example.test" },
    { relay: `${input.relay}#secret` },
    { handoff: "https://user:secret@handoff.example.test" },
    { handoff: `${input.handoff}?secret=1` },
    { repo: "elsewhere/project" },
    { packageUrl: "https://example.test/package.tgz" },
  ])
    assert.throws(() =>
      invoke("validateDeploymentInputs", { ...input, ...patch }),
    );
});

test("all six latest successful push CI jobs must cover the exact candidate", () => {
  assert.equal(invoke("selectCandidateCi", [run], sha).id, 1);
  assert.doesNotThrow(() => invoke("validateCandidateJobs", jobs));
  for (const bad of [
    jobs.slice(1),
    [...jobs, jobs[0]],
    jobs.map((job, i) => (i ? job : { ...job, conclusion: "skipped" })),
  ]) {
    assert.throws(() => invoke("validateCandidateJobs", bad));
  }
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { event: "pull_request" },
    { conclusion: "failure" },
    { status: "in_progress" },
  ]) {
    assert.throws(() =>
      invoke("selectCandidateCi", [{ ...run, ...patch }], sha),
    );
  }
  assert.throws(() =>
    invoke(
      "selectCandidateCi",
      [run, { ...run, id: 2, run_number: 2, conclusion: "failure" }],
      sha,
    ),
  );
});

test("production requires configured human review and a master-only branch policy", () => {
  const environment = {
    name: "production",
    protection_rules: [
      {
        type: "required_reviewers",
        reviewers: [{ type: "User", reviewer: { id: 1 } }],
      },
    ],
    deployment_branch_policy: { custom_branch_policies: true },
  };
  const policies = [{ name: "master", type: "branch" }];
  assert.doesNotThrow(() =>
    invoke("validateProductionEnvironment", environment, policies),
  );
  assert.throws(() =>
    invoke(
      "validateProductionEnvironment",
      { ...environment, protection_rules: [] },
      policies,
    ),
  );
  assert.throws(() =>
    invoke("validateProductionEnvironment", environment, [
      { name: "*", type: "branch" },
    ]),
  );
  assert.throws(() =>
    invoke("validateProductionEnvironment", environment, [
      ...policies,
      { name: "v*", type: "tag" },
    ]),
  );
  assert.throws(() =>
    invoke(
      "validateProductionEnvironment",
      { ...environment, deployment_branch_policy: null },
      policies,
    ),
  );
});

test("staging requires the exact immutable release, tag commit and asset digest", () => {
  assert.equal(
    invoke("validateStagedRelease", release, sha, expected),
    packageUrl,
  );
  for (const patch of [
    { draft: true },
    { immutable: false },
    { tag_name: "v0.3.0" },
    { assets: [] },
    { assets: [release.assets[0], release.assets[0]] },
  ]) {
    assert.throws(() =>
      invoke("validateStagedRelease", { ...release, ...patch }, sha, expected),
    );
  }
  for (const patch of [
    { digest: `sha256:${"b".repeat(64)}` },
    { size: 1 },
    { state: "new" },
    { browser_download_url: "https://elsewhere.test/package" },
  ]) {
    assert.throws(() =>
      invoke(
        "validateStagedRelease",
        { ...release, assets: [{ ...release.assets[0], ...patch }] },
        sha,
        expected,
      ),
    );
  }
  assert.throws(() =>
    invoke("validateStagedRelease", release, "b".repeat(40), expected),
  );
  assert.doesNotThrow(() => invoke("validatePackageBytes", bytes, expected));
  assert.throws(() =>
    invoke("validatePackageBytes", Buffer.from("other"), expected),
  );
});

test("bounded requests reject failed HTTP, redirects, oversize responses and hung fetches", async () => {
  const url = "https://handoff.example.test/e/synthetic";
  const fetcher = async () => new Response("ok");
  const result = await invoke("readBoundedResponse", url, {
    fetcher,
    maxBytes: 3,
  });
  assert.equal(result.bytes.toString(), "ok");
  for (const response of [
    new Response("no", { status: 500 }),
    new Response(null, { status: 302 }),
    new Response("large"),
  ]) {
    await assert.rejects(() =>
      invoke("readBoundedResponse", url, {
        maxBytes: 3,
        fetcher: async () => response,
      }),
    );
  }
  await assert.rejects(() =>
    invoke("readBoundedResponse", url, {
      timeoutMs: 10,
      fetcher: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
  );
});

test("asset redirect handling is allowlisted and never sends authorization", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/synthetic?signature=fake",
          },
        })
      : new Response(bytes);
  };
  assert.deepEqual(
    await invoke("downloadPackage", packageUrl, { fetcher }),
    bytes,
  );
  for (const call of calls)
    assert.equal(new Headers(call.options.headers).has("authorization"), false);
  for (const location of [
    "http://release-assets.githubusercontent.com/package",
    "https://untrusted.test/package",
    "https://user:secret@release-assets.githubusercontent.com/package",
  ]) {
    await assert.rejects(() =>
      invoke("downloadPackage", packageUrl, {
        fetcher: async () =>
          new Response(null, { status: 302, headers: { location } }),
      }),
    );
  }
});

const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const relay = "https://relay.example.test";
const handoff = "https://handoff.example.test";
const bootstrap = {
  protocol: "agentshare-bootstrap-v1",
  release: { version, packageUrl },
};
function smokeFetcher(overrides = {}) {
  return async (url, options) => {
    assert.equal(new URL(url).hash, "");
    assert.ok(["GET", "OPTIONS"].includes(options.method));
    if (options.method === "OPTIONS")
      return new Response(null, { status: 204 });
    if (url.includes("bootstrap.json"))
      return Response.json(overrides.bootstrap ?? bootstrap, {
        headers: {
          ...headers,
          "cache-control": "public, max-age=300",
          "content-security-policy": "default-src 'none'",
        },
      });
    return new Response(`AgentShare ${packageUrl}`, {
      headers: {
        ...headers,
        "content-security-policy": `${headers["content-security-policy"]}; connect-src ${relay}`,
        ...overrides.headers,
      },
    });
  };
}

test("read-only smoke checks cover v1/v2 headers, exact bootstrap pin and relay routing", async () => {
  const options = { relay, handoff, bootstrap, fetcher: smokeFetcher() };
  const result = await invoke("smokeDeployment", options);
  assert.equal(result.checks, 4);
  assert.equal(result.nativeAcceptance, false);
  await assert.rejects(() =>
    invoke("smokeDeployment", {
      ...options,
      fetcher: smokeFetcher({ headers: { "referrer-policy": "origin" } }),
    }),
  );
  await assert.rejects(() =>
    invoke("smokeDeployment", {
      ...options,
      fetcher: smokeFetcher({
        bootstrap: { ...bootstrap, release: { version: "old" } },
      }),
    }),
  );
  await assert.rejects(() =>
    invoke("smokeDeployment", {
      ...options,
      fetcher: smokeFetcher({
        headers: { "content-security-policy": "default-src *" },
      }),
    }),
  );
});
