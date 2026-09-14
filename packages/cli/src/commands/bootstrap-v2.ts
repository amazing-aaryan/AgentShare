import { installIntegrations } from "@agentshare/integrations";
import { acceptEnvironmentLink } from "../environment/accept.js";
import { readHiddenLine } from "../terminal.js";

export async function bootstrapEnvironment(
  options: { statePath?: string; cacheRoot?: string; link?: string } = {},
): Promise<Awaited<ReturnType<typeof acceptEnvironmentLink>>> {
  await installIntegrations();
  const link = options.link ?? (await readCapabilityInput());
  return acceptEnvironmentLink(link, {
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined
      ? {}
      : { cacheRoot: options.cacheRoot }),
  });
}

export async function readCapabilityInput(): Promise<string> {
  if (process.stdin.isTTY)
    return readHiddenLine("AgentShare environment link: ");
  return capabilityLine(await readStdinText());
}

export function capabilityLine(input: string): string {
  const lines = input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1 || lines[0] === undefined) {
    throw new Error("AgentShare bootstrap expects exactly one capability URL");
  }
  return lines[0];
}

async function readStdinText(): Promise<string> {
  const decoder = new TextDecoder();
  let input = "";
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (typeof chunk === "string") {
      input += chunk;
    } else if (chunk instanceof Uint8Array) {
      input += decoder.decode(chunk, { stream: true });
    } else {
      throw new Error("AgentShare bootstrap received invalid stdin data");
    }
  }
  return input + decoder.decode();
}
