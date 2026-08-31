import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentShareProposal } from "@agentshare/contracts";
import { prepareCapturedSnapshot } from "../environment/preview.js";
import {
  loadEnvironmentState,
  type OwnedEnvironment,
} from "../environment/state.js";
import {
  approveOwnedProposal,
  prepareOwnedProposalReview,
  rejectOwnedProposal,
} from "../proposals/apply.js";
import { listOwnedProposals } from "../proposals/inbox.js";
import { chooseOption } from "../tui/input.js";
import { listPendingOwnedProposals, reviewProposalInbox } from "./inbox-v2.js";

vi.mock("../environment/state.js", () => ({ loadEnvironmentState: vi.fn() }));
vi.mock("../proposals/apply.js", () => ({
  approveOwnedProposal: vi.fn(),
  prepareOwnedProposalReview: vi.fn(),
  rejectOwnedProposal: vi.fn(),
}));
vi.mock("../proposals/inbox.js", () => ({ listOwnedProposals: vi.fn() }));
vi.mock("../tui/input.js", () => ({ chooseOption: vi.fn() }));

const inputTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const outputTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}
afterEach(() => {
  vi.restoreAllMocks();
  if (inputTTY === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
  else Object.defineProperty(process.stdin, "isTTY", inputTTY);
  if (outputTTY === undefined) Reflect.deleteProperty(process.stdout, "isTTY");
  else Object.defineProperty(process.stdout, "isTTY", outputTTY);
});

function fixture(
  bytes = Buffer.from("approved new text\r\n"),
  mediaType = "text/plain",
) {
  const environment: OwnedEnvironment = {
    environmentId: `env_${"e".repeat(24)}`,
    currentRevisionId: `rev_${"r".repeat(24)}`,
    relayOrigin: "http://127.0.0.1:8787",
    workspaceRoot: "never-read-owner-workspace",
    environmentMasterKey: "unused",
    readCapability: "unused",
    updateCapability: "unused",
    inboxCapability: "unused",
    revokeCapability: "unused",
    proposalPrivateKey: "unused",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sharePolicy: {
      includeWorkspace: true,
      includeConversation: false,
      proposalsEnabled: true,
    },
  };
  const original = Buffer.from("approved old text\r\n");
  const hash = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const base = prepareCapturedSnapshot(
    {
      sourceAgent: "codex",
      title: "Shared base",
      workspaceRoot: environment.workspaceRoot,
      conversation: [],
    },
    {
      root: environment.workspaceRoot,
      rootName: "workspace",
      excluded: [],
      totalBytes: original.length,
      files: [
        {
          path: "file.txt",
          mediaType: "text/plain",
          byteLength: original.length,
          sha256: hash(original),
          executable: false,
          contentBase64: original.toString("base64"),
        },
      ],
    },
    { includeConversation: false, proposalsEnabled: true },
  );
  const proposal: AgentShareProposal = {
    version: "agentshare-proposal-v1",
    proposalId: `prop_${"p".repeat(24)}`,
    environmentId: environment.environmentId,
    baseRevisionId: environment.currentRevisionId ?? "",
    createdAt: new Date().toISOString(),
    summary: "Reviewed proposal",
    operations: [
      {
        type: "replace",
        path: "file.txt",
        mediaType,
        baseSha256: hash(original),
        newSha256: hash(bytes),
        contentBase64: bytes.toString("base64"),
      },
    ],
  };
  const review = {
    proposal,
    base,
    preparedCapture: base,
    digest: "approved-review-digest",
  };
  vi.mocked(loadEnvironmentState).mockResolvedValue({
    version: 3,
    ownedEnvironments: [environment],
    attachedEnvironments: [],
    transactions: [],
  });
  vi.mocked(listOwnedProposals).mockResolvedValue([
    { status: "pending", proposal },
  ]);
  vi.mocked(prepareOwnedProposalReview).mockResolvedValue(review);
  vi.mocked(approveOwnedProposal).mockResolvedValue({
    environment,
    summary: base.summary,
  });
  return { environment, proposal, review };
}

beforeEach(() => {
  vi.resetAllMocks();
  setTTY(true);
});

describe("proposal inbox consent", () => {
  it("keeps the shared-base diff in the decision prompt and defaults to Cancel", async () => {
    const setup = fixture();
    vi.mocked(chooseOption).mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await reviewProposalInbox(
      "codex",
      "state.json",
      setup.environment.environmentId,
    );
    const decision = vi.mocked(chooseOption).mock.calls[1];
    expect(decision?.[0]).toContain("- approved old text");
    expect(decision?.[0]).toContain("+ approved new text");
    expect(decision?.[0]).toContain(setup.review.digest);
    expect(decision?.[2]).toBe(2);
    expect(approveOwnedProposal).not.toHaveBeenCalled();
    expect(rejectOwnedProposal).not.toHaveBeenCalled();
  });

  it("binds approval to the reviewed digest without capturing a source session", async () => {
    const setup = fixture();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.mocked(chooseOption).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await reviewProposalInbox("claude", "state.json");
    expect(approveOwnedProposal).toHaveBeenCalledWith(
      setup.environment.environmentId,
      setup.proposal.proposalId,
      undefined,
      { statePath: "state.json", reviewDigest: setup.review.digest },
    );
  });

  it("shows binary descriptors without lossy decoding and sanitizes terminal controls", async () => {
    const setup = fixture(Buffer.from([0xff, 0xfe]), "text/plain");
    setup.review.proposal.summary = "Proposal\u001b[2J";
    vi.mocked(chooseOption).mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await reviewProposalInbox("codex");
    const title = vi.mocked(chooseOption).mock.calls[1]?.[0];
    expect(title).toContain("<binary: 2 bytes; sha256=");
    expect(title).not.toContain("\ufffd");
    expect(title).not.toContain("\u001b");
  });

  it("fails before diff/approval when the shared-base preflight rejects a proposal", async () => {
    fixture();
    vi.mocked(chooseOption).mockResolvedValueOnce(0);
    vi.mocked(prepareOwnedProposalReview).mockRejectedValueOnce(
      new Error("Unsafe proposal parent"),
    );
    await expect(reviewProposalInbox("codex")).rejects.toThrow(
      "Unsafe proposal parent",
    );
    expect(chooseOption).toHaveBeenCalledTimes(1);
    expect(approveOwnedProposal).not.toHaveBeenCalled();
  });

  it("scopes inbox loading to the requested environment", async () => {
    const setup = fixture();
    vi.mocked(loadEnvironmentState).mockResolvedValue({
      version: 3,
      ownedEnvironments: [
        setup.environment,
        { ...setup.environment, environmentId: `env_${"z".repeat(24)}` },
      ],
      attachedEnvironments: [],
      transactions: [],
    });
    await listPendingOwnedProposals(
      "state.json",
      setup.environment.environmentId,
    );
    expect(listOwnedProposals).toHaveBeenCalledTimes(1);
    expect(listOwnedProposals).toHaveBeenCalledWith(
      setup.environment.environmentId,
      { statePath: "state.json" },
    );
  });

  it("redacts noninteractive output and never auto-approves", async () => {
    const setup = fixture();
    const secret = `sk-${"s".repeat(24)}`;
    setup.proposal.summary = `Proposal ${secret}\u001b[2J`;
    setTTY(false);
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await reviewProposalInbox("codex");
    expect(String(output.mock.calls[0]?.[0])).not.toContain(secret);
    expect(String(output.mock.calls[0]?.[0])).toContain(
      "[REDACTED:openai-api-key]",
    );
    expect(chooseOption).not.toHaveBeenCalled();
    expect(approveOwnedProposal).not.toHaveBeenCalled();
  });
});
