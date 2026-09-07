import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { bootstrapDocument } from "../apps/web/dist/v2.js";
import { handleRequest } from "../apps/handoff/dist/index.js";
import {
  downloadPackage,
  readBoundedResponse,
  selectCandidateCi,
  smokeDeployment,
  validateCandidateJobs,
  validateDeploymentInputs,
  validatePackageBytes,
  validateStagedRelease,
} from "./deployment-checks.mjs";

const relay = "https://agentshare-relay.carnation-vermicelli.workers.dev";
const handoff = "https://agentshare-handoff.carnation-vermicelli.workers.dev";

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["preflight", "smoke"].includes(mode)) {
    throw new Error(
      "Usage: node scripts/check-deployment.mjs <preflight|smoke>",
    );
  }
  const bootstrap = bootstrapDocument();
  const version = JSON.parse(
    readFileSync(
      new URL("../packages/cli/package.json", import.meta.url),
      "utf8",
    ),
  ).version;
  if (bootstrap.release.version !== version)
    throw new Error("CLI and bootstrap release versions differ");
  // Check both compiled handoff surfaces, not merely source-string assumptions.
  const localLegacy = await handleRequest(
    new Request(
      `${handoff}/s/deployment-check?relay=${encodeURIComponent(relay)}`,
    ),
  ).text();
  if (!localLegacy.includes(bootstrap.release.packageUrl))
    throw new Error("Legacy and v2 handoff package pins differ");

  if (mode === "smoke") {
    const result = await smokeDeployment({ relay, handoff, bootstrap });
    record(
      `Public smoke checks: ${result.checks} passed. Read-only transport checks; NOT native-agent or release-promotion evidence.`,
    );
    return;
  }

  const input = validateDeploymentInputs({
    sha: process.env.AGENTSHARE_CANDIDATE_SHA,
    digest: process.env.AGENTSHARE_PACKAGE_SHA256,
    sizeBytes: Number(process.env.AGENTSHARE_PACKAGE_SIZE),
    repo: process.env.GITHUB_REPOSITORY,
    version,
    packageUrl: bootstrap.release.packageUrl,
    relay,
    handoff,
  });
  if (process.env.GITHUB_REF !== "refs/heads/master")
    throw new Error("Production deployment workflow must run from master");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== input.sha)
    throw new Error("Checkout does not match candidate SHA");
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", input.sha, "origin/master"],
    { stdio: "pipe" },
  );

  const api = async (path) => {
    const token = process.env.GH_TOKEN;
    if (!token)
      throw new Error("GitHub read token required for deployment preflight");
    const { bytes } = await readBoundedResponse(
      `https://api.github.com/repos/${input.repo}/${path}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    return JSON.parse(bytes.toString("utf8"));
  };
  const runs = await api(`actions/runs?head_sha=${input.sha}&per_page=100`);
  const ci = selectCandidateCi(runs.workflow_runs, input.sha);
  const jobs = await api(
    `actions/runs/${ci.id}/jobs?filter=latest&per_page=100`,
  );
  validateCandidateJobs(jobs.jobs);
  const environment = await api("environments/production");
  if (environment.name !== "production")
    throw new Error(
      "Production deployment workflow must use production environment",
    );

  const release = await api(`releases/tags/v${version}`);
  const tag = await api(`git/ref/tags/v${version}`);
  let object = tag.object;
  for (let depth = 0; object?.type === "tag" && depth < 3; depth += 1) {
    if (!/^[a-f0-9]{40}$/u.test(object.sha))
      throw new Error("Invalid annotated tag object");
    object = (await api(`git/tags/${object.sha}`)).object;
  }
  if (object?.type !== "commit")
    throw new Error("Release tag does not resolve to a commit");
  const url = validateStagedRelease(release, object.sha, input);
  validatePackageBytes(await downloadPackage(url), input);
  record(
    `Deployment preflight passed: commit ${input.sha}; package ${version}, ${input.sizeBytes} bytes, SHA-256 ${input.digest}; CI run ${ci.id}. No stable promotion authorized.`,
  );
}

function record(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

main().catch((error) => {
  // Never print response bodies, request headers, capability URLs, or raw error causes.
  console.error(
    error instanceof Error ? error.message : "Deployment check failed",
  );
  process.exitCode = 1;
});
