import { describe, expect, test } from "bun:test";
import { createGatewayMcpServer } from "../../../src/mcp/create-server.ts";
import { DEFAULT_GATEWAY_CONFIG, TwsGatewayClient } from "../../../src/tws/index.ts";

describe("create-server", () => {
  test("creates the gateway server bundle with the default ready message", () => {
    const { server, gateway, readyMessage } = createGatewayMcpServer();

    expect(server).toBeDefined();
    expect(gateway).toBeInstanceOf(TwsGatewayClient);
    expect(readyMessage).toContain(DEFAULT_GATEWAY_CONFIG.host);
    expect(readyMessage).toContain(String(DEFAULT_GATEWAY_CONFIG.port));
    expect(readyMessage).toContain(String(DEFAULT_GATEWAY_CONFIG.clientId));
  });
});
