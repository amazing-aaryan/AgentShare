import { emitKeypressEvents } from "node:readline";
import { sanitizeTerminalText } from "../terminal.js";
import { moveSelection } from "./share-flow.js";

export async function chooseOption(
  title: string,
  options: readonly string[],
  initial = 0,
): Promise<number> {
  if (options.length === 0) throw new Error("Selection must contain an option");
  if (!process.stdin.isTTY || !process.stdout.isTTY) return initial;
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let selected = initial;
  render(title, options, selected);
  return await new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(Boolean(wasRaw));
      if (!wasRaw) process.stdin.pause();
    };
    const onKey = (_input: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("AgentShare cancelled"));
        return;
      }
      if (key.name === "escape") {
        cleanup();
        reject(new Error("AgentShare cancelled"));
        return;
      }
      if (key.name === "up")
        selected = moveSelection(selected, -1, options.length);
      else if (key.name === "down")
        selected = moveSelection(selected, 1, options.length);
      else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(selected);
        return;
      } else return;
      render(title, options, selected);
    };
    process.stdin.on("keypress", onKey);
  });
}

function render(
  title: string,
  options: readonly string[],
  selected: number,
): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(`${sanitizeTerminalText(title)}\n\n`);
  options.forEach((option, index) => {
    process.stdout.write(
      `${index === selected ? ">" : " "} ${sanitizeTerminalText(option)}\n`,
    );
  });
  process.stdout.write("\nUp/Down choose - Enter continue - Esc cancel\n");
}
