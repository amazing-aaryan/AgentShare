import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { Script } from "node:vm";
import { desktopReviewPage } from "./desktop-review-page.js";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./environment/relay-client.js";
import { startDesktopShare } from "./desktop-review.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(lifetimeMs = 20_000) {
  const root = await mkdtemp(join(tmpdir(), "agentshare-desktop-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "safe.txt"), "Original retained file");
  const handler = createRelayHandler(new InMemoryRelayStore());
  const fetcher = vi.fn<typeof fetch>((url, init) =>
    handler(new Request(url, init)),
  );
  const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetcher);
  let now = Date.now();
  let capturedRoot = project;
  const capture = vi.fn(() =>
    Promise.resolve({
      sourceAgent: "codex" as const,
      title: "Synthetic desktop review",
      workspaceRoot: capturedRoot,
      conversation: [
        {
          sequence: 0,
          role: "user" as const,
          kind: "message" as const,
          sourceId: "synthetic",
          text: "Retained conversation <script>throw Error('unsafe')</script>",
        },
      ],
    }),
  );
  const app = await startDesktopShare({
    threadId: "synthetic-exact-thread",
    capture,
    statePath: join(root, "private", "state.json"),
    client,
    relayOrigin: client.origin,
    handoffOrigin: "http://127.0.0.1:8788",
    now: () => new Date(now),
    lifetimeMs,
  });
  cleanup.push(app.close);
  const origin = new URL(app.reviewUrl).origin;
  let cookie = "";
  let csrf = "";
  const request = (route: string, body?: unknown, extra = {}) =>
    fetch(origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie,
        "x-agentshare-csrf": csrf,
        "content-type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async () => {
    const response = await request("/api/session", {
      token: new URL(app.reviewUrl).hash.slice(1),
    });
    const cookieHeader = response.headers.get("set-cookie");
    if (cookieHeader === null) throw new Error("Missing review session cookie");
    cookie = cookieHeader.split(";")[0] ?? "";
    const data = (await response.json()) as { csrf: string };
    csrf = data.csrf;
    expect(response.status).toBe(200);
    return data;
  };
  const prepare = async () => {
    const response = await request("/api/prepare", {
      scope: "both",
      access: "read_propose",
      ttlSeconds: 3600,
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      draft: { draftId: string; digest: string };
      nonce: string;
    };
    return {
      draft: { draftId: data.draft.draftId, digest: data.draft.digest },
      nonce: data.nonce,
    };
  };
  return {
    app,
    origin,
    request,
    login,
    prepare,
    fetcher,
    capture,
    expire: () => (now += 30_000),
    moveRoot: () => (capturedRoot = join(root, "moved")),
  };
}

describe("desktop local review boundary", () => {
  it("emits a browser script that compiles before any user action", () => {
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(desktopReviewPage("synthetic-nonce"))?.[1];
    if (script === undefined) throw new Error("Missing browser review script");
    expect(() => new Script(script)).not.toThrow();
  });
  it("closes after expiry during a pending prepare and permits idempotent close", async () => {
    const f = await fixture(1000);
    await f.login();
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.capture.getMockImplementation();
    if (original === undefined) throw new Error("Missing synthetic capture");
    f.capture.mockImplementationOnce(async () => {
      entered();
      await gate;
      return original();
    });
    const preparing = f.request("/api/prepare", {
      scope: "conversation",
      access: "read",
      ttlSeconds: 3600,
    });
    await reached;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    release();
    expect((await preparing).status).toBe(410);
    await f.app.closed;
    await f.app.close();
    expect(await f.app.result).toBeUndefined();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("binds loopback and requires browser capability, cookie, origin and CSRF", async () => {
    const f = await fixture();
    expect(new URL(f.app.reviewUrl).hostname).toBe("127.0.0.1");
    const page = await fetch(f.origin);
    expect(page.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await page.text()).not.toContain("Retained conversation");
    expect((await f.request("/api/session")).status).toBe(401);
    expect((await f.request("/api/session", { token: "wrong" })).status).toBe(
      401,
    );
    await f.login();
    const options = { scope: "both", access: "read", ttlSeconds: 3600 };
    expect(
      (
        await f.request("/api/prepare", options, {
          origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    const untrustedHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = httpRequest(
          f.origin,
          { headers: { host: "evil.test" } },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(untrustedHost).toBe(403);
    expect(
      (
        await f.request("/api/prepare", options, {
          "x-agentshare-csrf": "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/api/prepare", { ...options, approved: true })).status,
    ).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("reviews retained bytes and publishes only the exact browser-approved draft once", async () => {
    const f = await fixture();
    await f.login();
    const { draft, nonce } = await f.prepare();
    const review = await f.request("/api/review?section=conversation");
    expect(((await review.json()) as { content: string }).content).toContain(
      "Retained conversation",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
    const commit = { ...draft, nonce };
    expect(
      (await f.request("/api/publish", { ...commit, digest: "stale" })).status,
    ).toBe(409);
    expect(
      (await f.request("/api/publish", { ...commit, nonce: "forged" })).status,
    ).toBe(403);
    const response = await f.request("/api/publish", commit);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { url: string }).url).toContain("/e/");
    const writes = f.fetcher.mock.calls.length;
    expect(
      (
        (await (await f.request("/api/status")).json()) as {
          published: { url: string };
        }
      ).published.url,
    ).toContain("/e/");
    expect((await f.request("/api/publish", commit)).status).toBe(200);
    expect(f.fetcher.mock.calls.length).toBe(writes);
    expect(
      (
        await f.request("/api/prepare", {
          scope: "conversation",
          access: "read",
          ttlSeconds: 3600,
        })
      ).status,
    ).toBe(409);
  });

  it("invalidates stale drafts, rejects changed roots and preserves expired/cancelled no-write behavior", async () => {
    const f = await fixture();
    await f.login();
    const first = await f.prepare();
    const second = await f.prepare();
    expect(
      (await f.request("/api/publish", { ...first.draft, nonce: first.nonce }))
        .status,
    ).toBe(409);
    f.expire();
    expect(
      (
        await f.request("/api/publish", {
          ...second.draft,
          nonce: second.nonce,
        })
      ).status,
    ).toBe(410);
    expect(f.fetcher).not.toHaveBeenCalled();
    const moved = await fixture();
    await moved.login();
    moved.moveRoot();
    expect(
      (
        await moved.request("/api/prepare", {
          scope: "both",
          access: "read",
          ttlSeconds: 3600,
        })
      ).status,
    ).toBe(400);
    expect(moved.fetcher).not.toHaveBeenCalled();
    const cancelled = await fixture();
    await cancelled.login();
    await cancelled.prepare();
    expect((await cancelled.request("/api/cancel", {})).status).toBe(200);
    expect(await cancelled.app.result).toBeUndefined();
    expect(cancelled.fetcher).not.toHaveBeenCalled();
  });

  it("serializes prepare/publish and retains the same draft after an uncertain response", async () => {
    const f = await fixture();
    await f.login();
    const current = await f.prepare();
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    f.fetcher.mockImplementationOnce(async () => {
      entered();
      await gate;
      throw new Error("Synthetic connection lost");
    });
    const publishing = f.request("/api/publish", {
      ...current.draft,
      nonce: current.nonce,
    });
    await reached;
    expect(
      (
        await f.request("/api/publish", {
          ...current.draft,
          nonce: current.nonce,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request("/api/prepare", {
          scope: "both",
          access: "read",
          ttlSeconds: 3600,
        })
      ).status,
    ).toBe(409);
    release();
    expect((await publishing).status).toBe(400);
    const status = await f.request("/api/status");
    expect(await status.json()).toMatchObject({
      draft: current.draft,
      publicationAttempted: true,
    });
    expect(
      (
        await f.request("/api/prepare", {
          scope: "both",
          access: "read",
          ttlSeconds: 3600,
        })
      ).status,
    ).toBe(409);
    await f.app.close();
    expect(await f.app.result).toMatchObject({
      status: "recovery-required",
      ...current.draft,
    });
  });
});
