import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(file, from, to) {
  const current = readFileSync(file, "utf8");
  if (!current.includes(from)) {
    throw new Error(`Expected pattern not found in ${file}: ${JSON.stringify(from)}`);
  }
  writeFileSync(file, current.replace(from, to));
}

const objectFile = "apps/edge-relay/src/environment-object.ts";
replaceExact(objectFile, 'import { Buffer } from "node:buffer";\n', "");
replaceExact(
  objectFile,
  '          const bytes = Uint8Array.from(\n            Buffer.from(body.ciphertextBase64, "base64"),\n          );',
  "          const bytes = decodeBase64(body.ciphertextBase64);",
);
replaceExact(
  objectFile,
  "async function readJson(request: Request, maxBytes: number): Promise<unknown> {",
  `function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new BadRequestError("Invalid proposal ciphertext encoding");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {`,
);
replaceExact(
  objectFile,
  '    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;',
  "    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;",
);
replaceExact(
  objectFile,
  "  return Uint8Array.from(Buffer.concat(chunks, total));",
  `  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;`,
);

const objectTest = "apps/edge-relay/src/environment-object.test.ts";
replaceExact(objectTest, 'import { Buffer } from "node:buffer";\n', "");
replaceExact(
  objectTest,
  `function id(prefix: string): string {
  return \`\${prefix}_\${randomCapability(18)}\`;
}`,
  `function id(prefix: string): string {
  return \`\${prefix}_\${randomCapability(18)}\`;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

function base64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}`,
);
replaceExact(
  objectTest,
  '    const manifest = Buffer.from("encrypted manifest");',
  '    const manifest = bytes("encrypted manifest");',
);
replaceExact(
  objectTest,
  '    const blob = Buffer.from("encrypted blob");',
  '    const blob = bytes("encrypted blob");',
);
replaceExact(
  objectTest,
  "      Buffer.from(\n        await (",
  "      new Uint8Array(\n        await (",
);
replaceExact(
  objectTest,
  '    const proposal = Buffer.from("encrypted proposal");',
  '    const proposal = bytes("encrypted proposal");',
);
replaceExact(
  objectTest,
  '                ciphertextBase64: proposal.toString("base64"),',
  "                ciphertextBase64: base64(proposal),",
);

const quotaTest = "apps/edge-relay/src/environment-quota.test.ts";
replaceExact(quotaTest, 'import { Buffer } from "node:buffer";\n', "");
replaceExact(
  quotaTest,
  `function auth(capability: string): Record<string, string> {
  return { authorization: \`Bearer \${capability}\` };
}`,
  `function auth(capability: string): Record<string, string> {
  return { authorization: \`Bearer \${capability}\` };
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}`,
);
replaceExact(
  quotaTest,
  '    const manifest = Buffer.from("encrypted manifest");',
  '    const manifest = bytes("encrypted manifest");',
);
replaceExact(
  quotaTest,
  '    const blob = Buffer.from("encrypted blob");',
  '    const blob = bytes("encrypted blob");',
);
