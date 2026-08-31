import { createHash } from "node:crypto";
import type { AcbManifest } from "@agentshare/contracts";
import { scanAndRedact, type SecretFinding } from "@agentshare/scanner";
import {
  buildWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../workspace/index.js";
import type { HostCapture, PublicationSummary } from "./publication.js";

export type EnvironmentPublicationPreview = {
  summary: PublicationSummary;
  includedPaths: string[];
  excluded: Array<{ path: string; reason: string }>;
  findings: SecretFinding[];
};

export type PreparedCapture = EnvironmentPublicationPreview & {
  version: 1;
  scannerVersion: "strict-utf8-v1";
  capture: HostCapture;
  snapshot: WorkspaceSnapshot;
  digest: string;
};

export function verifyPreparedCapture(
  value: unknown,
): asserts value is PreparedCapture {
  if (value === null || typeof value !== "object")
    throw new Error("Invalid prepared capture");
  const prepared = value as Partial<PreparedCapture>;
  const { digest, ...payload } = prepared;
  if (
    prepared.version !== 1 ||
    prepared.scannerVersion !== "strict-utf8-v1" ||
    digest !==
      createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  ) {
    throw new Error("Prepared capture changed; prepare and review again");
  }
}

export async function previewEnvironmentCapture(
  capture: HostCapture,
  options: {
    includeConversation: boolean;
    includeWorkspace: boolean;
    proposalsEnabled: boolean;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  },
): Promise<PreparedCapture> {
  if (!options.includeConversation && !options.includeWorkspace) {
    throw new Error(
      "AgentShare environment must include conversation, workspace, or both",
    );
  }
  const snapshot = options.includeWorkspace
    ? await buildWorkspaceSnapshot(
        capture.workspaceRoot,
        options.workspaceOptions,
      )
    : emptySnapshot(capture.workspaceRoot);
  return prepareCapturedSnapshot(capture, snapshot, options);
}

export function prepareCapturedSnapshot(
  capture: HostCapture,
  snapshot: WorkspaceSnapshot,
  options: { includeConversation: boolean; proposalsEnabled: boolean },
): PreparedCapture {
  const scanned = scanAndRedact(
    snapshotToAcb(capture, snapshot, options.includeConversation),
  );
  const metadata = scanAndRedact({
    version: "acb-v1",
    sourceAgent: capture.sourceAgent,
    title: snapshot.rootName,
    exportedAt: new Date(0).toISOString(),
    events: [],
    resources: [],
  });
  const retained: WorkspaceSnapshot = {
    ...snapshot,
    rootName: metadata.manifest.title,
    files: snapshot.files.map((file, index) => {
      const resource = scanned.manifest.resources[index];
      if (resource?.sourcePath !== file.path) {
        throw new Error("Scanned workspace paths changed; cannot publish");
      }
      return {
        ...file,
        mediaType: resource.mediaType,
        byteLength: resource.byteLength,
        sha256: resource.sha256,
        contentBase64: resource.contentBase64,
      };
    }),
    totalBytes: scanned.manifest.resources.reduce(
      (sum, file) => sum + file.byteLength,
      0,
    ),
  };
  const payload = {
    version: 1 as const,
    scannerVersion: "strict-utf8-v1" as const,
    capture: {
      ...capture,
      title: scanned.manifest.title,
      conversation: scanned.manifest.events,
    },
    snapshot: retained,
    summary: {
      files: scanned.manifest.resources.length,
      conversationEvents: scanned.manifest.events.length,
      totalWorkspaceBytes: retained.totalBytes,
      excludedFiles: snapshot.excluded.length,
      redactions: scanned.findings.length + metadata.findings.length,
      proposalsEnabled: options.proposalsEnabled,
    },
    includedPaths: snapshot.files.map((file) => file.path),
    excluded: snapshot.excluded,
    findings: [...scanned.findings, ...metadata.findings],
  };
  // Detach from the caller's mutable conversation and file objects.
  const detached = structuredClone(payload);
  return {
    ...detached,
    digest: createHash("sha256").update(JSON.stringify(detached)).digest("hex"),
  };
}

function snapshotToAcb(
  capture: HostCapture,
  snapshot: WorkspaceSnapshot,
  includeConversation: boolean,
): AcbManifest {
  return {
    version: "acb-v1",
    title: capture.title,
    sourceAgent: capture.sourceAgent,
    exportedAt: new Date().toISOString(),
    events: includeConversation ? capture.conversation : [],
    resources: snapshot.files.map((file, index) => ({
      id: `workspace-${index}`,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      sha256: file.sha256,
      contentBase64: file.contentBase64,
      sourcePath: file.path,
    })),
  };
}

function emptySnapshot(root: string): WorkspaceSnapshot {
  const rootName = root.replace(/\\/gu, "/").split("/").filter(Boolean).at(-1);
  return {
    root,
    rootName: rootName ?? "workspace",
    files: [],
    excluded: [],
    totalBytes: 0,
  };
}
