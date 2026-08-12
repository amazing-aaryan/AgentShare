import { createInterface } from "node:readline/promises";

export function sanitizeTerminalText(value: string): string {
  return Array.from(value)
    .filter((character) => !isUnsafeTerminalCodePoint(character.codePointAt(0)))
    .join("");
}

function isUnsafeTerminalCodePoint(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return true;
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    (codePoint >= 11 && codePoint <= 31) ||
    (codePoint >= 127 && codePoint <= 159) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export async function confirm(prompt: string): Promise<boolean> {
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (
      (await input.question(`${prompt} [y/N] `)).trim().toLocaleLowerCase() ===
      "y"
    );
  } finally {
    input.close();
  }
}

export async function readHiddenLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error(
      "Capability URL must be entered in an interactive terminal",
    );
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\u0003") {
            cleanup();
            reject(new Error("Cancelled"));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            process.stdout.write("\n");
            resolve(value);
            return;
          }
          if (character === "\b" || character === "\u007f")
            value = value.slice(0, -1);
          else value += character;
        }
      };
      const cleanup = () => process.stdin.off("data", onData);
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
