import { createInterface } from "node:readline/promises";

export function sanitizeTerminalText(value: string): string {
  return value.replace(UNSAFE_TERMINAL_CONTROL, "");
}

const UNSAFE_TERMINAL_CONTROL =
  // Terminal safety intentionally requires matching these control ranges.
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu;

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
