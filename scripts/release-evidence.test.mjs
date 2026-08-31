import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CANDIDATE_VERSION,
  PROFILE,
  REQUIRED_CHECK_IDS,
  REQUIRED_OBSERVATIONS,
  RUNTIME,
  SCHEMA_VERSION,
  runEvidenceCli,
  validateReleaseEvidence,
  verifyReleaseEvidenceFiles,
} from "./release-evidence.mjs";

// Synthetic contract fixtures, never release evidence or live-flow claims.
const archive = Buffer.from("synthetic archive bytes, not a published package");
const transcript = Buffer.from(
  "synthetic redacted transcript, not a real flow",
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const time = (seconds) =>
  new Date(Date.UTC(2026, 7, 27, 12, 0, seconds)).toISOString();

function fixture() {
  const worker = (name, digit) => ({
    name,
    origin: `https://${name}.example.test`,
    versionId: `${digit.repeat(8)}-1111-2222-3333-444444444444`,
    deploymentId: `${digit.repeat(8)}-5555-6666-7777-888888888888`,
    sourceCommit: digit.repeat(40),
  });
  const candidate = {
    schemaVersion: CANDIDATE_VERSION,
    profile: PROFILE,
    runId: "fixture-run-1",
    artifact: {
      name: "agentshare",
      version: "0.3.0",
      url: "https://registry.example.test/agentshare-0.3.0.tgz",
      sha256: sha256(archive),
      sizeBytes: archive.length,
      commit: "a".repeat(40),
    },
    workers: { relay: worker("relay", "1"), handoff: worker("handoff", "2") },
  };
  const flows = ["terminal", "chat"].map((surface) => ({
    id: `${surface}-flow`,
    surface,
    environmentId: `${surface}-environment`,
    proposalId: `${surface}-proposal`,
    revisionBefore: `${surface}-revision-1`,
    revisionAfter: `${surface}-revision-2`,
    creatorSessionId: `${surface}-creator`,
    recipientSessionId: `${surface}-recipient`,
    shareIds: [`${surface}-share`],
    processIds: [`${surface}-process`],
    tempPathIds: [`${surface}-temp`],
  }));
  const report = {
    schemaVersion: SCHEMA_VERSION,
    profile: PROFILE,
    evidenceKind: "published-artifact-full-v2",
    runId: candidate.runId,
    artifact: structuredClone(candidate.artifact),
    runtime: { ...RUNTIME },
    workers: structuredClone(candidate.workers),
    harness: { id: "fixture-harness", version: "1", commit: "b".repeat(40) },
    startedAt: time(0),
    completedAt: time(60),
    execution: { exitCode: 0, signal: null, completed: true },
    summary: {
      required: 18,
      passed: 18,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      incomplete: 0,
    },
    flows,
    checks: REQUIRED_CHECK_IDS.map((id, index) => {
      const [surface, stage] = id.split(".");
      return {
        id,
        flowId: `${surface}-flow`,
        status: "passed",
        startedAt: time(index * 2 + 1),
        completedAt: time(index * 2 + 2),
        exitCode: 0,
        signal: null,
        observations: { ...REQUIRED_OBSERVATIONS[stage] },
        attachmentIds: ["transcript"],
      };
    }),
    attachments: [
      {
        id: "transcript",
        path: "transcript.log",
        sha256: sha256(transcript),
        sizeBytes: transcript.length,
      },
    ],
    cleanup: {
      status: "complete",
      completedAt: time(50),
      shares: flows.flatMap((flow) =>
        flow.shareIds.map((id) => ({ id, httpStatus: 410 })),
      ),
      processes: flows.flatMap((flow) =>
        flow.processIds.map((id) => ({ id, exited: true })),
      ),
      tempPaths: flows.flatMap((flow) =>
        flow.tempPathIds.map((id) => ({ id, removed: true })),
      ),
    },
  };
  return { report, candidate };
}

function onDisk(callback) {
  const root = mkdtempSync(join(tmpdir(), "agentshare-evidence-fixture-"));
  const data = fixture();
  const paths = {
    evidence: join(root, "report.json"),
    candidate: join(root, "candidate.json"),
    artifact: join(root, "artifact.tgz"),
  };
  const save = () => {
    writeFileSync(paths.evidence, JSON.stringify(data.report));
    writeFileSync(paths.candidate, JSON.stringify(data.candidate));
  };
  try {
    save();
    writeFileSync(paths.artifact, archive);
    writeFileSync(join(root, "transcript.log"), transcript);
    callback({ ...data, paths, root, save });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("frozen full-flow inventory and exact runtime accept a complete synthetic contract", () => {
  assert.equal(Object.isFrozen(REQUIRED_CHECK_IDS), true);
  assert.deepEqual(
    REQUIRED_CHECK_IDS,
    ["terminal", "chat"].flatMap((surface) =>
      [
        "create",
        "bootstrap",
        "read",
        "propose",
        "approve",
        "refresh",
        "isolation",
        "revoke",
        "cleanup",
      ].map((stage) => `${surface}.${stage}`),
    ),
  );
  assert.deepEqual(RUNTIME, {
    platform: "win32",
    osRelease: "10.0.26200",
    nodeVersion: "24.14.0",
    agent: "codex",
    agentVersion: "0.147.0",
  });
  const { report, candidate } = fixture();
  assert.deepEqual(validateReleaseEvidence(report, candidate), {
    profile: PROFILE,
    runId: "fixture-run-1",
    checks: 18,
  });
});

for (const id of REQUIRED_CHECK_IDS) {
  test(`missing ${id} cannot pass on exit 0 or claimed total`, () => {
    const { report, candidate } = fixture();
    report.checks = report.checks.filter((check) => check.id !== id);
    assert.throws(
      () => validateReleaseEvidence(report, candidate),
      /checks inventory/,
    );
  });
}

const invalidReports = [
  [
    "unknown schema",
    (r) => {
      r.schemaVersion = "agentshare-release-evidence/v2";
    },
  ],
  [
    "unknown profile",
    (r) => {
      r.profile = "codex-only-v2";
    },
  ],
  [
    "legacy diagnostic",
    (r) => {
      r.evidenceKind = "legacy-diagnostic";
    },
  ],
  [
    "fixture report",
    (r) => {
      r.evidenceKind = "fixture";
    },
  ],
  [
    "source-only evidence",
    (r) => {
      r.evidenceKind = "source-suite";
    },
  ],
  [
    "run mismatch",
    (r) => {
      r.runId = "different-run";
    },
  ],
  [
    "artifact hash mismatch",
    (r) => {
      r.artifact.sha256 = "c".repeat(64);
    },
  ],
  [
    "artifact size mismatch",
    (r) => {
      r.artifact.sizeBytes++;
    },
  ],
  [
    "artifact commit mismatch",
    (r) => {
      r.artifact.commit = "d".repeat(40);
    },
  ],
  [
    "wrong worker identity",
    (r) => {
      r.workers.relay.name = "other";
    },
  ],
  [
    "wrong deployment",
    (r) => {
      r.workers.handoff.deploymentId = "1".repeat(36);
    },
  ],
  [
    "wrong worker source",
    (r) => {
      r.workers.relay.sourceCommit = "f".repeat(40);
    },
  ],
  [
    "unsupported Windows",
    (r) => {
      r.runtime.osRelease = "10.0.26100";
    },
  ],
  [
    "unsupported Node",
    (r) => {
      r.runtime.nodeVersion = "24.14.1";
    },
  ],
  [
    "unsupported Codex",
    (r) => {
      r.runtime.agentVersion = "0.149.0";
    },
  ],
  [
    "unknown field",
    (r) => {
      r.promotable = true;
    },
  ],
  [
    "missing harness identity",
    (r) => {
      r.harness.id = "";
    },
  ],
  [
    "short harness commit",
    (r) => {
      r.harness.commit = "abcdef0";
    },
  ],
  [
    "false exit 0",
    (r) => {
      r.execution.completed = false;
    },
  ],
  [
    "runner killed",
    (r) => {
      r.execution.signal = "SIGTERM";
    },
  ],
  [
    "runner failure",
    (r) => {
      r.execution.exitCode = 1;
    },
  ],
  [
    "skipped summary",
    (r) => {
      r.summary.skipped = 1;
    },
  ],
  [
    "cancelled summary",
    (r) => {
      r.summary.cancelled = 1;
    },
  ],
  [
    "duplicate check",
    (r) => {
      r.checks[1] = r.checks[0];
    },
  ],
  [
    "extra check",
    (r) => {
      r.checks.push({ ...r.checks[0], id: "terminal.extra" });
    },
  ],
  [
    "missing observation",
    (r) => {
      delete r.checks[0].observations.encryptedUpload;
    },
  ],
  [
    "false observation",
    (r) => {
      r.checks[0].observations.encryptedUpload = false;
    },
  ],
  [
    "cancelled MCP read",
    (r) => {
      r.checks[2].observations.cancelledCalls = 1;
    },
  ],
  [
    "cancelled MCP propose",
    (r) => {
      r.checks[3].observations.cancelledCalls = 1;
    },
  ],
  [
    "check killed despite exit 0",
    (r) => {
      r.checks[0].signal = "SIGTERM";
    },
  ],
  [
    "check nonzero exit",
    (r) => {
      r.checks[0].exitCode = 1;
    },
  ],
  [
    "check wrong flow",
    (r) => {
      r.checks[0].flowId = "chat-flow";
    },
  ],
  [
    "invalid timestamp",
    (r) => {
      r.checks[0].completedAt = "2026-02-30T00:00:00.000Z";
    },
  ],
  [
    "stage out of order",
    (r) => {
      r.checks[1].startedAt = time(0);
    },
  ],
  [
    "empty time window",
    (r) => {
      r.completedAt = r.startedAt;
    },
  ],
  [
    "duplicate flow",
    (r) => {
      r.flows[1] = r.flows[0];
    },
  ],
  [
    "no changed revision",
    (r) => {
      r.flows[0].revisionAfter = r.flows[0].revisionBefore;
    },
  ],
  [
    "reused proposal",
    (r) => {
      r.flows[1].proposalId = r.flows[0].proposalId;
    },
  ],
  [
    "missing resource inventory",
    (r) => {
      r.flows[0].shareIds = [];
    },
  ],
  [
    "secret instead of ID",
    (r) => {
      r.flows[0].shareIds = ["https://share.example/#key"];
    },
  ],
  [
    "missing attachments",
    (r) => {
      r.attachments = [];
    },
  ],
  [
    "missing check attachments",
    (r) => {
      r.checks[0].attachmentIds = [];
    },
  ],
  [
    "unknown attachment",
    (r) => {
      r.checks[0].attachmentIds = ["unknown"];
    },
  ],
  [
    "duplicate attachment",
    (r) => {
      r.attachments.push(r.attachments[0]);
    },
  ],
  [
    "path traversal",
    (r) => {
      r.attachments[0].path = "../transcript.log";
    },
  ],
  [
    "absolute path",
    (r) => {
      r.attachments[0].path = "C:/transcript.log";
    },
  ],
  [
    "pending cleanup",
    (r) => {
      r.cleanup.status = "pending";
    },
  ],
  [
    "missing share cleanup",
    (r) => {
      r.cleanup.shares.pop();
    },
  ],
  [
    "unrevoked share",
    (r) => {
      r.cleanup.shares[0].httpStatus = 200;
    },
  ],
  [
    "unproven revoke 404",
    (r) => {
      r.cleanup.shares[0].httpStatus = 404;
    },
  ],
  [
    "live process",
    (r) => {
      r.cleanup.processes[0].exited = false;
    },
  ],
  [
    "remaining temp data",
    (r) => {
      r.cleanup.tempPaths[0].removed = false;
    },
  ],
  [
    "untracked extra share",
    (r) => {
      r.cleanup.shares.push({ id: "extra", httpStatus: 410 });
    },
  ],
  [
    "early cleanup",
    (r) => {
      r.cleanup.completedAt = time(1);
    },
  ],
];
for (const status of [
  "failed",
  "skipped",
  "cancelled",
  "incomplete",
  "pending",
]) {
  invalidReports.push([
    `${status} check`,
    (r) => {
      r.checks[0].status = status;
    },
  ]);
}
for (const [name, mutate] of invalidReports) {
  test(`rejects ${name}`, () => {
    const { report, candidate } = fixture();
    mutate(report);
    assert.throws(
      () => validateReleaseEvidence(report, candidate),
      /Release evidence rejected/,
    );
  });
}

test("all top-level fields required, including independent candidate identity", () => {
  const { report, candidate } = fixture();
  for (const key of Object.keys(report)) {
    const partial = structuredClone(report);
    delete partial[key];
    assert.throws(
      () => validateReleaseEvidence(partial, candidate),
      /Release evidence rejected/,
    );
  }
  for (const key of Object.keys(candidate)) {
    const partial = structuredClone(candidate);
    delete partial[key];
    assert.throws(
      () => validateReleaseEvidence(report, partial),
      /Release evidence rejected/,
    );
  }
});

test("candidate rejects invalid provenance even when report copies it", () => {
  for (const mutate of [
    (c) => {
      c.artifact.sha256 = "a".repeat(63);
    },
    (c) => {
      c.artifact.commit = "abcdef0";
    },
    (c) => {
      c.artifact.sizeBytes = 0;
    },
    (c) => {
      c.artifact.version = "0.2.0";
    },
    (c) => {
      c.artifact.url = "file:///package.tgz";
    },
    (c) => {
      c.workers.relay.versionId = "ad67746a";
    },
    (c) => {
      c.workers.handoff.origin = c.workers.relay.origin;
    },
  ]) {
    const { report, candidate } = fixture();
    mutate(candidate);
    report.artifact = structuredClone(candidate.artifact);
    report.workers = structuredClone(candidate.workers);
    assert.throws(
      () => validateReleaseEvidence(report, candidate),
      /Release evidence rejected/,
    );
  }
});

test("offline file verifier hashes actual artifact and transcript bytes", () => {
  onDisk(({ paths }) => {
    assert.equal(verifyReleaseEvidenceFiles(paths).checks, 18);
    assert.equal(verifyReleaseEvidenceFiles(paths).promotable, false);
    writeFileSync(paths.artifact, Buffer.alloc(archive.length, "x"));
    assert.throws(
      () => verifyReleaseEvidenceFiles(paths),
      /published artifact SHA-256/,
    );
    writeFileSync(paths.artifact, "short");
    assert.throws(
      () => verifyReleaseEvidenceFiles(paths),
      /published artifact size/,
    );
  });
  onDisk(({ paths, root }) => {
    writeFileSync(
      join(root, "transcript.log"),
      Buffer.alloc(transcript.length, "x"),
    );
    assert.throws(
      () => verifyReleaseEvidenceFiles(paths),
      /attachment transcript SHA-256/,
    );
    rmSync(join(root, "transcript.log"));
    assert.throws(() => verifyReleaseEvidenceFiles(paths), /ENOENT/);
  });
});

test("CLI requires explicit complete inputs; no partial profile fallback", () => {
  for (const args of [
    [],
    ["--profile", PROFILE],
    ["--profile", "unknown"],
    ["--evidence"],
    ["--profile", PROFILE, "--profile", PROFILE],
    ["--unexpected", "value"],
  ]) {
    assert.throws(() => runEvidenceCli(args), /Release evidence rejected/);
  }
});

test("attachment junctions/symlinks cannot escape evidence root", () => {
  onDisk(({ paths, root, report, save }) => {
    const outside = mkdtempSync(join(tmpdir(), "agentshare-evidence-outside-"));
    try {
      writeFileSync(join(outside, "transcript.log"), transcript);
      symlinkSync(
        outside,
        join(root, "outside"),
        process.platform === "win32" ? "junction" : "dir",
      );
      report.attachments[0].path = "outside/transcript.log";
      save();
      assert.throws(
        () => verifyReleaseEvidenceFiles(paths),
        /attachment escapes report directory/,
      );
    } finally {
      rmSync(join(root, "outside"), { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});

test("both entrypoints validate fixtures offline and return nonzero for false exit 0", () => {
  onDisk(({ paths, report, save }) => {
    const args = [
      "--profile",
      PROFILE,
      "--evidence",
      paths.evidence,
      "--candidate",
      paths.candidate,
      "--artifact",
      paths.artifact,
    ];
    for (const entrypoint of ["release-evidence.mjs", "test-release.mjs"]) {
      const script = join(import.meta.dirname, entrypoint);
      const run = () =>
        spawnSync(process.execPath, [script, ...args], {
          encoding: "utf8",
          timeout: 10_000,
        });
      const accepted = run();
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.match(accepted.stdout, /Evidence contract verified/);
      report.checks[2].status = "cancelled";
      save();
      const rejected = run();
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.doesNotMatch(rejected.stdout, /verified/);
      report.checks[2].status = "passed";
      save();
    }
  });
});

test("legacy default still requires production origins and is explicitly nonpromotable", () => {
  const env = { ...process.env };
  delete env.AGENTSHARE_E2E_RELAY;
  delete env.AGENTSHARE_E2E_HANDOFF;
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "test-release.mjs")],
    { env, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LEGACY BOTH-AGENT GATE/);
  assert.match(result.stderr, /not promotable/);
  assert.match(result.stderr, /AGENTSHARE_E2E_RELAY is required/);
});

test("legacy default retains both-agent selection and propagates child failure", () => {
  onDisk(({ root }) => {
    const stubDir = join(root, "node_modules", "vitest");
    mkdirSync(stubDir, { recursive: true });
    // Stub only the child boundary. No legacy tests, agent, or network run here.
    writeFileSync(
      join(stubDir, "vitest.mjs"),
      "console.log(JSON.stringify({targets:process.env.AGENTSHARE_REAL_AGENT_TARGETS,enabled:process.env.AGENTSHARE_REAL_AGENT_E2E,args:process.argv.slice(2)})); process.exit(Number(process.env.FIXTURE_EXIT_CODE));",
    );
    const env = {
      ...process.env,
      AGENTSHARE_E2E_RELAY: "https://relay.example.test",
      AGENTSHARE_E2E_HANDOFF: "https://handoff.example.test",
      FIXTURE_EXIT_CODE: "0",
    };
    delete env.AGENTSHARE_REAL_AGENT_TARGETS;
    const run = () =>
      spawnSync(
        process.execPath,
        [join(import.meta.dirname, "test-release.mjs")],
        { cwd: root, env, encoding: "utf8", timeout: 10_000 },
      );
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), {
      targets: "codex,claude",
      enabled: "1",
      args: [
        "run",
        "packages/cli/src/public-handoff.e2e.test.ts",
        "packages/cli/src/environment/public-environment.e2e.test.ts",
        "packages/cli/src/launcher.security.e2e.test.ts",
        "--reporter=verbose",
      ],
    });
    assert.match(success.stderr, /not promotable/);
    env.FIXTURE_EXIT_CODE = "7";
    assert.equal(run().status, 7);
    env.AGENTSHARE_REAL_AGENT_TARGETS = "codex";
    const partial = run();
    assert.equal(partial.status, 1);
    assert.match(partial.stderr, /always runs both agents/);
  });
});
