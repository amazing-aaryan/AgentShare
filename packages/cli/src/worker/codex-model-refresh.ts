import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Fetch provider metadata only: no thread, prompt, or shared context is sent. */
export async function refreshCodexModelCache(
  executable: { command: string; prefixArgs: string[] },
  privateHome: string,
  timeoutMs = 30_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable.command,
      [
        ...executable.prefixArgs,
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        "features.plugins=false",
        "-c",
        "features.hooks=false",
        "-c",
        "features.apps=false",
      ],
      {
        cwd: privateHome,
        env: refreshEnvironment(privateHome),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdout });
    let finished = false;
    let settled = false;
    let failure: Error | undefined;
    let bytes = 0;
    const abort = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      void terminateRefresh(child).finally(() => reject(error));
    };
    const finish = (error?: Error) => {
      if (error) {
        abort(error);
        return;
      }
      if (finished) return;
      finished = true;
      failure = error;
      child.stdin.end();
    };
    const timer = setTimeout(
      () =>
        abort(
          new Error(
            "Codex model metadata refresh timed out; check the Codex login and connection, then retry AgentShare",
          ),
        ),
      timeoutMs,
    );
    child.stderr.resume(); // Never expose provider/authentication diagnostics.
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024)
        finish(new Error("Codex model metadata response exceeded its limit"));
    });
    const send = (value: unknown) =>
      child.stdin.write(`${JSON.stringify(value)}\n`);
    child.stdin.on("error", () =>
      finish(new Error("Codex model metadata refresh disconnected")),
    );
    lines.on("line", (line) => {
      if (finished) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(
          new Error(
            "Codex could not refresh model metadata; check the Codex login and connection, then retry AgentShare",
          ),
        );
      } else if (message.id === 1) {
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "model/list", params: { includeHidden: true } });
      } else if (
        isRecord(message.result) &&
        Array.isArray(message.result.data)
      ) {
        finish();
      } else {
        finish(new Error("Codex returned invalid model metadata"));
      }
    });
    child.once("error", () => {
      finish(new Error("Codex could not start model metadata refresh"));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      if (!finished)
        failure = new Error("Codex closed before refreshing model metadata");
      else if (code !== 0)
        failure = new Error(
          "Codex model metadata refresh failed to exit cleanly",
        );
      if (failure) reject(failure);
      else resolve();
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "agentshare-model-refresh", version: "1" },
      },
    });
  });
}

function refreshEnvironment(privateHome: string): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "TMP",
    "TEMP",
    "NO_COLOR",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        allowed.has(key.toUpperCase()),
      ),
    ),
    CODEX_HOME: privateHome,
  };
}

async function terminateRefresh(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (process.platform === "win32" && child.pid !== undefined) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 3_000);
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      killer.once("close", done);
      killer.once("error", () => {
        child.kill();
        done();
      });
    });
  } else if (child.pid !== undefined) {
    const pid = child.pid;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 3_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill();
      }
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
