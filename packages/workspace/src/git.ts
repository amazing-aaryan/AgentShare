import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function listGitShareableFiles(root: string): Promise<string[] | undefined> {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "buffer",
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return Buffer.from(stdout)
      .toString("utf8")
      .split("\0")
      .filter((value) => value.length > 0)
      .sort((a, b) => a.localeCompare(b, "en"));
  } catch {
    return undefined;
  }
}
