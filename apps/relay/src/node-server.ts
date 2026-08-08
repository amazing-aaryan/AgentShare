import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

export function startNodeServer(
  handler: (request: Request) => Promise<Response>,
  port: number,
  hostname = "127.0.0.1",
) {
  const server = createServer((request, response) => {
    void handleRequest(request, response, handler, hostname, port);
  });
  server.listen(port, hostname);
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: (request: Request) => Promise<Response>,
  hostname: string,
  port: number,
): Promise<void> {
  try {
    const webRequest = toWebRequest(request, hostname, port);
    const webResponse = await handler(webRequest);
    await sendWebResponse(webResponse, response);
  } catch {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: { code: "INTERNAL", message: "Internal relay error" },
      }),
    );
  }
}

function toWebRequest(
  request: IncomingMessage,
  hostname: string,
  port: number,
): Request {
  const method = request.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);
  return new Request(`http://${hostname}:${port}${request.url ?? "/"}`, {
    method,
    headers: request.headers as HeadersInit,
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit & { duplex?: "half" });
}

async function sendWebResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  target.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  const body = Buffer.from(await response.arrayBuffer());
  target.end(body);
}
