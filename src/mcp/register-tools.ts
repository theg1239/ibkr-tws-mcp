import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { TwsGatewayClient } from "../tws/client.ts";
import {
  createApprovalDeclinedResult,
  createApprovalUnavailableResult,
  requestToolApproval,
} from "./confirmations.ts";
import {
  buildStockMarketScenario,
  buildStockScannerView,
  STOCK_SCANNER_PRESET_VALUES,
} from "./market-scenario.ts";
import { buildStockPortfolioOverview } from "./portfolio-overview.ts";
import { buildStockStudies, buildStockStudy } from "./stock-study.ts";
import { buildStockTradeCandidates } from "./trade-candidates.ts";
import { formatError, textResult, toJson } from "./tool-utils.ts";

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const SESSION_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const CONFIGURATION_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const PREVIEW_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const TRADING_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const marketDataTypeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const marketDataTypeInputSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return value;
  }

  return Number.parseInt(trimmed, 10);
}, marketDataTypeSchema);

const stockScannerPresetSchema = z.enum(STOCK_SCANNER_PRESET_VALUES);

const stockOrderInputSchema = z.object({
  symbol: z.string().min(1),
  action: z.union([z.literal("BUY"), z.literal("SELL")]),
  quantity: z.number().positive(),
  orderType: z.union([z.literal("MKT"), z.literal("LMT")]).optional(),
  limitPrice: z.number().positive().optional(),
  tif: z.string().optional(),
  exchange: z.string().optional(),
  primaryExchange: z.string().optional(),
  currency: z.string().optional(),
  account: z.string().optional(),
  outsideRth: z.boolean().optional(),
}).superRefine((value, context) => {
  const orderType = value.orderType ?? "MKT";

  if (orderType === "LMT" && value.limitPrice === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["limitPrice"],
      message: "limitPrice is required when orderType is LMT.",
    });
    return;
  }

  if (orderType === "MKT" && value.limitPrice !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["limitPrice"],
      message: "limitPrice is only allowed when orderType is LMT.",
    });
  }
});

const stockHistoricalBarsInputSchema = z.object({
  symbol: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).min(1).max(50).optional(),
  exchange: z.string().optional(),
  primaryExchange: z.string().optional(),
  currency: z.string().optional(),
  endDateTime: z.string().optional(),
  durationStr: z.string().optional(),
  barSizeSetting: z.string().optional(),
  whatToShow: z.string().optional(),
  useRTH: z.boolean().optional(),
  includeSnapshot: z.boolean().optional(),
  snapshotTimeoutMs: z.number().int().min(500).max(30000).optional(),
  snapshotMarketDataType: marketDataTypeInputSchema.optional(),
  includeIntradayBars: z.boolean().optional(),
  intradayDurationStr: z.string().optional(),
  intradayBarSizeSetting: z.string().optional(),
  includeAnalysis: z.boolean().optional(),
  includePositionContext: z.boolean().optional(),
  positionsTimeoutMs: z.number().int().min(500).max(30000).optional(),
  rankLimit: z.number().int().min(1).max(50).optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
}).superRefine((value, context) => {
  const hasSymbol = typeof value.symbol === "string" && value.symbol.trim().length > 0;
  const hasSymbols = Array.isArray(value.symbols) && value.symbols.length > 0;

  if (hasSymbol && hasSymbols) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbols"],
      message: 'Provide either "symbol" or "symbols", not both.',
    });
    return;
  }

  if (!hasSymbol && !hasSymbols) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbol"],
      message: 'Provide either "symbol" or "symbols".',
    });
  }
});

const marketDataSnapshotInputSchema = z.object({
  symbol: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).min(1).max(50).optional(),
  secType: z.string().optional(),
  exchange: z.string().optional(),
  primaryExchange: z.string().optional(),
  currency: z.string().optional(),
  marketDataType: marketDataTypeInputSchema.optional(),
  genericTickList: z.string().optional(),
  regulatorySnapshot: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
  batchConcurrency: z.number().int().min(1).max(10).optional(),
}).superRefine((value, context) => {
  const hasSymbol = typeof value.symbol === "string" && value.symbol.trim().length > 0;
  const hasSymbols = Array.isArray(value.symbols) && value.symbols.length > 0;

  if (hasSymbol && hasSymbols) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbols"],
      message: 'Provide either "symbol" or "symbols", not both.',
    });
    return;
  }

  if (!hasSymbol && !hasSymbols) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbol"],
      message: 'Provide either "symbol" or "symbols".',
    });
  }
});

export function registerGatewayTools(server: McpServer, gateway: TwsGatewayClient) {
  server.registerTool(
    "connect_gateway",
    {
      description:
        "Connect to IB Gateway or TWS via the supported local socket API. Defaults to paper trading on 127.0.0.1:4002 with clientId 0.",
      inputSchema: {
        host: z.string().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        clientId: z.number().int().min(0).optional(),
      },
      annotations: SESSION_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "connect_gateway",
        description:
          "Connect to IB Gateway or TWS via the supported local socket API. Defaults to paper trading on 127.0.0.1:4002 with clientId 0.",
        args,
        handler: () => gateway.connect(args),
      }),
  );

  server.registerTool(
    "disconnect_gateway",
    {
      description: "Close the current socket connection to IB Gateway or TWS.",
      annotations: SESSION_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "disconnect_gateway",
        description: "Close the current socket connection to IB Gateway or TWS.",
        args: undefined,
        handler: () => gateway.disconnect(),
      }),
  );

  server.registerTool(
    "connection_status",
    {
      description:
        "Return the current socket/API session status, including server version, connection time, and cached order ID.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "connection_status",
        description:
          "Return the current socket/API session status, including server version, connection time, and cached order ID.",
        args: undefined,
        handler: () => gateway.getStatus(),
      }),
  );

  server.registerTool(
    "list_managed_accounts",
    {
      description:
        "Request the account list available to the connected IB Gateway/TWS session.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "list_managed_accounts",
        description:
          "Request the account list available to the connected IB Gateway/TWS session.",
        args: undefined,
        handler: () => gateway.requestManagedAccounts(),
      }),
  );

  server.registerTool(
    "get_current_time",
    {
      description:
        "Request the gateway's current server time. Useful for heartbeat checks and aligning timestamps.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "get_current_time",
        description:
          "Request the gateway's current server time. Useful for heartbeat checks and aligning timestamps.",
        args: undefined,
        handler: () => gateway.requestCurrentTime(),
      }),
  );

  server.registerTool(
    "get_next_valid_order_id",
    {
      description:
        "Request the next valid order ID from the gateway. This is required before placing orders later.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "get_next_valid_order_id",
        description:
          "Request the next valid order ID from the gateway. This is required before placing orders later.",
        args: undefined,
        handler: () => gateway.requestNextValidOrderId(),
      }),
  );

  server.registerTool(
    "get_market_data_type",
    {
      description:
        "Return the locally tracked global market data mode that will be used for future market data requests.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeApprovedTool(server, {
        toolName: "get_market_data_type",
        description:
          "Return the locally tracked global market data mode that will be used for future market data requests.",
        args: undefined,
        handler: () => gateway.getMarketDataType(),
      }),
  );

  server.registerTool(
    "search_stocks",
    {
      description:
        "Search stock symbols only. Returns matching share listings filtered to secType=STK.",
      inputSchema: {
        pattern: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "search_stocks",
        description:
          "Search stock symbols only. Returns matching share listings filtered to secType=STK.",
        args,
        handler: () => gateway.searchStockSymbols(args),
      }),
  );

  server.registerTool(
    "set_market_data_type",
    {
      description:
        "Set the global market data mode for future requests. Use 1 for live, 2 for frozen, 3 for delayed, or 4 for delayed-frozen.",
      inputSchema: {
        marketDataType: marketDataTypeInputSchema,
      },
      annotations: CONFIGURATION_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "set_market_data_type",
        description:
          "Set the global market data mode for future requests. Use 1 for live, 2 for frozen, 3 for delayed, or 4 for delayed-frozen.",
        args,
        handler: () => gateway.setMarketDataType(args.marketDataType),
      }),
  );

  server.registerTool(
    "get_account_summary",
    {
      description:
        "Request account summary values. Defaults to a useful paper-trading-safe tag set.",
      inputSchema: {
        group: z.string().optional(),
        tags: z.string().optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_account_summary",
        description:
          "Request account summary values. Defaults to a useful paper-trading-safe tag set.",
        args,
        handler: () => gateway.requestAccountSummary(args),
      }),
  );

  server.registerTool(
    "get_positions",
    {
      description:
        "Request the current portfolio positions snapshot from the connected gateway session.",
      inputSchema: {
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_positions",
        description:
          "Request the current portfolio positions snapshot from the connected gateway session.",
        args,
        handler: () => gateway.requestPositions(args),
      }),
  );

  server.registerTool(
    "get_stock_historical_bars",
    {
      description:
        "Request a consolidated stock study for one stock or a ranked watchlist. Use `symbol` for a full single-name drill-down, or `symbols` for a compact ranked shortlist with analysis and hard risk rules. This remains stock-only (secType=STK).",
      inputSchema: stockHistoricalBarsInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_stock_historical_bars",
        description:
          "Request a consolidated stock study for one stock or a ranked watchlist. Use `symbol` for a full single-name drill-down, or `symbols` for a compact ranked shortlist with analysis and hard risk rules. This remains stock-only (secType=STK).",
        args,
        handler: () => {
          const commonOptions = {
            exchange: args.exchange,
            primaryExchange: args.primaryExchange,
            currency: args.currency,
            endDateTime: args.endDateTime,
            durationStr: args.durationStr,
            barSizeSetting: args.barSizeSetting,
            whatToShow: args.whatToShow,
            useRTH: args.useRTH,
            timeoutMs: args.timeoutMs,
            includeSnapshot: args.includeSnapshot,
            snapshotTimeoutMs: args.snapshotTimeoutMs,
            snapshotMarketDataType: args.snapshotMarketDataType,
            includeIntradayBars: args.includeIntradayBars,
            intradayDurationStr: args.intradayDurationStr,
            intradayBarSizeSetting: args.intradayBarSizeSetting,
            includeAnalysis: args.includeAnalysis,
            includePositionContext: args.includePositionContext,
            positionsTimeoutMs: args.positionsTimeoutMs,
          };

          if (args.symbols && args.symbols.length > 0) {
            return buildStockStudies(gateway, {
              ...commonOptions,
              symbols: args.symbols,
              rankLimit: args.rankLimit,
            });
          }

          if (args.symbol) {
            return buildStockStudy(gateway, {
              ...commonOptions,
              symbol: args.symbol,
            });
          }

          throw new Error('Provide either "symbol" or "symbols".');
        },
      }),
  );

  server.registerTool(
    "get_gateway_snapshot",
    {
      description:
        "Fetch a compact gateway snapshot for agent planning: status, current time, accounts, next order ID, and optional account, position, open-order, and held-stock quote snapshots.",
      inputSchema: {
        includeAccountSummary: z.boolean().optional(),
        includePositions: z.boolean().optional(),
        includeOpenOrders: z.boolean().optional(),
        includeHeldStockSnapshots: z.boolean().optional(),
        includeAccountLivePnl: z.boolean().optional(),
        accountSummaryTimeoutMs: z.number().int().min(500).max(30000).optional(),
        positionsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        openOrdersTimeoutMs: z.number().int().min(500).max(30000).optional(),
        heldStockSnapshotsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        heldStockSnapshotsMarketDataType: marketDataTypeInputSchema.optional(),
        accountLivePnlAccount: z.string().optional(),
        accountLivePnlModelCode: z.string().optional(),
        accountLivePnlTimeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_gateway_snapshot",
        description:
          "Fetch a compact gateway snapshot for agent planning: status, current time, accounts, next order ID, and optional account, position, open-order, and held-stock quote snapshots.",
        args,
        handler: () => gateway.requestGatewaySnapshot(args),
      }),
  );

  server.registerTool(
    "get_stock_portfolio_overview",
    {
      description:
        "Fetch a stock-focused portfolio planning view in one call: account balances, held stock quotes, optional live single-position P&L, open-order counts, concentration, and unrealized P&L for current holdings.",
      inputSchema: {
        includeOpenOrders: z.boolean().optional(),
        includeLivePnl: z.boolean().optional(),
        includeAccountLivePnl: z.boolean().optional(),
        rankLimit: z.number().int().min(1).max(25).optional(),
        marketDataType: marketDataTypeInputSchema.optional(),
        account: z.string().optional(),
        modelCode: z.string().optional(),
        accountSummaryTimeoutMs: z.number().int().min(500).max(30000).optional(),
        positionsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        heldStockSnapshotsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        livePnlTimeoutMs: z.number().int().min(500).max(30000).optional(),
        accountLivePnlTimeoutMs: z.number().int().min(500).max(30000).optional(),
        openOrdersTimeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_stock_portfolio_overview",
        description:
          "Fetch a stock-focused portfolio planning view in one call: account balances, held stock quotes, optional live single-position P&L, open-order counts, concentration, and unrealized P&L for current holdings.",
        args,
        handler: () => buildStockPortfolioOverview(gateway, args),
      }),
  );

  server.registerTool(
    "scan_stock_market",
    {
      description:
        "Run a real-time stock market scan such as TOP_PERC_GAIN, TOP_PERC_LOSE, or MOST_ACTIVE, or use a built-in intraday preset like intraday_momentum, opening_gap_up, liquid_leaders, or liquid_losers.",
      inputSchema: {
        scanCode: z.string().min(1).optional(),
        preset: stockScannerPresetSchema.optional(),
        locationCode: z.string().optional(),
        numberOfRows: z.number().int().min(1).max(25).optional(),
        marketDataType: marketDataTypeInputSchema.optional(),
        includeSnapshots: z.boolean().optional(),
        snapshotTimeoutMs: z.number().int().min(500).max(30000).optional(),
        abovePrice: z.number().positive().optional(),
        belowPrice: z.number().positive().optional(),
        aboveVolume: z.number().int().positive().optional(),
        marketCapAbove: z.number().positive().optional(),
        marketCapBelow: z.number().positive().optional(),
        stockTypeFilter: z.string().optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "scan_stock_market",
        description:
          "Run a real-time stock market scan such as TOP_PERC_GAIN, TOP_PERC_LOSE, or MOST_ACTIVE, or use a built-in intraday preset like intraday_momentum, opening_gap_up, liquid_leaders, or liquid_losers.",
        args,
        handler: () => buildStockScannerView(gateway, args),
      }),
  );

  server.registerTool(
    "get_stock_trade_candidates",
    {
      description:
        "Build a single stock-only trading shortlist in one call by combining portfolio concentration, live market scenario, a focused intraday scanner preset, and ranked stock studies.",
      inputSchema: {
        symbols: z.array(z.string().min(1)).min(1).max(25).optional(),
        includeHeldPositions: z.boolean().optional(),
        includeOpenOrders: z.boolean().optional(),
        includeLivePnl: z.boolean().optional(),
        includeAccountLivePnl: z.boolean().optional(),
        scannerPreset: stockScannerPresetSchema.optional(),
        scanRows: z.number().int().min(1).max(25).optional(),
        scenarioRowsPerScan: z.number().int().min(1).max(25).optional(),
        rankLimit: z.number().int().min(1).max(25).optional(),
        marketDataType: marketDataTypeInputSchema.optional(),
        account: z.string().optional(),
        modelCode: z.string().optional(),
        durationStr: z.string().optional(),
        barSizeSetting: z.string().optional(),
        includeIntradayBars: z.boolean().optional(),
        intradayDurationStr: z.string().optional(),
        intradayBarSizeSetting: z.string().optional(),
        accountSummaryTimeoutMs: z.number().int().min(500).max(30000).optional(),
        positionsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        heldStockSnapshotsTimeoutMs: z.number().int().min(500).max(30000).optional(),
        livePnlTimeoutMs: z.number().int().min(500).max(30000).optional(),
        accountLivePnlTimeoutMs: z.number().int().min(500).max(30000).optional(),
        openOrdersTimeoutMs: z.number().int().min(500).max(30000).optional(),
        snapshotTimeoutMs: z.number().int().min(500).max(30000).optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_stock_trade_candidates",
        description:
          "Build a single stock-only trading shortlist in one call by combining portfolio concentration, live market scenario, a focused intraday scanner preset, and ranked stock studies.",
        args,
        handler: () => buildStockTradeCandidates(gateway, args),
      }),
  );

  server.registerTool(
    "get_stock_market_scenario",
    {
      description:
        "Fetch a real-time stock market scenario view in one call: benchmark ETF snapshots plus top gainers, top losers, and most active stocks, enriched with current quotes when available.",
      inputSchema: {
        locationCode: z.string().optional(),
        rowsPerScan: z.number().int().min(1).max(25).optional(),
        marketDataType: marketDataTypeInputSchema.optional(),
        includeSnapshots: z.boolean().optional(),
        snapshotTimeoutMs: z.number().int().min(500).max(30000).optional(),
        benchmarkSymbols: z.array(z.string().min(1)).min(1).max(10).optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_stock_market_scenario",
        description:
          "Fetch a real-time stock market scenario view in one call: benchmark ETF snapshots plus top gainers, top losers, and most active stocks, enriched with current quotes when available.",
        args,
        handler: () => buildStockMarketScenario(gateway, args),
      }),
  );

  server.registerTool(
    "get_market_data_snapshot",
    {
      description:
        "Request one or many top-of-book snapshots using reqMktData with snapshot=true.",
      inputSchema: marketDataSnapshotInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "get_market_data_snapshot",
        description:
          "Request one or many top-of-book snapshots using reqMktData with snapshot=true.",
        args,
        handler: () => {
          if (args.symbols && args.symbols.length > 0) {
            return gateway.requestStockMarketSnapshots({
              symbols: args.symbols,
              secType: args.secType,
              exchange: args.exchange,
              primaryExchange: args.primaryExchange,
              currency: args.currency,
              marketDataType: args.marketDataType,
              genericTickList: args.genericTickList,
              regulatorySnapshot: args.regulatorySnapshot,
              timeoutMs: args.timeoutMs,
              batchConcurrency: args.batchConcurrency,
            });
          }

          if (!args.symbol) {
            throw new Error('Provide either "symbol" or "symbols".');
          }

          return gateway.requestMarketDataSnapshot({
            symbol: args.symbol,
            secType: args.secType,
            exchange: args.exchange,
            primaryExchange: args.primaryExchange,
            currency: args.currency,
            marketDataType: args.marketDataType,
            genericTickList: args.genericTickList,
            regulatorySnapshot: args.regulatorySnapshot,
            timeoutMs: args.timeoutMs,
          });
        },
      }),
  );

  server.registerTool(
    "preview_stock_order",
    {
      description:
        "Preview a stock order using IBKR's documented what-if order flow. This uses placeOrder with whatIf=true and returns the openOrder margin/commission preview without submitting a live order.",
      inputSchema: stockOrderInputSchema.extend({
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      }),
      annotations: PREVIEW_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "preview_stock_order",
        description:
          "Preview a stock order using IBKR's documented what-if order flow. This uses placeOrder with whatIf=true and returns the openOrder margin/commission preview without submitting a live order.",
        args,
        handler: () => gateway.previewStockOrderWhatIf(args),
      }),
  );

  server.registerTool(
    "submit_stock_order",
    {
      description:
        "Submit or modify a live stock order through IBKR's documented placeOrder API. By default this runs a what-if preview first in the same call, then submits the live order change and returns both the preview and the acknowledgement. Pass `orderId` to modify an existing working order.",
      inputSchema: stockOrderInputSchema.extend({
        orderId: z.number().int().positive().optional(),
        previewBeforeSubmit: z.boolean().optional(),
        previewTimeoutMs: z.number().int().min(500).max(30000).optional(),
        submitTimeoutMs: z.number().int().min(500).max(30000).optional(),
      }),
      annotations: TRADING_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "submit_stock_order",
        description:
          "Submit or modify a live stock order through IBKR's documented placeOrder API. By default this runs a what-if preview first in the same call, then submits the live order change and returns both the preview and the acknowledgement. Pass `orderId` to modify an existing working order.",
        args,
        handler: async () => {
          const orderRequest = {
            symbol: args.symbol,
            action: args.action,
            quantity: args.quantity,
            orderType: args.orderType,
            limitPrice: args.limitPrice,
            tif: args.tif,
            exchange: args.exchange,
            primaryExchange: args.primaryExchange,
            currency: args.currency,
            account: args.account,
            outsideRth: args.outsideRth,
          };
          const mode = args.orderId ? "modify" : "new";

          const preview =
            args.previewBeforeSubmit === false
              ? null
              : await gateway.previewStockOrderWhatIf({
                  ...orderRequest,
                  timeoutMs: args.previewTimeoutMs,
                });

          const submission = args.orderId
            ? await gateway.modifyStockOrder({
                orderId: args.orderId,
                ...orderRequest,
                timeoutMs: args.submitTimeoutMs,
              })
            : await gateway.placeStockOrder({
                ...orderRequest,
                timeoutMs: args.submitTimeoutMs,
              });

          return {
            mode,
            preview,
            submission,
          };
        },
      }),
  );

  server.registerTool(
    "cancel_stock_order",
    {
      description:
        "Cancel a previously submitted stock order by order ID using IBKR's documented cancelOrder API.",
      inputSchema: {
        orderId: z.number().int().positive(),
        manualOrderCancelTime: z.string().optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      },
      annotations: TRADING_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeApprovedTool(server, {
        toolName: "cancel_stock_order",
        description:
          "Cancel a previously submitted stock order by order ID using IBKR's documented cancelOrder API.",
        args,
        handler: () => gateway.cancelStockOrder(args),
      }),
  );
}

async function executeApprovedTool(
  server: McpServer,
  options: {
    toolName: string;
    description: string;
    args: unknown;
    handler: () => Promise<unknown> | unknown;
  },
) {
  try {
    const approvalDecision = await requestToolApproval(server, {
      toolName: options.toolName,
      description: options.description,
      args: options.args,
    });

    if (approvalDecision.status === "declined") {
      return textResult(toJson(createApprovalDeclinedResult(options.toolName)));
    }

    if (approvalDecision.status === "unavailable") {
      return textResult(
        toJson(createApprovalUnavailableResult(options.toolName, approvalDecision)),
        true,
      );
    }

    return toToolResult(await options.handler());
  } catch (error) {
    const message = formatError(error);
    console.error(message);
    return textResult(message, true);
  }
}

function toToolResult(value: unknown) {
  if (typeof value === "string") {
    return textResult(value);
  }

  return textResult(toJson(value));
}
