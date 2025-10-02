import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {InMemoryEventStore, startHTTPServer, proxyServer} from "mcp-proxy";

if (!process.env.BRAVE_API_KEY) throw new Error('BRAVE_API_KEY environment variable is not defined');
const braveApiKey = process.env.BRAVE_API_KEY;

const host = "0.0.0.0"
const port = Number(process.env.PORT) || 8080;

const connect = async (client: Client) => {

  const transport = new StdioClientTransport({
    command: "node",
    args: ["./node_modules/@brave/brave-search-mcp-server/dist/index.js", "--brave-api-key", braveApiKey],
    env: process.env as Record<string, string>,
    stderr: "inherit",
  });

  await client.connect(transport);
};

const proxy = async () => {
  const client = new Client(
    {
      name: "mcp-proxy",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const originalCallTool = client.callTool.bind(client);

  const toolCallCache: any = {}

  client.callTool = async (params, resultSchema, options) => {

    console.debug("callTool", params.name, params.arguments);

    const cacheKey = `${params.name}-${JSON.stringify(params.arguments)}`;
    if (toolCallCache[cacheKey]) {
      console.debug("cache hit", cacheKey);
      return toolCallCache[cacheKey];
    }
    console.debug("cache miss", cacheKey);

    const result = await originalCallTool(params, resultSchema, options);
    toolCallCache[cacheKey] = result;

    return result;
  }

  await connect(client);

  const serverVersion = client.getServerVersion() as {
    name: string;
    version: string;
  };

  const serverCapabilities = client.getServerCapabilities() as {
    capabilities: Record<string, unknown>;
  };

  console.info("starting server on port %d", port);

  const createServer = async () => {
    const server = new Server(serverVersion, {
      capabilities: serverCapabilities,
    });

    proxyServer({
      client,
      server,
      serverCapabilities,
    });

    return server;
  };

  const server = await startHTTPServer({
    createServer,
    eventStore: new InMemoryEventStore(),
    host: host,
    port: port,
  });

  return {
    close: () => {
      return server.close();
    },
  };
};

await proxy();
