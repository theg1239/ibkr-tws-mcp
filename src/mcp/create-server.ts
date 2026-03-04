import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_GATEWAY_CONFIG, TwsGatewayClient } from "../tws/index.ts";
import { registerGatewayTools } from "./register-tools.ts";

export function createGatewayMcpServer() {
  const gateway = new TwsGatewayClient();
  const server = new McpServer({
    name: "ibkr-gateway-mcp",
    version: "0.3.0",
  });

  registerGatewayTools(server, gateway);

  return {
    server,
    gateway,
    readyMessage: `ibkr-gateway-mcp ready. Default target: ${DEFAULT_GATEWAY_CONFIG.host}:${DEFAULT_GATEWAY_CONFIG.port} (clientId ${DEFAULT_GATEWAY_CONFIG.clientId}).`,
  };
}
