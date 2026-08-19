import type { AcbManifest } from "@agentshare/contracts";
import { scanAndRedact, type SecretFinding } from "@agentshare/scanner";
import {
  buildWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../workspace/index.js";
import type {
  HostCapture,
  PublicationSummary,
} from "./publication.js";

export type EnvironmentPublicationPreview = {
  summary: PublicationSummary;
  includedPaths: string[];
  excluded: Array<{ path: string; reason: string }>;
  findings: SecretFinding[];
};

export async function previewEnvironmentCapture(
  capture: HostCapture,
  options: {
    includeConversation: boolean;
    includeWorkspace: boolean;
    proposalsEnabled: boolean;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  },
): Promise<EnvironmentPublicationPreview> {
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
  const scanned = scanAndRedact(
    snapshotToAcb(capture, snapshot, options.includeConversation),
  );
  return {
    summary: {
      files: scanned.manifest.resources.length,
      conversationEvents: scanned.manifest.events.length,
      totalWorkspaceBytes: snapshot.totalBytes,
      excludedFiles: snapshot.excluded.length,
      redactions: scanned.findings.length,
      proposalsEnabled: options.proposalsEnabled,
    },
    includedPaths: snapshot.files.map((file) => file.path),
    excluded: snapshot.excluded,
    findings: scanned.findings,
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
