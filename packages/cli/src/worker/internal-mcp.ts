import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { ProposalOperation } from "@agentshare/contracts";
import {
  readAttachedFile,
  readAttachedManifest,
  searchAttachedEnvironment,
} from "../environment/accept.js";
import { refreshAttachedEnvironment } from "../environment/refresh.js";
import { findAttachedEnvironment } from "../environment/state.js";
import { submitProposalOperations } from "../proposals/submit.js";

export type McpRuntime = {
  canPropose: boolean;
  environmentInfo: () => Promise<unknown>;
  listFiles: () => Promise<unknown>;
  search: (query: string) => Promise<unknown>;
  readFile: (path: string) => Promise<unknown>;
  readConversation: (query?: string) => Promise<unknown>;
  stageReplace: (path: string, content: string) => Promise<unknown>;
  stageCreate: (path: string, content: string, mediaType?: string) => Promise<unknown>;
  stageDelete: (path: string) => Promise<unknown>;
  proposalDiff: () => Promise<unknown>;
  proposalSubmit: (summary: string) => Promise<unknown>;
};

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

const READ_TOOLS = [
  tool("environment_info", "Describe the attached AgentShare environment.", {}),
  tool("list_files", "List paths in the shared read-only workspace.", {}),
  tool("search", "Search shared files and conversation evidence.", {
    query: { type: "string" },
  }, ["query"]),
  tool("read_file", "Read one shared text file by relative path.", {
    path: { type: "string" },
  }, ["path"]),
  tool("read_conversation", "Read shared conversation events, optionally filtered by text.", {
    query: { type: "string" },
  }),
] as const;

const PROPOSAL_TOOLS = [
  tool("proposal_stage_replace", "Stage a full-file replacement proposal; this never writes UserA's workspace.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  tool("proposal_stage_create", "Stage creation of a new text file in the proposal overlay.", {
    path: { type: "string" },
    content: { type: "string" },
    mediaType: { type: "string" },
  }, ["path", "content"]),
  tool("proposal_stage_delete", "Stage deletion of a shared file in the proposal overlay.", {
    path: { type: "string" },
  }, ["path"]),
  tool("proposal_diff", "Review the currently staged proposal operations.", {}),
  tool("proposal_submit", "Encrypt and submit the staged proposal to UserA for approval.", {
    summary: { type: "string" },
  }, ["summary"]),
] as const;

export async function handleMcpRequest(
  request: JsonRpcRequest,
  runtime: McpRuntime,
): Promise<JsonRpcResponse | undefined> {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return responseError(request.id, -32600, "Invalid JSON-RPC request");
  }
  if (request.method.startsWith("notifications/")) return undefined;
  if (request.method === "initialize") {
    const params = asObject(request.params);
    return responseResult(request.id, {
      protocolVersion:
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agentshare", version: "0.2.0" },
    });
  }
  if (request.method === "ping") return responseResult(request.id, {});
  if (request.method === "tools/list") {
    return responseResult(request.id, {
      tools: runtime.canPropose
        ? [...READ_TOOLS, ...PROPOSAL_TOOLS]
        : [...READ_TOOLS],
    });
  }
  if (request.method !== "tools/call") {
    return responseError(request.id, -32601, "Method not found");
  }
  try {
    const params = asObject(request.params);
    const name = requiredString(params, "name");
    const args = asObject(params.arguments);
    let value: unknown;
    switch (name) {
      case "environment_info":
        value = await runtime.environmentInfo();
        break;
      case "list_files":
        value = await runtime.listFiles();
        break;
      case "search":
        value = await runtime.search(requiredString(args, "query"));
        break;
      case "read_file":
        value = await runtime.readFile(requiredString(args, "path"));
        break;
      case "read_conversation":
        value = await runtime.readConversation(optionalString(args, "query"));
        break;
      case "proposal_stage_replace":
        assertProposals(runtime);
        value = await runtime.stageReplace(
          requiredString(args, "path"),
          requiredString(args, "content"),
        );
        break;
      case "proposal_stage_create":
        assertProposals(runtime);
        value = await runtime.stageCreate(
          requiredString(args, "path"),
          requiredString(args, "content"),
          optionalString(args, "mediaType"),
        );
        break;
      case "proposal_stage_delete":
        assertProposals(runtime);
        value = await runtime.stageDelete(requiredString(args, "path"));
        break;
      case "proposal_diff":
        assertProposals(runtime);
        value = await runtime.proposalDiff();
        break;
      case "proposal_submit":
        assertProposals(runtime);
        value = await runtime.proposalSubmit(requiredString(args, "summary"));
        break;
      default:
        return responseError(request.id, -32602, `Unknown AgentShare tool: ${name}`);
    }
    return responseResult(request.id, {
      content: [{ type: "text", text: stringify(value) }],
      isError: false,
    });
  } catch (error) {
    return responseResult(request.id, {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    });
  }
}

export async function createEnvironmentMcpRuntime(
  environmentId: string,
  options: { statePath?: string; cacheRoot?: string } = {},
): Promise<McpRuntime> {
  const attached = await findAttachedEnvironment(environmentId, options.statePath);
  if (attached === undefined) {
    throw new Error(`AgentShare environment is not attached: ${environmentId}`);
  }
  const staged = new Map<string, ProposalOperation>();
  const readOptions = {
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  };
  const sync = () => refreshAttachedEnvironment(environmentId, readOptions);
  return {
    canPropose: attached.proposalCapability !== undefined,
    async environmentInfo() {
      await sync();
      const manifest = await readAttachedManifest(environmentId, readOptions);
      return {
        environmentId,
        title: manifest.title,
        revisionId: manifest.revisionId,
        files: manifest.workspace.files.length,
        conversationEvents: manifest.conversation.events.length,
        canPropose: manifest.proposalPolicy.enabled,
      };
    },
    async listFiles() {
      await sync();
      return (await readAttachedManifest(environmentId, readOptions)).workspace.files.map(
        (file) => file.path,
      );
    },
    async search(query: string) {
      await sync();
      return searchAttachedEnvironment(environmentId, query, readOptions);
    },
    async readFile(path: string) {
      await sync();
      return readAttachedFile(environmentId, path, readOptions);
    },
    async readConversation(query?: string) {
      await sync();
      const events = (await readAttachedManifest(environmentId, readOptions)).conversation.events;
      if (query === undefined || query.trim().length === 0) return events;
      const needle = query.toLocaleLowerCase("en-US");
      return events.filter((event) =>
        event.text.toLocaleLowerCase("en-US").includes(needle),
      );
    },
    async stageReplace(path: string, content: string) {
      await sync();
      const manifest = await readAttachedManifest(environmentId, readOptions);
      const file = manifest.workspace.files.find((candidate) => candidate.path === path);
      if (file === undefined) throw new Error(`Shared file not found: ${path}`);
      staged.set(path, {
        type: "replace",
        path,
        baseSha256: file.sha256,
        newSha256: sha256(Buffer.from(content, "utf8")),
        mediaType: file.mediaType,
        contentBase64: Buffer.from(content, "utf8").toString("base64"),
      });
      return { staged: "replace", path };
    },
    async stageCreate(path: string, content: string, mediaType?: string) {
      await sync();
      const manifest = await readAttachedManifest(environmentId, readOptions);
      if (manifest.workspace.files.some((candidate) => candidate.path === path)) {
        throw new Error(`Shared file already exists: ${path}`);
      }
      staged.set(path, {
        type: "create",
        path,
        newSha256: sha256(Buffer.from(content, "utf8")),
        mediaType: mediaType ?? "text/plain",
        contentBase64: Buffer.from(content, "utf8").toString("base64"),
      });
      return { staged: "create", path };
    },
    async stageDelete(path: string) {
      await sync();
      const manifest = await readAttachedManifest(environmentId, readOptions);
      const file = manifest.workspace.files.find((candidate) => candidate.path === path);
      if (file === undefined) throw new Error(`Shared file not found: ${path}`);
      staged.set(path, { type: "delete", path, baseSha256: file.sha256 });
      return { staged: "delete", path };
    },
    async proposalDiff() {
      return [...staged.values()].map((operation) => ({
        type: operation.type,
        path: operation.path,
        ...(operation.type === "delete"
          ? {}
          : { newBytes: Buffer.from(operation.contentBase64, "base64").byteLength }),
      }));
    },
    async proposalSubmit(summary: string) {
      if (staged.size === 0) throw new Error("No proposal changes are staged");
      await sync();
      const proposal = await submitProposalOperations(
        environmentId,
        summary,
        [...staged.values()],
        readOptions,
      );
      staged.clear();
      return { proposalId: proposal.proposalId, summary: proposal.summary };
    },
  };
}

export async function runInternalMcpServer(
  environmentId: string,
  options: { statePath?: string; cacheRoot?: string } = {},
): Promise<void> {
  const runtime = await createEnvironmentMcpRuntime(environmentId, options);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.trim().length === 0) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify(responseError(null, -32700, "Parse error"))}\n`,
      );
      continue;
    }
    const response = await handleMcpRequest(request, runtime);
    if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: false,
      ...(required.length === 0 ? {} : { required }),
    },
  };
}

function responseResult(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function responseError(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function assertProposals(runtime: McpRuntime): void {
  if (!runtime.canPropose) throw new Error("This AgentShare environment is read-only");
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
