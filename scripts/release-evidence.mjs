import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const SCHEMA_VERSION = "agentshare-release-evidence/v1";
export const CANDIDATE_VERSION = "agentshare-release-candidate/v1";
export const PROFILE = "codex-only-v1";
export const RUNTIME = Object.freeze({
  platform: "win32",
  osRelease: "10.0.26200",
  nodeVersion: "24.14.0",
  agent: "codex",
  agentVersion: "0.147.0",
});

// Changing this inventory or any observation requires a NEW profile version.
export const REQUIRED_OBSERVATIONS = Object.freeze({
  create: Object.freeze({
    explicitCreatorApproval: true,
    encryptedUpload: true,
    capabilityRedacted: true,
  }),
  bootstrap: Object.freeze({
    isolatedPublishedInstall: true,
    installedVersion: "0.3.0",
    mcpRegistered: true,
  }),
  read: Object.freeze({
    mcpToolSucceeded: true,
    groundedCitation: true,
    cancelledCalls: 0,
  }),
  propose: Object.freeze({
    mcpToolSucceeded: true,
    inboxReceived: true,
    workspaceUnchangedBeforeApproval: true,
    cancelledCalls: 0,
  }),
  approve: Object.freeze({
    explicitOwnerApproval: true,
    appliedExpectedDiff: true,
  }),
  refresh: Object.freeze({
    newRevisionVisible: true,
    groundedCitation: true,
  }),
  isolation: Object.freeze({
    outsideWorkspaceWrites: 0,
    unexpectedNetworkRequests: 0,
    inheritedTools: 0,
    capabilityLeaks: 0,
  }),
  revoke: Object.freeze({ httpStatus: 410, recipientDenied: true }),
  cleanup: Object.freeze({
    activeShares: 0,
    remainingProcesses: 0,
    remainingTempPaths: 0,
  }),
});
export const REQUIRED_CHECK_IDS = Object.freeze(
  ["terminal", "chat"].flatMap((surface) =>
    Object.keys(REQUIRED_OBSERVATIONS).map((stage) => `${surface}.${stage}`),
  ),
);

function requireThat(condition, message) {
  if (!condition) throw new Error(`Release evidence rejected: ${message}`);
}

function fields(value, names, label) {
  requireThat(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  requireThat(
    isDeepStrictEqual(Object.keys(value).sort(), [...names].sort()),
    `${label} fields must be exactly: ${names.join(", ")}`,
  );
}

function same(actual, expected, label) {
  requireThat(isDeepStrictEqual(actual, expected), `${label} mismatch`);
}

function token(value, label) {
  requireThat(
    typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value),
    `${label} must be a non-secret identifier`,
  );
}

function digest(value, label, length = 64) {
  requireThat(
    typeof value === "string" &&
      new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value),
    `${label} must be a full lowercase ${length}-character hex digest`,
  );
}

function timestamp(value, label) {
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    `${label} must be an ISO UTC timestamp with milliseconds`,
  );
  return Date.parse(value);
}

function positiveSize(value, label) {
  requireThat(
    Number.isSafeInteger(value) && value > 0,
    `${label} must be positive bytes`,
  );
}

function httpsUrl(value, label, originOnly = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    requireThat(false, `${label} must be HTTPS`);
  }
  requireThat(
    typeof value === "string" &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (!originOnly || value === url.origin),
    `${label} must be credential-free HTTPS${originOnly ? " origin" : " URL"}`,
  );
}

function artifact(value) {
  fields(
    value,
    ["name", "version", "url", "sha256", "sizeBytes", "commit"],
    "artifact",
  );
  same(value.name, "agentshare", "artifact.name");
  same(value.version, "0.3.0", "artifact.version");
  httpsUrl(value.url, "artifact.url");
  digest(value.sha256, "artifact.sha256");
  digest(value.commit, "artifact.commit", 40);
  positiveSize(value.sizeBytes, "artifact.sizeBytes");
}

function workers(value) {
  fields(value, ["relay", "handoff"], "workers");
  for (const role of ["relay", "handoff"]) {
    const worker = value[role];
    fields(
      worker,
      ["name", "origin", "versionId", "deploymentId", "sourceCommit"],
      `workers.${role}`,
    );
    token(worker.name, `workers.${role}.name`);
    httpsUrl(worker.origin, `workers.${role}.origin`, true);
    for (const key of ["versionId", "deploymentId"]) {
      requireThat(
        typeof worker[key] === "string" &&
          /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(worker[key]),
        `workers.${role}.${key} must be a full UUID`,
      );
    }
    digest(worker.sourceCommit, `workers.${role}.sourceCommit`, 40);
  }
  requireThat(
    value.relay.origin !== value.handoff.origin,
    "worker origins must differ",
  );
}

function identifierList(value, label) {
  requireThat(
    Array.isArray(value) && value.length > 0,
    `${label} must not be empty`,
  );
  value.forEach((item) => token(item, label));
  requireThat(
    new Set(value).size === value.length,
    `${label} contains duplicate IDs`,
  );
}

function exactIds(items, expected, label) {
  requireThat(Array.isArray(items), `${label} must be an array`);
  const ids = items.map((item) => item?.id);
  same([...ids].sort(), [...expected].sort(), `${label} inventory`);
}

export function validateCandidate(candidate) {
  fields(
    candidate,
    ["schemaVersion", "profile", "runId", "artifact", "workers"],
    "candidate",
  );
  same(candidate.schemaVersion, CANDIDATE_VERSION, "candidate.schemaVersion");
  same(candidate.profile, PROFILE, "candidate.profile");
  token(candidate.runId, "candidate.runId");
  artifact(candidate.artifact);
  workers(candidate.workers);
}

/** Structural validation only. File verification is mandatory at the CLI boundary. */
export function validateReleaseEvidence(report, candidate) {
  validateCandidate(candidate);
  fields(
    report,
    [
      "schemaVersion",
      "profile",
      "evidenceKind",
      "runId",
      "artifact",
      "runtime",
      "workers",
      "harness",
      "startedAt",
      "completedAt",
      "execution",
      "summary",
      "flows",
      "checks",
      "attachments",
      "cleanup",
    ],
    "report",
  );
  same(report.schemaVersion, SCHEMA_VERSION, "report.schemaVersion");
  same(report.profile, PROFILE, "report.profile");
  same(
    report.evidenceKind,
    "published-artifact-full-v2",
    "report.evidenceKind (diagnostics/fixtures are not promotable)",
  );
  for (const key of ["runId", "artifact", "workers"])
    same(report[key], candidate[key], `report.${key}`);
  same(report.runtime, RUNTIME, "report.runtime");
  fields(report.harness, ["id", "version", "commit"], "harness");
  token(report.harness.id, "harness.id");
  token(report.harness.version, "harness.version");
  digest(report.harness.commit, "harness.commit", 40);
  const start = timestamp(report.startedAt, "startedAt");
  const end = timestamp(report.completedAt, "completedAt");
  requireThat(start < end, "report time window is empty or reversed");
  same(
    report.execution,
    { exitCode: 0, signal: null, completed: true },
    "execution",
  );
  same(
    report.summary,
    {
      required: REQUIRED_CHECK_IDS.length,
      passed: REQUIRED_CHECK_IDS.length,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      incomplete: 0,
    },
    "summary",
  );

  requireThat(
    Array.isArray(report.flows) && report.flows.length === 2,
    "exactly two flows required",
  );
  const flowBySurface = new Map();
  const flowIds = new Set();
  const resources = { shares: [], processes: [], tempPaths: [] };
  for (const flow of report.flows) {
    fields(
      flow,
      [
        "id",
        "surface",
        "environmentId",
        "proposalId",
        "revisionBefore",
        "revisionAfter",
        "creatorSessionId",
        "recipientSessionId",
        "shareIds",
        "processIds",
        "tempPathIds",
      ],
      "flow",
    );
    requireThat(
      ["terminal", "chat"].includes(flow.surface) &&
        !flowBySurface.has(flow.surface),
      "duplicate or unknown flow surface",
    );
    for (const key of [
      "id",
      "environmentId",
      "proposalId",
      "revisionBefore",
      "revisionAfter",
      "creatorSessionId",
      "recipientSessionId",
    ])
      token(flow[key], `flow.${key}`);
    requireThat(!flowIds.has(flow.id), "duplicate flow ID");
    requireThat(
      flow.revisionBefore !== flow.revisionAfter,
      "refresh must change revision ID",
    );
    requireThat(
      flow.creatorSessionId !== flow.recipientSessionId,
      "creator and recipient sessions must differ",
    );
    for (const [key, resource] of [
      ["shareIds", "shares"],
      ["processIds", "processes"],
      ["tempPathIds", "tempPaths"],
    ]) {
      identifierList(flow[key], `flow.${key}`);
      resources[resource].push(...flow[key]);
    }
    flowIds.add(flow.id);
    flowBySurface.set(flow.surface, flow);
  }
  for (const [key, ids] of Object.entries(resources)) identifierList(ids, key);
  for (const key of [
    "environmentId",
    "proposalId",
    "creatorSessionId",
    "recipientSessionId",
  ]) {
    requireThat(
      report.flows[0][key] !== report.flows[1][key],
      `flows must use distinct ${key}`,
    );
  }

  requireThat(
    Array.isArray(report.attachments) && report.attachments.length > 0,
    "attachments required",
  );
  const attachmentIds = new Set();
  const attachmentPaths = new Set();
  for (const attachment of report.attachments) {
    fields(attachment, ["id", "path", "sha256", "sizeBytes"], "attachment");
    token(attachment.id, "attachment.id");
    requireThat(!attachmentIds.has(attachment.id), "duplicate attachment ID");
    requireThat(
      typeof attachment.path === "string" &&
        /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/u.test(attachment.path) &&
        attachment.path
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        !attachmentPaths.has(attachment.path.toLowerCase()),
      "attachment path must be unique, relative, and traversal-free",
    );
    digest(attachment.sha256, "attachment.sha256");
    positiveSize(attachment.sizeBytes, "attachment.sizeBytes");
    attachmentIds.add(attachment.id);
    attachmentPaths.add(attachment.path.toLowerCase());
  }
  exactIds(report.checks, REQUIRED_CHECK_IDS, "checks");
  const usedAttachments = new Set();
  const previousEnd = new Map();
  // Validate in frozen stage order, independent of serialized array order.
  for (const id of REQUIRED_CHECK_IDS) {
    const check = report.checks.find((entry) => entry.id === id);
    fields(
      check,
      [
        "id",
        "flowId",
        "status",
        "startedAt",
        "completedAt",
        "exitCode",
        "signal",
        "observations",
        "attachmentIds",
      ],
      `check.${id}`,
    );
    const [surface, stage] = id.split(".");
    same(check.flowId, flowBySurface.get(surface).id, `${id}.flowId`);
    same(check.status, "passed", `${id}.status`);
    same(check.exitCode, 0, `${id}.exitCode`);
    same(check.signal, null, `${id}.signal`);
    same(
      check.observations,
      REQUIRED_OBSERVATIONS[stage],
      `${id}.observations`,
    );
    const checkStart = timestamp(check.startedAt, `${id}.startedAt`);
    const checkEnd = timestamp(check.completedAt, `${id}.completedAt`);
    requireThat(
      checkStart >= (previousEnd.get(surface) ?? start) &&
        checkEnd > checkStart &&
        checkEnd <= end,
      `${id} time window/order invalid`,
    );
    previousEnd.set(surface, checkEnd);
    identifierList(check.attachmentIds, `${id}.attachmentIds`);
    for (const attachmentId of check.attachmentIds) {
      requireThat(
        attachmentIds.has(attachmentId),
        `${id} references missing attachment`,
      );
      usedAttachments.add(attachmentId);
    }
  }
  same(
    [...usedAttachments].sort(),
    [...attachmentIds].sort(),
    "referenced attachment inventory",
  );

  fields(
    report.cleanup,
    ["status", "completedAt", "shares", "processes", "tempPaths"],
    "cleanup",
  );
  same(report.cleanup.status, "complete", "cleanup.status");
  const cleanupEnd = timestamp(
    report.cleanup.completedAt,
    "cleanup.completedAt",
  );
  requireThat(
    cleanupEnd >= Math.max(...previousEnd.values()) && cleanupEnd <= end,
    "cleanup completion outside final window",
  );
  for (const [key, expectedOutcome] of Object.entries({
    shares: { httpStatus: 410 },
    processes: { exited: true },
    tempPaths: { removed: true },
  })) {
    exactIds(report.cleanup[key], resources[key], `cleanup.${key}`);
    for (const entry of report.cleanup[key])
      same(
        entry,
        { id: entry.id, ...expectedOutcome },
        `cleanup.${key}.${entry.id}`,
      );
  }
  return {
    profile: PROFILE,
    runId: report.runId,
    checks: REQUIRED_CHECK_IDS.length,
  };
}

function readJson(path) {
  requireThat(
    statSync(path).isFile() && statSync(path).size <= 2 * 1024 * 1024,
    "JSON input must be a regular file <= 2 MiB",
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyBytes(path, expected, label) {
  const stat = statSync(path);
  requireThat(
    stat.isFile() && stat.size === expected.sizeBytes,
    `${label} size mismatch`,
  );
  const bytes = readFileSync(path);
  same(bytes.length, expected.sizeBytes, `${label} bytes`);
  same(
    createHash("sha256").update(bytes).digest("hex"),
    expected.sha256,
    `${label} SHA-256`,
  );
}

/** Offline verifier: no spawning, publishing, deployment, network, or file writes. */
export function verifyReleaseEvidenceFiles({
  evidence,
  candidate,
  artifact: artifactPath,
}) {
  const expected = readJson(candidate);
  const report = readJson(evidence);
  const result = validateReleaseEvidence(report, expected);
  verifyBytes(artifactPath, expected.artifact, "published artifact");
  const root = realpathSync(dirname(resolve(evidence)));
  for (const attachment of report.attachments) {
    const path = realpathSync(resolve(root, attachment.path));
    const rel = relative(root, path);
    requireThat(
      rel &&
        !isAbsolute(rel) &&
        rel !== ".." &&
        !rel.startsWith(`..\\`) &&
        !rel.startsWith("../"),
      "attachment escapes report directory",
    );
    verifyBytes(path, attachment, `attachment ${attachment.id}`);
  }
  // Byte integrity does not establish who collected the evidence or prove native UI consent.
  return {
    ...result,
    promotable: false,
    verification: "contract-and-file-integrity-only",
  };
}

export function runEvidenceCli(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    requireThat(
      ["--profile", "--evidence", "--candidate", "--artifact"].includes(flag),
      "unknown argument",
    );
    const key = flag.slice(2);
    requireThat(
      !(key in options) &&
        typeof args[index + 1] === "string" &&
        args[index + 1].length > 0 &&
        !args[index + 1].startsWith("--"),
      "duplicate argument or missing value",
    );
    options[key] = args[index + 1];
  }
  same(options.profile, PROFILE, "explicit --profile");
  for (const key of ["evidence", "candidate", "artifact"])
    requireThat(options[key], `--${key} required`);
  return verifyReleaseEvidenceFiles(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = runEvidenceCli(process.argv.slice(2));
    console.log(
      `Evidence contract verified: ${result.profile}, ${result.checks} checks, run ${result.runId}. No deployment or publication performed.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Release evidence rejected",
    );
    process.exitCode = 1;
  }
}
