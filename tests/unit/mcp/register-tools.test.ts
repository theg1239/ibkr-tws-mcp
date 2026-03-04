import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";
import { registerGatewayTools } from "../../../src/mcp/register-tools.ts";

describe("register-tools", () => {
  test("registers the full tool surface with annotations", () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    expect(server.tools.map((tool) => tool.name)).toEqual([
      "connect_gateway",
      "disconnect_gateway",
      "connection_status",
      "list_managed_accounts",
      "get_current_time",
      "get_next_valid_order_id",
      "get_market_data_type",
      "search_stocks",
      "set_market_data_type",
      "get_account_summary",
      "get_positions",
      "get_stock_historical_bars",
      "get_gateway_snapshot",
      "get_stock_portfolio_overview",
      "scan_stock_market",
      "get_stock_trade_candidates",
      "get_stock_market_scenario",
      "get_market_data_snapshot",
      "preview_stock_order",
      "submit_stock_order",
      "cancel_stock_order",
    ]);

    expect(findTool(server.tools, "get_current_time").config.annotations.readOnlyHint).toBe(true);
    expect(findTool(server.tools, "set_market_data_type").config.annotations.readOnlyHint).toBe(
      false,
    );
    expect(findTool(server.tools, "preview_stock_order").config.annotations.destructiveHint).toBe(
      false,
    );
  });

  test("set_market_data_type accepts numeric strings in the tool schema", () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const tool = findTool(server.tools, "set_market_data_type");
    const inputSchema = tool.config.inputSchema;

    if (!inputSchema) {
      throw new Error("Expected set_market_data_type to define an input schema.");
    }

    const parsed = parseToolInput(inputSchema, {
      marketDataType: "3",
    }) as { marketDataType: number };

    expect(parsed.marketDataType).toBe(3);
  });

  test("stock order tool schema enforces valid MKT/LMT argument combinations", () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const previewSchema = findTool(server.tools, "preview_stock_order").config.inputSchema;
    if (!previewSchema) {
      throw new Error("Expected preview_stock_order to define an input schema.");
    }

    expect(() =>
      parseToolInput(previewSchema, {
        symbol: "AAPL",
        action: "BUY",
        quantity: 1,
        orderType: "LMT",
      }),
    ).toThrow("limitPrice is required when orderType is LMT.");

    expect(() =>
      parseToolInput(previewSchema, {
        symbol: "AAPL",
        action: "BUY",
        quantity: 1,
        orderType: "MKT",
        limitPrice: 100,
      }),
    ).toThrow("limitPrice is only allowed when orderType is LMT.");
  });

  test("get_stock_historical_bars schema enforces symbol/symbols exclusivity", () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const schema = findTool(server.tools, "get_stock_historical_bars").config.inputSchema;
    if (!schema) {
      throw new Error("Expected get_stock_historical_bars to define an input schema.");
    }

    expect(() =>
      parseToolInput(schema, {
        symbol: "AAPL",
        symbols: ["MSFT"],
      }),
    ).toThrow(/Provide either .*symbol.*or.*symbols.*not both\./);
  });

  test("get_market_data_snapshot schema enforces symbol/symbols exclusivity", () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const schema = findTool(server.tools, "get_market_data_snapshot").config.inputSchema;
    if (!schema) {
      throw new Error("Expected get_market_data_snapshot to define an input schema.");
    }

    expect(() =>
      parseToolInput(schema, {
        symbol: "AAPL",
        symbols: ["MSFT"],
      }),
    ).toThrow(/Provide either .*symbol.*or.*symbols.*not both\./);
  });

  test("approved tool calls elicit input first and then execute the gateway method", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "get_current_time").handler(undefined);

    expect(server.elicitationCalls).toHaveLength(1);
    expect(server.elicitationCalls[0]).toContain('Approve tool "get_current_time"?');
    expect(gateway.calls).toEqual(["requestCurrentTime"]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"epochSeconds": 1');
  });

  test("declined tool calls do not execute the gateway method", async () => {
    const server = createServer({
      action: "decline",
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "connection_status").handler(undefined);

    expect(gateway.calls).toEqual([]);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text || "{}")).toEqual({
      status: "cancelled",
      toolName: "connection_status",
      message: "Tool execution was not approved by the user.",
    });
  });

  test("unsupported approval clients return a structured approval-unavailable result", async () => {
    const server = createServer(
      {
        action: "accept",
        content: {
          approved: true,
        },
      },
      {
        elicitation: {
          url: {},
        },
      },
    );
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "connect_gateway").handler({
      host: "127.0.0.1",
      port: 4002,
    });

    expect(gateway.calls).toEqual([]);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text || "{}")).toEqual({
      status: "approval_unavailable",
      toolName: "connect_gateway",
      message:
        "This MCP client does not support form elicitation, so this server cannot safely request per-call approval.",
      clientElicitation: {
        form: false,
        url: true,
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

  test("submit_stock_order can preview and submit in one approved call", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "submit_stock_order").handler({
      symbol: "AAPL",
      action: "BUY",
      quantity: 1,
      previewBeforeSubmit: true,
    });

    expect(gateway.calls).toEqual(["previewStockOrderWhatIf", "placeStockOrder"]);
    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.preview?.orderId).toBe(1);
    expect(parsed.submission?.orderId).toBe(2);
  });

  test("submit_stock_order routes to modifyStockOrder when orderId is provided", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "submit_stock_order").handler({
      orderId: 44,
      symbol: "AAPL",
      action: "SELL",
      quantity: 2,
      previewBeforeSubmit: false,
    });

    expect(gateway.calls).toEqual(["modifyStockOrder"]);
    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.mode).toBe("modify");
    expect(parsed.preview).toBeNull();
    expect(parsed.submission?.orderId).toBe(44);
  });

  test("get_stock_portfolio_overview returns a richer holdings view in one approved call", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "get_stock_portfolio_overview").handler({
      includeOpenOrders: true,
      marketDataType: 3,
      rankLimit: 3,
    });

    expect(gateway.calls).toEqual([
      "requestAccountSummary",
      "requestPositions",
      "requestOpenStockOrders",
      "requestHeldStockSnapshots",
    ]);

    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.summary.stockPositionCount).toBe(1);
    expect(parsed.summary.totalOpenStockOrders).toBe(1);
    expect(parsed.holdings[0]?.symbol).toBe("AAPL");
    expect(parsed.holdings[0]?.delayed).toBe(true);
    expect(parsed.rankings.largestByWeight).toHaveLength(1);
  });

  test("scan_stock_market returns enriched scanner results in one approved call", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "scan_stock_market").handler({
      scanCode: "TOP_PERC_GAIN",
      includeSnapshots: true,
      numberOfRows: 3,
    });

    expect(gateway.calls).toEqual(["requestStockScanner", "requestMarketDataSnapshot"]);
    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.results[0]?.symbol).toBe("AAPL");
    expect(parsed.results[0]?.currentPrice).toBe(200);
  });

  test("get_market_data_snapshot batches symbols in one approved call", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "get_market_data_snapshot").handler({
      symbols: ["AAPL", "MSFT"],
      marketDataType: 3,
      batchConcurrency: 2,
    });

    expect(gateway.calls).toEqual(["requestStockMarketSnapshots"]);
    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.totals.requested).toBe(2);
    expect(parsed.items[0]?.symbol).toBe("AAPL");
  });

  test("get_stock_trade_candidates returns a consolidated shortlist in one approved call", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "get_stock_trade_candidates").handler({
      scannerPreset: "liquid_leaders",
      includeLivePnl: false,
      includeIntradayBars: false,
      rankLimit: 3,
    });

    expect(gateway.calls).toContain("requestAccountPnLSnapshot");
    expect(gateway.calls.filter((call) => call === "requestStockScanner")).toHaveLength(4);

    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(parsed.accountLivePnl?.dailyPnL).toBe(1250);
    expect(Array.isArray(parsed.candidates)).toBe(true);
    expect(parsed.candidates.some((candidate: { symbol?: string }) => candidate.symbol === "AAPL")).toBe(
      true,
    );
  });

  test("get_stock_market_scenario combines scanners and benchmarks", async () => {
    const server = createServer({
      action: "accept",
      content: {
        approved: true,
      },
    });
    const gateway = createGateway();

    registerGatewayTools(server.instance as never, gateway.instance as never);

    const result = await findTool(server.tools, "get_stock_market_scenario").handler({
      rowsPerScan: 2,
      marketDataType: 3,
      benchmarkSymbols: ["SPY", "QQQ"],
    });

    expect(gateway.calls.filter((call) => call === "requestStockScanner")).toHaveLength(3);
    expect(gateway.calls.filter((call) => call === "requestMarketDataSnapshot")).toHaveLength(5);

    const parsed = JSON.parse(result.content[0]?.text || "{}");
    expect(Array.isArray(parsed.benchmarks)).toBe(true);
    expect(Array.isArray(parsed.movers.topGainers)).toBe(true);
    expect(parsed.summary.topGainerSymbol).toBe("AAPL");
  });
});

type RegisteredTool = {
  name: string;
  config: {
    inputSchema?: z.ZodType | z.ZodRawShape;
    annotations: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
  };
  handler: (args: unknown) => Promise<{
    content: Array<{
      type: "text";
      text: string;
    }>;
    isError?: boolean;
  }>;
};

function parseToolInput(schema: z.ZodType | z.ZodRawShape, input: unknown) {
  if (typeof (schema as { safeParse?: unknown }).safeParse === "function") {
    return z.parse(schema as z.ZodType, input);
  }

  return z.object(schema).parse(input);
}

function createServer(
  elicitationResult: { action: string; content?: { approved?: boolean } },
  clientCapabilities?: {
    elicitation?: {
      form?: Record<string, unknown>;
      url?: Record<string, unknown>;
    };
  },
) {
  const tools: RegisteredTool[] = [];
  const elicitationCalls: string[] = [];
  const resolvedCapabilities = clientCapabilities ?? {
    elicitation: {},
  };

  return {
    tools,
    elicitationCalls,
    instance: {
      registerTool(name: string, config: RegisteredTool["config"], handler: RegisteredTool["handler"]) {
        tools.push({
          name,
          config,
          handler,
        });

        return {};
      },
      server: {
        getClientCapabilities() {
          return resolvedCapabilities;
        },
        async elicitInput(input: { message: string }) {
          elicitationCalls.push(input.message);
          return elicitationResult;
        },
      },
    },
  };
}

function createGateway() {
  const calls: string[] = [];

  return {
    calls,
    instance: {
      async connect() {
        calls.push("connect");
        return {
          connected: true,
        };
      },
      disconnect() {
        calls.push("disconnect");
        return {
          connected: false,
        };
      },
      getStatus() {
        calls.push("getStatus");
        return {
          connected: true,
        };
      },
      async requestManagedAccounts() {
        calls.push("requestManagedAccounts");
        return {
          accounts: ["DU123"],
          raw: "DU123",
        };
      },
      async requestCurrentTime() {
        calls.push("requestCurrentTime");
        return {
          epochSeconds: 1,
          isoTime: "1970-01-01T00:00:01.000Z",
        };
      },
      async requestNextValidOrderId() {
        calls.push("requestNextValidOrderId");
        return {
          orderId: 1,
        };
      },
      getMarketDataType() {
        calls.push("getMarketDataType");
        return {
          marketDataType: null,
          label: "unset",
        };
      },
      async searchStockSymbols() {
        calls.push("searchStockSymbols");
        return {
          reqId: 1,
          pattern: "AAPL",
          matches: [],
        };
      },
      setMarketDataType(marketDataType: number) {
        calls.push("setMarketDataType");
        return {
          marketDataType,
          label: "delayed",
        };
      },
      async requestAccountSummary() {
        calls.push("requestAccountSummary");
        return {
          reqId: 1,
          group: "All",
          tags:
            "NetLiquidation,TotalCashValue,BuyingPower,AvailableFunds,ExcessLiquidity,InitMarginReq,MaintMarginReq,GrossPositionValue",
          rows: [
            {
              account: "DU123",
              tag: "NetLiquidation",
              value: "1000000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "TotalCashValue",
              value: "-50000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "BuyingPower",
              value: "3000000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "AvailableFunds",
              value: "800000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "ExcessLiquidity",
              value: "850000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "InitMarginReq",
              value: "150000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "MaintMarginReq",
              value: "125000",
              currency: "USD",
            },
            {
              account: "DU123",
              tag: "GrossPositionValue",
              value: "600000",
              currency: "USD",
            },
          ],
          byAccount: {
            DU123: {
              NetLiquidation: {
                value: "1000000",
                currency: "USD",
              },
            },
          },
        };
      },
      async requestPositions() {
        calls.push("requestPositions");
        return {
          rows: [
            {
              account: "DU123",
              contract: {
                conid: 1,
                symbol: "AAPL",
                secType: "STK",
                lastTradeDateOrContractMonth: "",
                strike: null,
                right: "",
                multiplier: "",
                exchange: "SMART",
                currency: "USD",
                localSymbol: "AAPL",
                tradingClass: "NMS",
              },
              position: "10",
              averageCost: 150,
            },
          ],
        };
      },
      async requestHeldStockPnLSnapshots() {
        calls.push("requestHeldStockPnLSnapshots");
        return {
          items: [
            {
              position: {
                account: "DU123",
                contract: {
                  conid: 1,
                  symbol: "AAPL",
                  secType: "STK",
                  lastTradeDateOrContractMonth: "",
                  strike: null,
                  right: "",
                  multiplier: "",
                  exchange: "SMART",
                  currency: "USD",
                  localSymbol: "AAPL",
                  tradingClass: "NMS",
                },
                position: "10",
                averageCost: 150,
              },
              pnl: {
                reqId: 1,
                account: "DU123",
                modelCode: "",
                conid: 1,
                position: "10",
                dailyPnL: 50,
                unrealizedPnL: 500,
                realizedPnL: 0,
                value: 2000,
                receivedAt: "2026-03-04T00:00:00.000Z",
              },
              error: null,
            },
          ],
          totals: {
            requested: 1,
            completed: 1,
            failed: 0,
          },
        };
      },
      async requestAccountPnLSnapshot() {
        calls.push("requestAccountPnLSnapshot");
        return {
          reqId: 2,
          account: "DU123",
          modelCode: "",
          dailyPnL: 1250,
          unrealizedPnL: 5000,
          realizedPnL: 250,
          receivedAt: "2026-03-04T00:00:00.000Z",
        };
      },
      async requestOpenStockOrders() {
        calls.push("requestOpenStockOrders");
        return {
          orders: [
            {
              orderId: 5,
              contract: {
                conid: 1,
                symbol: "AAPL",
                secType: "STK",
                exchange: "SMART",
                primaryExchange: "NASDAQ",
                currency: "USD",
                localSymbol: "AAPL",
                tradingClass: "NMS",
              },
              order: {
                action: "SELL",
                quantity: "2",
                orderType: "LMT",
                limitPrice: 210,
                tif: "DAY",
                account: "DU123",
                outsideRth: false,
              },
              orderState: {
                status: "Submitted",
                initMarginBefore: null,
                maintMarginBefore: null,
                equityWithLoanBefore: null,
                initMarginChange: null,
                maintMarginChange: null,
                equityWithLoanChange: null,
                initMarginAfter: null,
                maintMarginAfter: null,
                equityWithLoanAfter: null,
                commissionAndFees: null,
                minCommissionAndFees: null,
                maxCommissionAndFees: null,
                commissionAndFeesCurrency: null,
                marginCurrency: null,
                initMarginBeforeOutsideRth: null,
                maintMarginBeforeOutsideRth: null,
                equityWithLoanBeforeOutsideRth: null,
                initMarginChangeOutsideRth: null,
                maintMarginChangeOutsideRth: null,
                equityWithLoanChangeOutsideRth: null,
                initMarginAfterOutsideRth: null,
                maintMarginAfterOutsideRth: null,
                equityWithLoanAfterOutsideRth: null,
                suggestedSize: null,
                rejectReason: null,
                warningText: null,
              },
            },
          ],
        };
      },
      async requestHeldStockSnapshots() {
        calls.push("requestHeldStockSnapshots");
        return {
          items: [
            {
              position: {
                account: "DU123",
                contract: {
                  conid: 1,
                  symbol: "AAPL",
                  secType: "STK",
                  lastTradeDateOrContractMonth: "",
                  strike: null,
                  right: "",
                  multiplier: "",
                  exchange: "SMART",
                  currency: "USD",
                  localSymbol: "AAPL",
                  tradingClass: "NMS",
                },
                position: "10",
                averageCost: 150,
              },
              snapshot: {
                reqId: 1,
                contract: {
                  symbol: "AAPL",
                  secType: "STK",
                  exchange: "SMART",
                  primaryExchange: "NASDAQ",
                  currency: "USD",
                },
                fields: {
                  delayedLast: 200,
                  tick_66: 199.9,
                  tick_67: 200.1,
                  marketDataType: 3,
                },
                rawTicks: {},
                warnings: [],
                completed: true,
                timedOut: false,
              },
              error: null,
            },
          ],
          totals: {
            requested: 1,
            completed: 1,
            failed: 0,
          },
        };
      },
      async requestStockHistoricalBars() {
        calls.push("requestStockHistoricalBars");
        return {
          reqId: 1,
          contract: {
            symbol: "AAPL",
            exchange: "SMART",
            primaryExchange: "NASDAQ",
            currency: "USD",
          },
          endDateTime: "",
          durationStr: "2 D",
          barSizeSetting: "1 hour",
          whatToShow: "TRADES",
          useRTH: true,
          bars: [],
          startDateTime: null,
          endDateTimeReturned: null,
        };
      },
      async requestGatewaySnapshot() {
        calls.push("requestGatewaySnapshot");
        return {
          status: {
            connected: true,
          },
        };
      },
      async requestStockScanner(input: { scanCode?: string }) {
        calls.push("requestStockScanner");
        return {
          reqId: 1,
          scanCode: input.scanCode || "TOP_PERC_GAIN",
          instrument: "STK",
          locationCode: "STK.US.MAJOR",
          rows: [
            {
              rank: 0,
              conid: 1,
              symbol:
                input.scanCode === "TOP_PERC_LOSE"
                  ? "MSFT"
                  : input.scanCode === "MOST_ACTIVE"
                    ? "NVDA"
                    : "AAPL",
              secType: "STK",
              lastTradeDateOrContractMonth: "",
              strike: null,
              right: "",
              exchange: "SMART",
              currency: "USD",
              localSymbol: "AAPL",
              marketName: "NASDAQ.NMS",
              tradingClass: "NMS",
              distance:
                input.scanCode === "TOP_PERC_LOSE"
                  ? "-4.2%"
                  : input.scanCode === "MOST_ACTIVE"
                    ? "0"
                    : "5.5%",
              benchmark: "",
              projection: "",
              legsStr: "",
            },
          ],
        };
      },
      async requestMarketDataSnapshot() {
        calls.push("requestMarketDataSnapshot");
        return {
          reqId: 1,
          contract: {
            symbol: "AAPL",
            secType: "STK",
            exchange: "SMART",
            primaryExchange: "",
            currency: "USD",
          },
          fields: {
            delayedLast: 200,
            tick_66: 199.9,
            tick_67: 200.1,
            tick_75: 190,
            tick_74: 1000000,
            marketDataType: 3,
          },
          rawTicks: {},
          warnings: [],
          completed: true,
          timedOut: false,
        };
      },
      async requestStockMarketSnapshots(input: { symbols: string[] }) {
        calls.push("requestStockMarketSnapshots");
        return {
          items: input.symbols.map((symbol) => ({
            symbol,
            snapshot: {
              reqId: 1,
              contract: {
                symbol,
                secType: "STK",
                exchange: "SMART",
                primaryExchange: "",
                currency: "USD",
              },
              fields: {
                delayedLast: 200,
                tick_66: 199.9,
                tick_67: 200.1,
                marketDataType: 3,
              },
              rawTicks: {},
              warnings: [],
              completed: true,
              timedOut: false,
            },
            error: null,
          })),
          totals: {
            requested: input.symbols.length,
            completed: input.symbols.length,
            failed: 0,
          },
          warnings: [],
        };
      },
      async previewStockOrderWhatIf() {
        calls.push("previewStockOrderWhatIf");
        return {
          orderId: 1,
          requestedOrder: {
            symbol: "AAPL",
            action: "BUY",
            quantity: "1",
            orderType: "MKT",
            limitPrice: null,
            tif: "DAY",
            exchange: "SMART",
            primaryExchange: "",
            currency: "USD",
            account: "DU123",
            outsideRth: false,
          },
          preview: {
            status: "PreSubmitted",
            initMarginBefore: 0,
            maintMarginBefore: 0,
            equityWithLoanBefore: 0,
            initMarginChange: 0,
            maintMarginChange: 0,
            equityWithLoanChange: 0,
            initMarginAfter: 0,
            maintMarginAfter: 0,
            equityWithLoanAfter: 0,
            commissionAndFees: 0,
            minCommissionAndFees: 0,
            maxCommissionAndFees: 0,
            commissionAndFeesCurrency: "USD",
            marginCurrency: "USD",
            initMarginBeforeOutsideRth: 0,
            maintMarginBeforeOutsideRth: 0,
            equityWithLoanBeforeOutsideRth: 0,
            initMarginChangeOutsideRth: 0,
            maintMarginChangeOutsideRth: 0,
            equityWithLoanChangeOutsideRth: 0,
            initMarginAfterOutsideRth: 0,
            maintMarginAfterOutsideRth: 0,
            equityWithLoanAfterOutsideRth: 0,
            suggestedSize: null,
            rejectReason: null,
            warningText: null,
          },
        };
      },
      async placeStockOrder() {
        calls.push("placeStockOrder");
        return {
          orderId: 2,
          requestedOrder: {
            symbol: "AAPL",
            action: "BUY",
            quantity: "1",
            orderType: "MKT",
            limitPrice: null,
            tif: "DAY",
            exchange: "SMART",
            primaryExchange: "",
            currency: "USD",
            account: "DU123",
            outsideRth: false,
          },
          orderState: {
            status: "Submitted",
            initMarginBefore: null,
            maintMarginBefore: null,
            equityWithLoanBefore: null,
            initMarginChange: null,
            maintMarginChange: null,
            equityWithLoanChange: null,
            initMarginAfter: null,
            maintMarginAfter: null,
            equityWithLoanAfter: null,
            commissionAndFees: null,
            minCommissionAndFees: null,
            maxCommissionAndFees: null,
            commissionAndFeesCurrency: null,
            marginCurrency: null,
            initMarginBeforeOutsideRth: null,
            maintMarginBeforeOutsideRth: null,
            equityWithLoanBeforeOutsideRth: null,
            initMarginChangeOutsideRth: null,
            maintMarginChangeOutsideRth: null,
            equityWithLoanChangeOutsideRth: null,
            initMarginAfterOutsideRth: null,
            maintMarginAfterOutsideRth: null,
            equityWithLoanAfterOutsideRth: null,
            suggestedSize: null,
            rejectReason: null,
            warningText: null,
          },
          orderStatus: null,
        };
      },
      async modifyStockOrder() {
        calls.push("modifyStockOrder");
        return {
          orderId: 44,
          requestedOrder: {
            orderId: 44,
            symbol: "AAPL",
            action: "SELL",
            quantity: "2",
            orderType: "MKT",
            limitPrice: null,
            tif: "DAY",
            exchange: "SMART",
            primaryExchange: "",
            currency: "USD",
            account: "DU123",
            outsideRth: false,
          },
          orderState: {
            status: "Submitted",
            initMarginBefore: null,
            maintMarginBefore: null,
            equityWithLoanBefore: null,
            initMarginChange: null,
            maintMarginChange: null,
            equityWithLoanChange: null,
            initMarginAfter: null,
            maintMarginAfter: null,
            equityWithLoanAfter: null,
            commissionAndFees: null,
            minCommissionAndFees: null,
            maxCommissionAndFees: null,
            commissionAndFeesCurrency: null,
            marginCurrency: null,
            initMarginBeforeOutsideRth: null,
            maintMarginBeforeOutsideRth: null,
            equityWithLoanBeforeOutsideRth: null,
            initMarginChangeOutsideRth: null,
            maintMarginChangeOutsideRth: null,
            equityWithLoanChangeOutsideRth: null,
            initMarginAfterOutsideRth: null,
            maintMarginAfterOutsideRth: null,
            equityWithLoanAfterOutsideRth: null,
            suggestedSize: null,
            rejectReason: null,
            warningText: null,
          },
          orderStatus: null,
        };
      },
      async cancelStockOrder() {
        calls.push("cancelStockOrder");
        return {
          orderId: 2,
          acknowledgedStatus: {
            orderId: 2,
            status: "Cancelled",
            filled: "0",
            remaining: "1",
            avgFillPrice: 0,
            permId: 123,
            parentId: 0,
            lastFillPrice: 0,
            clientId: 0,
            whyHeld: "",
            mktCapPrice: 0,
          },
        };
      },
    },
  };
}

function findTool(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    throw new Error(`Expected tool "${name}" to be registered.`);
  }

  return tool;
}
