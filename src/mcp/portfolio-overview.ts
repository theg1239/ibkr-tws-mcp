import type { TwsGatewayClient } from "../tws/client.ts";
import type {
  AccountPnLSnapshot,
  AccountSummaryResponse,
  HeldStockPnLSnapshotItem,
  HeldStockSnapshotItem,
  MarketDataType,
  OpenStockOrdersResponse,
  TickValue,
} from "../tws/types.ts";

const PORTFOLIO_ACCOUNT_SUMMARY_TAGS = [
  "NetLiquidation",
  "TotalCashValue",
  "BuyingPower",
  "AvailableFunds",
  "ExcessLiquidity",
  "InitMarginReq",
  "MaintMarginReq",
  "GrossPositionValue",
].join(",");

const DEFAULT_RANK_LIMIT = 5;
const HIGH_CONCENTRATION_PERCENT = 25;
const MEDIUM_CONCENTRATION_PERCENT = 15;
const WIDE_SPREAD_ALERT_BPS = 25;

export type StockPortfolioOverviewRequestOptions = {
  includeOpenOrders?: boolean;
  includeLivePnl?: boolean;
  includeAccountLivePnl?: boolean;
  rankLimit?: number;
  marketDataType?: MarketDataType;
  account?: string;
  modelCode?: string;
  accountSummaryTimeoutMs?: number;
  positionsTimeoutMs?: number;
  heldStockSnapshotsTimeoutMs?: number;
  livePnlTimeoutMs?: number;
  accountLivePnlTimeoutMs?: number;
  openOrdersTimeoutMs?: number;
};

export type StockPortfolioSummaryField = {
  value: number | null;
  currency: string | null;
};

export type StockPortfolioHolding = {
  account: string;
  symbol: string;
  conid: number;
  exchange: string;
  currency: string;
  quantity: number;
  averageCost: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  grossExposure: number | null;
  costBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  dailyPnl: number | null;
  realizedPnl: number | null;
  weightPercentOfNetLiq: number | null;
  spreadBps: number | null;
  marketDataType: MarketDataType | null;
  delayed: boolean;
  livePnlValue: number | null;
  livePnlReceivedAt: string | null;
  openOrderCount: number;
  snapshotWarnings: string[];
  snapshotError: string | null;
  livePnlError: string | null;
};

export type StockPortfolioRankingEntry = {
  rank: number;
  symbol: string;
  account: string;
  weightPercentOfNetLiq: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  spreadBps: number | null;
  openOrderCount: number;
  alertLevel: "high" | "medium" | "normal";
};

export type StockPortfolioOverviewResponse = {
  generatedAt: string;
  requested: {
    includeOpenOrders: boolean;
    includeLivePnl: boolean;
    includeAccountLivePnl: boolean;
    rankLimit: number;
    marketDataType: MarketDataType | null;
  };
  accountLivePnl: AccountPnLSnapshot | null;
  summary: {
    netLiquidation: StockPortfolioSummaryField;
    totalCashValue: StockPortfolioSummaryField;
    buyingPower: StockPortfolioSummaryField;
    availableFunds: StockPortfolioSummaryField;
    excessLiquidity: StockPortfolioSummaryField;
    initMarginReq: StockPortfolioSummaryField;
    maintMarginReq: StockPortfolioSummaryField;
    grossPositionValue: StockPortfolioSummaryField;
    stockPositionCount: number;
    quotedPositionCount: number;
    positionsMissingQuotes: number;
    totalStockMarketValue: number | null;
    totalGrossStockExposure: number | null;
    totalCostBasis: number | null;
    totalUnrealizedPnl: number | null;
    totalUnrealizedPnlPercent: number | null;
    totalDailyPnl: number | null;
    totalRealizedPnl: number | null;
    totalOpenStockOrders: number;
    livePnlPositionCount: number;
    marginDebit: boolean;
  };
  holdings: StockPortfolioHolding[];
  rankings: {
    largestByWeight: StockPortfolioRankingEntry[];
    biggestLosers: StockPortfolioRankingEntry[];
    biggestWinners: StockPortfolioRankingEntry[];
  };
  alerts: string[];
  warnings: string[];
};

type SummaryTotals = {
  values: Record<string, StockPortfolioSummaryField>;
  warnings: string[];
};

export async function buildStockPortfolioOverview(
  gateway: TwsGatewayClient,
  options: StockPortfolioOverviewRequestOptions = {},
): Promise<StockPortfolioOverviewResponse> {
  const includeOpenOrders = options.includeOpenOrders ?? true;
  const includeLivePnl = options.includeLivePnl ?? false;
  const includeAccountLivePnl = options.includeAccountLivePnl ?? false;
  const requestedMarketDataType = options.marketDataType ?? null;
  const rankLimit = normalizeRankLimit(options.rankLimit);

  const [accountSummary, positions, openOrders] = await Promise.all([
    gateway.requestAccountSummary({
      tags: PORTFOLIO_ACCOUNT_SUMMARY_TAGS,
      timeoutMs: options.accountSummaryTimeoutMs,
    }),
    gateway.requestPositions({
      timeoutMs: options.positionsTimeoutMs,
    }),
    includeOpenOrders
      ? gateway.requestOpenStockOrders(options.openOrdersTimeoutMs)
      : Promise.resolve<OpenStockOrdersResponse | undefined>(undefined),
  ]);

  const heldStockSnapshots = await gateway.requestHeldStockSnapshots({
    positions,
    timeoutMs: options.heldStockSnapshotsTimeoutMs,
    marketDataType: requestedMarketDataType ?? undefined,
  });
  const heldStockPnL =
    includeLivePnl
      ? await gateway.requestHeldStockPnLSnapshots({
          positions,
          modelCode: options.modelCode,
          timeoutMs: options.livePnlTimeoutMs,
        })
      : undefined;
  let accountLivePnl: AccountPnLSnapshot | null = null;
  let accountLivePnlError: string | null = null;

  if (includeAccountLivePnl) {
    const account = options.account?.trim() || resolveOverviewAccount(accountSummary);

    if (account) {
      try {
        accountLivePnl = await gateway.requestAccountPnLSnapshot({
          account,
          modelCode: options.modelCode,
          timeoutMs: options.accountLivePnlTimeoutMs,
        });
      } catch (error) {
        accountLivePnlError =
          error instanceof Error ? error.message : String(error);
      }
    } else {
      accountLivePnlError = "No account was available from the account summary rows.";
    }
  }

  return createPortfolioOverview({
    accountSummary,
    heldStockSnapshots: heldStockSnapshots.items,
    heldStockPnL: heldStockPnL?.items,
    accountLivePnl,
    accountLivePnlError,
    openOrders,
    includeOpenOrders,
    includeLivePnl,
    includeAccountLivePnl,
    requestedMarketDataType,
    rankLimit,
  });
}

type CreatePortfolioOverviewInput = {
  accountSummary: AccountSummaryResponse;
  heldStockSnapshots: HeldStockSnapshotItem[];
  heldStockPnL?: HeldStockPnLSnapshotItem[];
  accountLivePnl: AccountPnLSnapshot | null;
  accountLivePnlError: string | null;
  openOrders?: OpenStockOrdersResponse;
  includeOpenOrders: boolean;
  includeLivePnl: boolean;
  includeAccountLivePnl: boolean;
  requestedMarketDataType: MarketDataType | null;
  rankLimit: number;
};

function createPortfolioOverview(
  input: CreatePortfolioOverviewInput,
): StockPortfolioOverviewResponse {
  const aggregatedSummary = aggregateSummaryRows(input.accountSummary);
  const netLiquidation = aggregatedSummary.values.NetLiquidation ?? emptySummaryField();
  const totalCashValue = aggregatedSummary.values.TotalCashValue ?? emptySummaryField();
  const buyingPower = aggregatedSummary.values.BuyingPower ?? emptySummaryField();
  const availableFunds = aggregatedSummary.values.AvailableFunds ?? emptySummaryField();
  const excessLiquidity = aggregatedSummary.values.ExcessLiquidity ?? emptySummaryField();
  const initMarginReq = aggregatedSummary.values.InitMarginReq ?? emptySummaryField();
  const maintMarginReq = aggregatedSummary.values.MaintMarginReq ?? emptySummaryField();
  const grossPositionValue = aggregatedSummary.values.GrossPositionValue ?? emptySummaryField();
  const openOrderCounts = buildOpenOrderCountMap(input.openOrders);
  const livePnlByKey = buildLivePnlMap(input.heldStockPnL);

  const holdings = input.heldStockSnapshots
    .map((item) =>
      buildHolding(
        item,
        netLiquidation.value,
        openOrderCounts,
        livePnlByKey.get(toPositionKey(item.position.account, item.position.contract.conid)),
      ),
    )
    .sort(sortHoldingsByWeight);

  const quotedHoldings = holdings.filter((holding) => holding.currentPrice !== null);
  const missingQuoteCount = holdings.length - quotedHoldings.length;
  const totalStockMarketValue = sumValues(holdings.map((holding) => holding.marketValue));
  const totalGrossStockExposure = sumValues(holdings.map((holding) => holding.grossExposure));
  const totalCostBasis = sumValues(holdings.map((holding) => holding.costBasis));
  const totalUnrealizedPnl = sumValues(holdings.map((holding) => holding.unrealizedPnl));
  const totalDailyPnl = sumValues(holdings.map((holding) => holding.dailyPnl));
  const totalRealizedPnl = sumValues(holdings.map((holding) => holding.realizedPnl));
  const totalUnrealizedPnlPercent =
    totalUnrealizedPnl !== null &&
    totalCostBasis !== null &&
    totalCostBasis !== 0
      ? roundNumber((totalUnrealizedPnl / Math.abs(totalCostBasis)) * 100, 2)
      : null;

  const warnings = [
    ...aggregatedSummary.warnings,
    ...(input.accountLivePnlError
      ? [`account_live_pnl_error:${input.accountLivePnlError}`]
      : []),
    ...holdings.flatMap((holding) => [
      ...(holding.snapshotError ? [`snapshot_error:${holding.symbol}:${holding.snapshotError}`] : []),
      ...(holding.livePnlError ? [`live_pnl_error:${holding.symbol}:${holding.livePnlError}`] : []),
      ...holding.snapshotWarnings.map(
        (warning) => `snapshot_warning:${holding.symbol}:${warning}`,
      ),
    ]),
  ];
  const alerts = buildAlerts({
    holdings,
    totalCashValue: totalCashValue.value,
    totalOpenStockOrders: input.openOrders?.orders.length ?? 0,
    missingQuoteCount,
  });

  return {
    generatedAt: new Date().toISOString(),
    requested: {
      includeOpenOrders: input.includeOpenOrders,
      includeLivePnl: input.includeLivePnl,
      includeAccountLivePnl: input.includeAccountLivePnl,
      rankLimit: input.rankLimit,
      marketDataType: input.requestedMarketDataType,
    },
    accountLivePnl: input.accountLivePnl,
    summary: {
      netLiquidation,
      totalCashValue,
      buyingPower,
      availableFunds,
      excessLiquidity,
      initMarginReq,
      maintMarginReq,
      grossPositionValue,
      stockPositionCount: holdings.length,
      quotedPositionCount: quotedHoldings.length,
      positionsMissingQuotes: missingQuoteCount,
      totalStockMarketValue,
      totalGrossStockExposure,
      totalCostBasis,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent,
      totalDailyPnl,
      totalRealizedPnl,
      totalOpenStockOrders: input.openOrders?.orders.length ?? 0,
      livePnlPositionCount: holdings.filter((holding) => holding.livePnlValue !== null).length,
      marginDebit: totalCashValue.value !== null && totalCashValue.value < 0,
    },
    holdings,
    rankings: {
      largestByWeight: buildRankingEntries(holdings, input.rankLimit, (left, right) => {
        const leftValue = left.weightPercentOfNetLiq ?? Number.NEGATIVE_INFINITY;
        const rightValue = right.weightPercentOfNetLiq ?? Number.NEGATIVE_INFINITY;
        return rightValue - leftValue;
      }),
      biggestLosers: buildRankingEntries(
        holdings.filter((holding) => holding.unrealizedPnlPercent !== null),
        input.rankLimit,
        (left, right) => {
          const leftValue = left.unrealizedPnlPercent ?? Number.POSITIVE_INFINITY;
          const rightValue = right.unrealizedPnlPercent ?? Number.POSITIVE_INFINITY;
          return leftValue - rightValue;
        },
      ),
      biggestWinners: buildRankingEntries(
        holdings.filter((holding) => holding.unrealizedPnlPercent !== null),
        input.rankLimit,
        (left, right) => {
          const leftValue = left.unrealizedPnlPercent ?? Number.NEGATIVE_INFINITY;
          const rightValue = right.unrealizedPnlPercent ?? Number.NEGATIVE_INFINITY;
          return rightValue - leftValue;
        },
      ),
    },
    alerts,
    warnings,
  };
}

function resolveOverviewAccount(accountSummary: AccountSummaryResponse): string {
  const firstRowAccount = accountSummary.rows[0]?.account?.trim() || "";
  if (firstRowAccount) {
    return firstRowAccount;
  }

  const firstByAccountKey = Object.keys(accountSummary.byAccount)[0]?.trim() || "";
  return firstByAccountKey;
}

function buildHolding(
  item: HeldStockSnapshotItem,
  netLiquidation: number | null,
  openOrderCounts: Map<string, number>,
  livePnlItem: HeldStockPnLSnapshotItem | undefined,
): StockPortfolioHolding {
  const quantity = Number.parseFloat(item.position.position ?? "0");
  const averageCost = item.position.averageCost;
  const livePnlValue = livePnlItem?.pnl?.value ?? null;
  const snapshotPrice = resolveCurrentPrice(item);
  const currentPrice =
    snapshotPrice ??
    (livePnlValue !== null && Number.isFinite(quantity) && quantity !== 0
      ? roundNumber(livePnlValue / quantity, 4)
      : null);
  const marketValue =
    livePnlValue ??
    (Number.isFinite(quantity) && currentPrice !== null
      ? roundNumber(quantity * currentPrice, 2)
      : null);
  const grossExposure = marketValue !== null ? roundNumber(Math.abs(marketValue), 2) : null;
  const costBasis =
    Number.isFinite(quantity) && averageCost !== null
      ? roundNumber(quantity * averageCost, 2)
      : null;
  const unrealizedPnl =
    livePnlItem?.pnl?.unrealizedPnL ??
    (marketValue !== null && costBasis !== null
      ? roundNumber(marketValue - costBasis, 2)
      : null);
  const unrealizedPnlPercent =
    unrealizedPnl !== null && costBasis !== null && costBasis !== 0
      ? roundNumber((unrealizedPnl / Math.abs(costBasis)) * 100, 2)
      : null;
  const weightPercentOfNetLiq =
    grossExposure !== null && netLiquidation !== null && netLiquidation > 0
      ? roundNumber((grossExposure / netLiquidation) * 100, 2)
      : null;
  const spreadBps = resolveSpreadBps(item);
  const marketDataType = resolveMarketDataType(item);
  const delayed = marketDataType === 3 || marketDataType === 4;

  return {
    account: item.position.account,
    symbol: item.position.contract.symbol,
    conid: item.position.contract.conid,
    exchange: item.position.contract.exchange,
    currency: item.position.contract.currency,
    quantity,
    averageCost,
    currentPrice,
    marketValue,
    grossExposure,
    costBasis,
    unrealizedPnl,
    unrealizedPnlPercent,
    dailyPnl: livePnlItem?.pnl?.dailyPnL ?? null,
    realizedPnl: livePnlItem?.pnl?.realizedPnL ?? null,
    weightPercentOfNetLiq,
    spreadBps,
    marketDataType,
    delayed,
    livePnlValue,
    livePnlReceivedAt: livePnlItem?.pnl?.receivedAt ?? null,
    openOrderCount: openOrderCounts.get(toOpenOrderKey(item.position.account, item.position.contract.symbol)) ?? 0,
    snapshotWarnings: item.snapshot?.warnings ?? [],
    snapshotError: item.error,
    livePnlError: livePnlItem?.error ?? null,
  };
}

function aggregateSummaryRows(accountSummary: AccountSummaryResponse): SummaryTotals {
  const tagEntries = new Map<
    string,
    {
      sum: number;
      currency: string | null;
      mixedCurrency: boolean;
      count: number;
    }
  >();
  const warnings: string[] = [];

  for (const row of accountSummary.rows) {
    const numericValue = Number.parseFloat(row.value);
    if (!Number.isFinite(numericValue)) {
      continue;
    }

    const existing = tagEntries.get(row.tag) ?? {
      sum: 0,
      currency: row.currency || null,
      mixedCurrency: false,
      count: 0,
    };

    if (
      existing.currency &&
      row.currency &&
      existing.currency !== row.currency
    ) {
      existing.mixedCurrency = true;
    } else if (!existing.currency && row.currency) {
      existing.currency = row.currency;
    }

    existing.sum += numericValue;
    existing.count += 1;
    tagEntries.set(row.tag, existing);
  }

  const values: Record<string, StockPortfolioSummaryField> = {};

  for (const [tag, entry] of tagEntries.entries()) {
    if (entry.mixedCurrency) {
      values[tag] = {
        value: null,
        currency: null,
      };
      warnings.push(`mixed_currency_account_summary:${tag}`);
      continue;
    }

    values[tag] = {
      value: roundNumber(entry.sum, 2),
      currency: entry.currency,
    };
  }

  return {
    values,
    warnings,
  };
}

function buildOpenOrderCountMap(
  openOrders: OpenStockOrdersResponse | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();

  if (!openOrders) {
    return counts;
  }

  for (const order of openOrders.orders) {
    const key = toOpenOrderKey(order.order.account, order.contract.symbol);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function toOpenOrderKey(account: string, symbol: string): string {
  return `${account.trim().toUpperCase()}::${symbol.trim().toUpperCase()}`;
}

function toPositionKey(account: string, conid: number): string {
  return `${account.trim().toUpperCase()}::${conid}`;
}

function buildLivePnlMap(
  items: HeldStockPnLSnapshotItem[] | undefined,
): Map<string, HeldStockPnLSnapshotItem> {
  const result = new Map<string, HeldStockPnLSnapshotItem>();

  if (!items) {
    return result;
  }

  for (const item of items) {
    result.set(toPositionKey(item.position.account, item.position.contract.conid), item);
  }

  return result;
}

function resolveCurrentPrice(item: HeldStockSnapshotItem): number | null {
  return (
    readSnapshotNumber(item, "last") ??
    readSnapshotNumber(item, "delayedLast") ??
    readSnapshotNumber(item, "close") ??
    midpoint(
      readSnapshotNumber(item, "bid") ?? readSnapshotNumber(item, "tick_66"),
      readSnapshotNumber(item, "ask") ?? readSnapshotNumber(item, "tick_67"),
    )
  );
}

function resolveSpreadBps(item: HeldStockSnapshotItem): number | null {
  const bid =
    readSnapshotNumber(item, "bid") ??
    readSnapshotNumber(item, "tick_66");
  const ask =
    readSnapshotNumber(item, "ask") ??
    readSnapshotNumber(item, "tick_67");
  const mid = midpoint(bid, ask);

  if (bid === null || ask === null || mid === null || mid <= 0) {
    return null;
  }

  return roundNumber(((ask - bid) / mid) * 10_000, 2);
}

function resolveMarketDataType(item: HeldStockSnapshotItem): MarketDataType | null {
  const directType = readSnapshotNumber(item, "marketDataType");
  const rawType = readSnapshotNumber(item, "tick_-58");
  const value = directType ?? rawType;

  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  return null;
}

function readSnapshotNumber(item: HeldStockSnapshotItem, key: string): number | null {
  if (!item.snapshot) {
    return null;
  }

  const value = item.snapshot.fields[key] ?? item.snapshot.rawTicks[key] ?? null;
  return toFiniteNumber(value);
}

function toFiniteNumber(value: TickValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function midpoint(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null;
  }

  return roundNumber((left + right) / 2, 4);
}

function sumValues(values: Array<number | null>): number | null {
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length === 0) {
    return null;
  }

  return roundNumber(
    presentValues.reduce((sum, value) => sum + value, 0),
    2,
  );
}

function buildAlerts(input: {
  holdings: StockPortfolioHolding[];
  totalCashValue: number | null;
  totalOpenStockOrders: number;
  missingQuoteCount: number;
}): string[] {
  const alerts: string[] = [];

  if (input.totalCashValue !== null && input.totalCashValue < 0) {
    alerts.push("margin_debit_present");
  }

  if (input.totalOpenStockOrders > 0) {
    alerts.push(`open_stock_orders_present:${input.totalOpenStockOrders}`);
  }

  if (input.missingQuoteCount > 0) {
    alerts.push(`positions_missing_quotes:${input.missingQuoteCount}`);
  }

  for (const holding of input.holdings) {
    if (
      holding.weightPercentOfNetLiq !== null &&
      holding.weightPercentOfNetLiq >= HIGH_CONCENTRATION_PERCENT
    ) {
      alerts.push(
        `high_concentration:${holding.symbol}:${formatNumber(holding.weightPercentOfNetLiq)}%`,
      );
    } else if (
      holding.weightPercentOfNetLiq !== null &&
      holding.weightPercentOfNetLiq >= MEDIUM_CONCENTRATION_PERCENT
    ) {
      alerts.push(
        `medium_concentration:${holding.symbol}:${formatNumber(holding.weightPercentOfNetLiq)}%`,
      );
    }

    if (holding.spreadBps !== null && holding.spreadBps > WIDE_SPREAD_ALERT_BPS) {
      alerts.push(`wide_spread:${holding.symbol}:${formatNumber(holding.spreadBps)}bps`);
    }
  }

  return alerts;
}

function buildRankingEntries(
  holdings: StockPortfolioHolding[],
  rankLimit: number,
  sorter: (left: StockPortfolioHolding, right: StockPortfolioHolding) => number,
): StockPortfolioRankingEntry[] {
  return [...holdings]
    .sort(sorter)
    .slice(0, rankLimit)
    .map((holding, index) => ({
      rank: index + 1,
      symbol: holding.symbol,
      account: holding.account,
      weightPercentOfNetLiq: holding.weightPercentOfNetLiq,
      marketValue: holding.marketValue,
      unrealizedPnl: holding.unrealizedPnl,
      unrealizedPnlPercent: holding.unrealizedPnlPercent,
      spreadBps: holding.spreadBps,
      openOrderCount: holding.openOrderCount,
      alertLevel: toAlertLevel(holding.weightPercentOfNetLiq),
    }));
}

function toAlertLevel(
  weightPercentOfNetLiq: number | null,
): "high" | "medium" | "normal" {
  if (weightPercentOfNetLiq !== null && weightPercentOfNetLiq >= HIGH_CONCENTRATION_PERCENT) {
    return "high";
  }

  if (weightPercentOfNetLiq !== null && weightPercentOfNetLiq >= MEDIUM_CONCENTRATION_PERCENT) {
    return "medium";
  }

  return "normal";
}

function sortHoldingsByWeight(
  left: StockPortfolioHolding,
  right: StockPortfolioHolding,
): number {
  const leftWeight = left.weightPercentOfNetLiq ?? Number.NEGATIVE_INFINITY;
  const rightWeight = right.weightPercentOfNetLiq ?? Number.NEGATIVE_INFINITY;
  if (rightWeight !== leftWeight) {
    return rightWeight - leftWeight;
  }

  const leftExposure = left.grossExposure ?? Number.NEGATIVE_INFINITY;
  const rightExposure = right.grossExposure ?? Number.NEGATIVE_INFINITY;
  return rightExposure - leftExposure;
}

function normalizeRankLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined) {
    return DEFAULT_RANK_LIMIT;
  }

  return Math.max(1, Math.min(value, 25));
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function emptySummaryField(): StockPortfolioSummaryField {
  return {
    value: null,
    currency: null,
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
