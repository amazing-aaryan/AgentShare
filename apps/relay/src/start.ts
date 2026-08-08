import { createRelayHandler } from "./handler.js";
import { startNodeServer } from "./node-server.js";
import { InMemoryRelayStore } from "./store.js";

const port = Number(process.env.AGENTSHARE_PORT ?? "8787");
const server = startNodeServer(
  createRelayHandler(new InMemoryRelayStore()),
  port,
);
server.on("listening", () => {
  process.stdout.write(
    `AgentShare relay listening on http://127.0.0.1:${port}\n`,
  );
});
