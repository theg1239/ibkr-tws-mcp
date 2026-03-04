import { describe, expect, test } from "bun:test";
import {
  buildApprovalMessage,
  createApprovalDeclinedResult,
  createApprovalUnavailableResult,
  requestToolApproval,
} from "../../../src/mcp/confirmations.ts";

describe("confirmations", () => {
  test("buildApprovalMessage includes the tool name, description, and arguments", () => {
    expect(
      buildApprovalMessage({
        toolName: "get_positions",
        description: "Request the current portfolio positions snapshot.",
        args: {
          timeoutMs: 5000,
        },
      }),
    ).toBe(
      'Approve tool "get_positions"?\n\nRequest the current portfolio positions snapshot.\n\nArguments:\n\n{\n  "timeoutMs": 5000\n}',
    );
  });

  test("requestToolApproval returns approved only for explicit approval", async () => {
    const calls: string[] = [];
    const server = {
      server: {
        getClientCapabilities() {
          return {
            elicitation: {},
          };
        },
        async elicitInput(input: { message: string }) {
          calls.push(input.message);
          return {
            action: "accept",
            content: {
              approved: true,
            },
          };
        },
      },
    };

    const decision = await requestToolApproval(server as never, {
      toolName: "connect_gateway",
      description: "Connect to IB Gateway.",
      args: {
        host: "127.0.0.1",
        port: 4002,
      },
    });

    expect(decision).toEqual({
      status: "approved",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Approve tool "connect_gateway"?');
  });

  test("requestToolApproval returns declined for declined or unapproved responses", async () => {
    const declinedServer = {
      server: {
        async elicitInput() {
          return {
            action: "decline",
          };
        },
      },
    };

    const explicitNoServer = {
      server: {
        async elicitInput() {
          return {
            action: "accept",
            content: {
              approved: false,
            },
          };
        },
      },
    };

    expect(
      await requestToolApproval(declinedServer as never, {
        toolName: "connection_status",
        description: "Inspect the gateway connection.",
        args: undefined,
      }),
    ).toEqual({
      status: "declined",
    });
    expect(
      await requestToolApproval(explicitNoServer as never, {
        toolName: "connection_status",
        description: "Inspect the gateway connection.",
        args: undefined,
      }),
    ).toEqual({
      status: "declined",
    });
  });

  test("requestToolApproval returns an unavailable decision when the client lacks form elicitation", async () => {
    const server = {
      server: {
        getClientCapabilities() {
          return {
            elicitation: {
              url: {},
            },
          };
        },
        async elicitInput() {
          throw new Error("This should not be called.");
        },
      },
    };

    const decision = await requestToolApproval(server as never, {
      toolName: "set_market_data_type",
      description: "Change the market data mode.",
      args: {
        marketDataType: 3,
      },
    });

    expect(decision).toEqual({
      status: "unavailable",
      reason:
        "This MCP client does not support form elicitation, so this server cannot safely request per-call approval.",
      supportedModes: {
        form: false,
        url: true,
      },
      unsafeAutoApproveEnabled: false,
    });
  });

  test("requestToolApproval maps unsupported-form errors to unavailable even with varied wording", async () => {
    const server = {
      server: {
        getClientCapabilities() {
          return {
            elicitation: {
              form: {},
            },
          };
        },
        async elicitInput() {
          throw new Error("Unsupported elicitation mode: form");
        },
      },
    };

    const decision = await requestToolApproval(server as never, {
      toolName: "set_market_data_type",
      description: "Change the market data mode.",
      args: {
        marketDataType: 3,
      },
    });

    expect(decision).toEqual({
      status: "unavailable",
      reason:
        "This MCP client rejected form elicitation support, so this server cannot safely request per-call approval.",
      supportedModes: {
        form: true,
        url: false,
      },
      unsafeAutoApproveEnabled: false,
    });
  });

  test("createApprovalUnavailableResult returns a stable payload", () => {
    expect(
      createApprovalUnavailableResult("connect_gateway", {
        status: "unavailable",
        reason: "Missing form support.",
        supportedModes: {
          form: false,
          url: false,
        },
        unsafeAutoApproveEnabled: false,
      }),
    ).toEqual({
      status: "approval_unavailable",
      toolName: "connect_gateway",
      message: "Missing form support.",
      clientElicitation: {
        form: false,
        url: false,
      },
      fallback: {
        unsafeAutoApproveEnvVar: "IBKR_MCP_ALLOW_UNSUPPORTED_ELICITATION",
        unsafeAutoApproveEnabled: false,
        guidance: [
          "Use an MCP client that supports form elicitation for per-call approval.",
          "Or, for a fully trusted local setup only, set IBKR_MCP_ALLOW_UNSUPPORTED_ELICITATION=1 to auto-approve when elicitation is unavailable.",
        ],
      },
    });
  });

  test("createApprovalDeclinedResult returns a stable cancellation payload", () => {
    expect(createApprovalDeclinedResult("disconnect_gateway")).toEqual({
      status: "cancelled",
      toolName: "disconnect_gateway",
      message: "Tool execution was not approved by the user.",
    });
  });
});
