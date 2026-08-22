import { describe, expect, it } from "vitest";
import {
  environmentManifestSchema,
  sharedWorkspacePathSchema,
} from "./environment.js";

const hex = "a".repeat(64);

function validManifest() {
  return {
    version: "agentshare-environment-v2",
    environmentId: "env_12345678901234567890",
    revisionId: "rev_12345678901234567890",
    createdAt: "2026-08-19T00:00:00.000Z",
    title: "AgentShare",
    sourceAgent: "codex",
    conversation: { events: [] },
    workspace: {
      rootName: "AgentShare",
      files: [
        {
          resourceId: "res_12345678901234567890",
          path: "packages/cli/src/bin.ts",
          mediaType: "text/typescript",
          byteLength: 12,
          sha256: hex,
          executable: false,
          blobs: [
            {
              blobId: "blob_12345678901234567890",
              byteOffset: 0,
              byteLength: 12,
            },
          ],
        },
      ],
    },
    proposalPolicy: { enabled: false },
  };
}

describe("sharedWorkspacePathSchema", () => {
  it("accepts normalized relative workspace paths", () => {
    expect(sharedWorkspacePathSchema.parse("packages/cli/src/bin.ts")).toBe(
      "packages/cli/src/bin.ts",
    );
  });

  it.each([
    "../secret",
    "a/../secret",
    "/etc/passwd",
    "C:/Users/a/.ssh/id_rsa",
    ".git/config",
    ".agentshare/state-v2.json",
    "a//b",
    "a/./b",
    "a\\b",
  ])("rejects unsafe path %s", (path) =>
    expect(() => sharedWorkspacePathSchema.parse(path)).toThrow(),
  );
});

describe("environmentManifestSchema", () => {
  it("accepts a valid workspace revision manifest", () => {
    expect(
      environmentManifestSchema.parse(validManifest()).workspace.files,
    ).toHaveLength(1);
  });

  it("accepts an enabled proposal policy with a public key", () => {
    const input = {
      ...validManifest(),
      proposalPolicy: { enabled: true, encryptionPublicKey: "k".repeat(43) },
    };
    expect(environmentManifestSchema.parse(input).proposalPolicy.enabled).toBe(
      true,
    );
  });

  it("requires a proposal public key when proposals are enabled", () => {
    const input = {
      ...validManifest(),
      proposalPolicy: { enabled: true },
    };
    expect(() => environmentManifestSchema.parse(input)).toThrow();
  });

  it("requires parentRevisionId to differ from revisionId", () => {
    const valid = validManifest();
    const input = { ...valid, parentRevisionId: valid.revisionId };
    expect(() => environmentManifestSchema.parse(input)).toThrow();
  });

  it("rejects duplicate workspace paths", () => {
    const input = validManifest();
    input.workspace.files.push({
      ...input.workspace.files[0]!,
      resourceId: "res_22222222222222222222",
      blobs: [
        {
          blobId: "blob_22222222222222222222",
          byteOffset: 0,
          byteLength: 12,
        },
      ],
    });
    expect(() => environmentManifestSchema.parse(input)).toThrow();
  });

  it("requires declared blob lengths to equal the file length", () => {
    const input = validManifest();
    input.workspace.files[0]!.blobs[0]!.byteLength = 11;
    expect(() => environmentManifestSchema.parse(input)).toThrow();
  });
});
