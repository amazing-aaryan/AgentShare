export type ShareSelection = {
  scope: number;
  access: number;
  expiry: number;
};

export type SelectedShareOptions = {
  includeConversation: boolean;
  includeWorkspace: boolean;
  proposalsEnabled: boolean;
  ttlSeconds: number;
};

export const SHARE_SCOPE_OPTIONS = [
  "Conversation + current project",
  "Conversation only",
  "Current project only",
] as const;

export const SHARE_ACCESS_OPTIONS = [
  "Read + propose changes",
  "Read only",
] as const;

export const SHARE_EXPIRY_OPTIONS = ["1 hour", "24 hours", "72 hours"] as const;

export function defaultShareSelection(): ShareSelection {
  return { scope: 0, access: 0, expiry: 1 };
}

export function moveSelection(
  current: number,
  direction: -1 | 1,
  length: number,
): number {
  if (length <= 0) throw new Error("Selection must contain an option");
  return (current + direction + length) % length;
}

export function selectionToShareOptions(
  selection: ShareSelection,
): SelectedShareOptions {
  const scope = [
    { includeConversation: true, includeWorkspace: true },
    { includeConversation: true, includeWorkspace: false },
    { includeConversation: false, includeWorkspace: true },
  ][selection.scope];
  if (scope === undefined) throw new Error("Invalid share scope selection");
  const ttlSeconds = [3600, 86400, 259200][selection.expiry];
  if (ttlSeconds === undefined) throw new Error("Invalid expiry selection");
  if (![0, 1].includes(selection.access)) {
    throw new Error("Invalid access selection");
  }
  return {
    ...scope,
    proposalsEnabled: selection.access === 0,
    ttlSeconds,
  };
}
