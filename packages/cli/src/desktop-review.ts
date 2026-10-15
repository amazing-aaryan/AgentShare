import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createCreatorRuntime } from "./creator-mcp.js";
import {
  commitShareDraft,
  shareDraftStatus,
  type DraftOptions,
  type DraftReview,
} from "./environment/drafts.js";
import type { exportCurrentCodexCapture } from "@agentshare/adapter-codex";
import { desktopReviewPage } from "./desktop-review-page.js";
import { sanitizeTerminalText } from "./terminal.js";

type Published = Awaited<ReturnType<typeof commitShareDraft>>;
type DesktopResult =
  | Published
  | { status: "recovery-required"; draftId: string; digest: string }
  | undefined;
type Selection = {
  scope: "conversation" | "workspace" | "both";
  access: "read" | "read_propose";
  ttlSeconds: number;
};
type Options = DraftOptions & {
  threadId: string;
  capture?: typeof exportCurrentCodexCapture;
  relayOrigin?: string;
  handoffOrigin?: string;
  lifetimeMs?: number;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const secret = () => randomBytes(32).toString("base64url");
function equal(a: unknown, b: string): boolean {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
function keys(body: Record<string, unknown>, expected: string[]) {
  if (Object.keys(body).sort().join(",") !== expected.sort().join(","))
    throw new HttpError(400, "Unexpected or missing review fields");
}
async function jsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const raw of req) {
    const chunk = Buffer.from(raw as Uint8Array);
    length += chunk.length;
    if (length > 16_384)
      throw new HttpError(413, "Review request is too large");
    chunks.push(chunk);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Expected review fields");
  return body as Record<string, unknown>;
}

/** Separate local browser transport. Its capability is not proof of human identity. */
export async function startDesktopShare(options: Options) {
  if (!/^[A-Za-z0-9-]+$/u.test(options.threadId))
    throw new Error("An exact Codex session ID is required");
  const runtime = createCreatorRuntime({
    ...options,
    confirm: () => Promise.resolve(false),
  });
  const session = (await runtime("resolve_creator_session", {
    threadId: options.threadId,
  })) as { sessionRef: string; recordedRoot: string; rootStatus: string };
  const now = () => (options.now ?? (() => new Date()))().getTime();
  const lifetimeMs = options.lifetimeMs ?? 15 * 60_000;
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 1000 ||
    lifetimeMs > 30 * 60_000
  )
    throw new Error("Invalid review lifetime");
  const expiresAt = now() + lifetimeMs;
  const launchToken = secret(),
    cookieToken = secret(),
    csrf = secret();
  const cookieName = `agentshare_review_${randomBytes(8).toString("hex")}`;
  let launchUsed = false,
    busy = false,
    stopped = false,
    publicationAttempted = false;
  let draft: DraftReview | undefined,
    nonce = "",
    published: Published | undefined;
  let origin = "";
  let expired = false;
  let successTimer: ReturnType<typeof setTimeout> | undefined;
  let settle!: (value: DesktopResult) => void;
  const result = new Promise<DesktopResult>((resolve) => {
    settle = resolve;
  });
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  const state = async () => ({
    threadId: options.threadId,
    recordedRoot: session.recordedRoot,
    rootStatus: session.rootStatus,
    expiresAt: new Date(expiresAt).toISOString(),
    csrf,
    draft,
    nonce,
    publicationAttempted,
    ...(draft === undefined
      ? {}
      : { publication: await shareDraftStatus(draft.draftId, options) }),
    ...(published === undefined ? {} : { published }),
  });
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    const handle = async () => {
      if (req.headers.host !== new URL(origin).host)
        throw new HttpError(403, "Untrusted review host");
      const url = new URL(req.url ?? "/", origin);
      if (url.origin !== origin)
        throw new HttpError(403, "Untrusted review URL");
      if (stopped || (now() >= expiresAt && published === undefined))
        throw new HttpError(
          410,
          "Local review expired; nothing new was approved",
        );
      if (req.method === "GET" && url.pathname === "/") {
        const scriptNonce = randomBytes(16).toString("base64");
        res.setHeader(
          "content-security-policy",
          `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${scriptNonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(desktopReviewPage(scriptNonce));
        return;
      }
      if (req.headers.origin !== undefined && req.headers.origin !== origin)
        throw new HttpError(403, "Untrusted review origin");
      if (
        req.headers["sec-fetch-site"] !== undefined &&
        req.headers["sec-fetch-site"] !== "same-origin"
      )
        throw new HttpError(403, "Cross-site review request rejected");
      if (
        req.method === "POST" &&
        (req.headers.origin !== origin ||
          req.headers["content-type"] !== "application/json")
      )
        throw new HttpError(403, "Same-origin JSON required");
      if (req.method === "POST" && url.pathname === "/api/session") {
        const body = await jsonBody(req);
        keys(body, ["token"]);
        if (launchUsed || !equal(body.token, launchToken))
          throw new HttpError(401, "Invalid or consumed local review link");
        launchUsed = true;
        res.setHeader(
          "set-cookie",
          `${cookieName}=${cookieToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil((lifetimeMs + 60_000) / 1000)}`,
        );
        send(res, 200, await state());
        return;
      }
      const cookie = req.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      if (!launchUsed || !equal(cookie, cookieToken))
        throw new HttpError(
          401,
          "Open the original private review link in this browser",
        );
      if (req.method === "GET" && url.pathname === "/api/session") {
        send(res, 200, await state());
        return;
      }
      if (!equal(req.headers["x-agentshare-csrf"], csrf))
        throw new HttpError(403, "Invalid review CSRF token");
      if (req.method === "GET" && url.pathname === "/api/status") {
        send(res, 200, await state());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/review") {
        if (draft === undefined || busy)
          throw new HttpError(409, "Prepare a draft first, then review it");
        const section = url.searchParams.get("section") ?? "summary";
        const cursor = Number(url.searchParams.get("cursor") ?? "0");
        send(
          res,
          200,
          await runtime("review_share", {
            draftId: draft.draftId,
            digest: draft.digest,
            section,
            cursor,
          }),
        );
        return;
      }
      if (req.method !== "POST")
        throw new HttpError(405, "Unsupported local review method");
      const body = await jsonBody(req);
      if (busy)
        throw new HttpError(409, "A review action is already in progress");
      if (url.pathname === "/api/cancel") {
        keys(body, []);
        if (publicationAttempted)
          throw new HttpError(
            409,
            "Publication was already attempted; retain this exact draft for recovery",
          );
        stopped = true;
        send(res, 200, { status: "cancelled", publicationAttempted: false });
        settle(undefined);
        void close();
        return;
      }
      if (url.pathname === "/api/prepare") {
        keys(body, ["scope", "access", "ttlSeconds"]);
        if (publicationAttempted)
          throw new HttpError(
            409,
            "Retain the existing draft; publication was already attempted",
          );
        if (
          !["conversation", "workspace", "both"].includes(String(body.scope)) ||
          !["read", "read_propose"].includes(String(body.access)) ||
          ![3600, 86400, 259200].includes(Number(body.ttlSeconds)) ||
          typeof body.ttlSeconds !== "number"
        )
          throw new HttpError(400, "Select context, access and duration");
        busy = true;
        try {
          // Invalidate previous consent before an asynchronous re-prepare.
          draft = undefined;
          nonce = "";
          draft = (await runtime("prepare_share", {
            sessionRef: session.sessionRef,
            ...(body as Selection),
          })) as DraftReview;
          if (expired || now() >= expiresAt)
            throw new HttpError(
              410,
              "Local review expired during preparation; no publication attempted",
            );
          nonce = secret();
          send(res, 200, await state());
        } finally {
          busy = false;
          if (expired) void close();
        }
        return;
      }
      if (url.pathname === "/api/publish") {
        keys(body, ["draftId", "digest", "nonce"]);
        if (
          draft === undefined ||
          body.draftId !== draft.draftId ||
          body.digest !== draft.digest
        )
          throw new HttpError(409, "Draft changed; review the current draft");
        if (!equal(body.nonce, nonce))
          throw new HttpError(403, "Invalid browser review confirmation");
        if (published !== undefined) {
          send(res, 200, published);
          return;
        }
        busy = true;
        publicationAttempted = true;
        const approved = { draftId: draft.draftId, digest: draft.digest };
        try {
          // Only this authenticated, exact-draft browser POST supplies consent.
          published = await commitShareDraft(
            approved.draftId,
            approved.digest,
            {
              ...options,
              confirm: (review) =>
                Promise.resolve(
                  review.draftId === approved.draftId &&
                    review.digest === approved.digest &&
                    now() < expiresAt &&
                    !stopped,
                ),
            },
          );
          send(res, 200, published);
          settle(published);
          // Keep readback available if the browser loses the success response.
          successTimer = setTimeout(() => {
            void close();
          }, 60_000);
          successTimer.unref();
        } finally {
          busy = false;
          if (expired && published === undefined) void close();
        }
        return;
      }
      throw new HttpError(404, "Unknown local review action");
    };
    void handle().catch((error: unknown) => {
      if (!res.headersSent)
        send(res, error instanceof HttpError ? error.status : 400, {
          error: sanitizeTerminalText(
            error instanceof Error ? error.message : "Local review failed",
          ).slice(0, 2000),
          publicationAttempted,
        });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Local review could not bind loopback");
  origin = `http://127.0.0.1:${address.port}`;
  const closed = new Promise<void>((resolve) => server.once("close", resolve));
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing !== undefined) return closing;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(successTimer);
    settle(
      published ??
        (publicationAttempted && draft !== undefined
          ? {
              status: "recovery-required",
              draftId: draft.draftId,
              digest: draft.digest,
            }
          : undefined),
    );
    closing = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
    return closing;
  };
  const timer = setTimeout(() => {
    expired = true;
    if (!busy && published === undefined) void close();
  }, lifetimeMs);
  timer.unref();
  return {
    reviewUrl: `${origin}/#${launchToken}`,
    expiresAt: new Date(expiresAt).toISOString(),
    result,
    closed,
    close,
  };
}
