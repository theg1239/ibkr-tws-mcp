import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGatewayMcpServer } from "./src/mcp/create-server.ts";

const { server, readyMessage } = createGatewayMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error(readyMessage);
