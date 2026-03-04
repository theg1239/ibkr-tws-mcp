import type {
  StockSetupAnalysis,
  StockSetupBias,
  StockSetupRating,
} from "../analysis/stock-analysis.ts";
import type { TwsGatewayClient } from "../tws/client.ts";
import type { AccountPnLSnapshot, MarketDataType } from "../tws/types.ts";
import {
  buildStockMarketScenario,
  buildStockScannerView,
  type StockMarketScannerEntry,
  type StockScannerPreset,
} from "./market-scenario.ts";
import {
  buildStockPortfolioOverview,
  type StockPortfolioHolding,
} from "./portfolio-overview.ts";
import { buildStockStudies, type StockStudyBatchItem } from "./stock-study.ts";

const DEFAULT_SCANNER_PRESET: StockScannerPreset = "intraday_momentum";
const DEFAULT_SCAN_ROWS = 6;
const DEFAULT_SCENARIO_ROWS = 4;
const DEFAULT_RANK_LIMIT = 8;
const MAX_STUDY_SYMBOLS = 20;

export type StockTradeCandidatesRequestOptions = {
  symbols?: string[];
  includeHeldPositions?: boolean;
  includeOpenOrders?: boolean;
  includeLivePnl?: boolean;
  includeAccountLivePnl?: boolean;
  scannerPreset?: StockScannerPreset;
  scanRows?: number;
  scenarioRowsPerScan?: number;
  rankLimit?: number;
  marketDataType?: MarketDataType;
  account?: string;
  modelCode?: string;
  durationStr?: string;
  barSizeSetting?: string;
  includeIntradayBars?: boolean;
  intradayDurationStr?: string;
  intradayBarSizeSetting?: string;
  accountSummaryTimeoutMs?: number;
  positionsTimeoutMs?: number;
  heldStockSnapshotsTimeoutMs?: number;
  livePnlTimeoutMs?: number;
  accountLivePnlTimeoutMs?: number;
  openOrdersTimeoutMs?: number;
  snapshotTimeoutMs?: number;
  timeoutMs?: number;
};

export type TradeCandidateAction = "trim" | "watch_long" | "hold" | "avoid";

export type StockTradeCandidate = {
  rank: number;
  symbol: string;
  action: TradeCandidateAction;
  priorityScore: number;
  held: boolean;
  sourceTags: string[];
  currentWeightPercent: number | null;
  currentPrice: number | null;
  changePercent: number | null;
  dailyPnl: number | null;
  unrealizedPnlPercent: number | null;
  spreadBps: number | null;
  score: number | null;
  rating: StockSetupRating | null;
  bias: StockSetupBias | null;
  eligibleForNewEntries: boolean;
  sizeTier: StockSetupAnalysis["riskPlan"]["sizeTier"] | null;
  stopReference: number | null;
  stopDistancePercent: number | null;
  notes: string[];
  warnings: string[];
};

export type StockTradeCandidatesResponse = {
  generatedAt: string;
  requested: {
    includeHeldPositions: boolean;
    includeOpenOrders: boolean;
    includeLivePnl: boolean;
    includeAccountLivePnl: boolean;
    scannerPreset: StockScannerPreset;
    scanRows: number;
    scenarioRowsPerScan: number;
    rankLimit: number;
    marketDataType: MarketDataType | null;
  };
  accountLivePnl: AccountPnLSnapshot | null;
  portfolio: {
    netLiquidation: number | null;
    stockPositionCount: number;
    totalOpenStockOrders: number;
    alerts: string[];
  };
  market: {
    benchmarkTrend: "risk_on" | "risk_off" | "mixed" | "unknown";
    topGainerSymbol: string | null;
    topLoserSymbol: string | null;
    mostActiveSymbol: string | null;
    focusSymbols: string[];
  };
  universe: {
    requestedSymbols: string[];
    finalSymbols: string[];
    sourceCount: number;
  };
  candidates: StockTradeCandidate[];
  warnings: string[];
};

type AggregatedHolding = {
  symbol: string;
  held: boolean;
  currentWeightPercent: number | null;
  currentPrice: number | null;
  dailyPnl: number | null;
  unrealizedPnlPercent: number | null;
  spreadBps: number | null;
  notes: string[];
};

type MarketContext = {
  currentPrice: number | null;
  changePercent: number | null;
  spreadBps: number | null;
};

export async function buildStockTradeCandidates(
  gateway: TwsGatewayClient,
  options: StockTradeCandidatesRequestOptions = {},
): Promise<StockTradeCandidatesResponse> {
  const includeHeldPositions = options.includeHeldPositions ?? true;
  const includeOpenOrders = options.includeOpenOrders ?? true;
  const includeLivePnl = options.includeLivePnl ?? true;
  const includeAccountLivePnl = options.includeAccountLivePnl ?? true;
  const scannerPreset = options.scannerPreset ?? DEFAULT_SCANNER_PRESET;
  const scanRows = normalizeCount(options.scanRows, DEFAULT_SCAN_ROWS, 25);
  const scenarioRowsPerScan = normalizeCount(options.scenarioRowsPerScan, DEFAULT_SCENARIO_ROWS, 25);
  const rankLimit = normalizeCount(options.rankLimit, DEFAULT_RANK_LIMIT, 25);
  const requestedMarketDataType = options.marketDataType ?? null;

  const [portfolio, marketScenario, focusScan] = await Promise.all([
    buildStockPortfolioOverview(gateway, {
      includeOpenOrders,
      includeLivePnl,
      includeAccountLivePnl,
      marketDataType: requestedMarketDataType ?? undefined,
      account: options.account,
      modelCode: options.modelCode,
      accountSummaryTimeoutMs: options.accountSummaryTimeoutMs,
      positionsTimeoutMs: options.positionsTimeoutMs,
      heldStockSnapshotsTimeoutMs: options.heldStockSnapshotsTimeoutMs,
      livePnlTimeoutMs: options.livePnlTimeoutMs,
      accountLivePnlTimeoutMs: options.accountLivePnlTimeoutMs,
      openOrdersTimeoutMs: options.openOrdersTimeoutMs,
      rankLimit,
    }),
    buildStockMarketScenario(gateway, {
      rowsPerScan: scenarioRowsPerScan,
      marketDataType: requestedMarketDataType ?? undefined,
      includeSnapshots: true,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
      timeoutMs: options.timeoutMs,
    }),
    buildStockScannerView(gateway, {
      preset: scannerPreset,
      numberOfRows: scanRows,
      marketDataType: requestedMarketDataType ?? undefined,
      includeSnapshots: true,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
      timeoutMs: options.timeoutMs,
    }),
  ]);

  const sourceTags = new Map<string, Set<string>>();
  addSymbols(sourceTags, normalizeSymbols(options.symbols), "requested");
  if (includeHeldPositions) {
    addSymbols(
      sourceTags,
      portfolio.holdings.map((holding) => holding.symbol),
      "holding",
    );
  }
  addSymbols(
    sourceTags,
    focusScan.results.map((entry) => entry.symbol),
    "scanner_preset",
  );
  addSymbols(
    sourceTags,
    marketScenario.movers.topGainers.map((entry) => entry.symbol),
    "top_gainer",
  );
  addSymbols(
    sourceTags,
    marketScenario.movers.topLosers.map((entry) => entry.symbol),
    "top_loser",
  );
  addSymbols(
    sourceTags,
    marketScenario.movers.mostActive.map((entry) => entry.symbol),
    "most_active",
  );

  const finalSymbols = Array.from(sourceTags.keys()).slice(0, MAX_STUDY_SYMBOLS);
  const holdingBySymbol = aggregateHoldingsBySymbol(portfolio.holdings);
  const marketBySymbol = buildMarketContextBySymbol([
    ...focusScan.results,
    ...marketScenario.movers.topGainers,
    ...marketScenario.movers.topLosers,
    ...marketScenario.movers.mostActive,
  ]);
  let studyBySymbol = new Map<string, StockStudyBatchItem>();
  const warnings = [
    ...portfolio.warnings,
    ...marketScenario.warnings,
    ...focusScan.warnings,
  ];

  if (finalSymbols.length > 0) {
    try {
      const studies = await buildStockStudies(gateway, {
        symbols: finalSymbols,
        durationStr: options.durationStr,
        barSizeSetting: options.barSizeSetting,
        includeIntradayBars: options.includeIntradayBars ?? true,
        intradayDurationStr: options.intradayDurationStr,
        intradayBarSizeSetting: options.intradayBarSizeSetting,
        includeSnapshot: true,
        snapshotMarketDataType: requestedMarketDataType ?? undefined,
        snapshotTimeoutMs: options.snapshotTimeoutMs,
        includePositionContext: false,
        timeoutMs: options.timeoutMs,
        rankLimit: finalSymbols.length,
      });
      studyBySymbol = new Map(
        studies.studies.map((study) => [study.symbol, study]),
      );
      warnings.push(...studies.warnings);
    } catch (error) {
      warnings.push(
        `stock_studies_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const candidates = finalSymbols
    .map((symbol) =>
      createCandidate({
        symbol,
        sourceTags: Array.from(sourceTags.get(symbol) ?? []),
        holding: holdingBySymbol.get(symbol) ?? null,
        market: marketBySymbol.get(symbol) ?? null,
        study: studyBySymbol.get(symbol) ?? null,
      }),
    )
    .sort(sortCandidates)
    .slice(0, rankLimit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));

  return {
    generatedAt: new Date().toISOString(),
    requested: {
      includeHeldPositions,
      includeOpenOrders,
      includeLivePnl,
      includeAccountLivePnl,
      scannerPreset,
      scanRows,
      scenarioRowsPerScan,
      rankLimit,
      marketDataType: requestedMarketDataType,
    },
    accountLivePnl: portfolio.accountLivePnl,
    portfolio: {
      netLiquidation: portfolio.summary.netLiquidation.value,
      stockPositionCount: portfolio.summary.stockPositionCount,
      totalOpenStockOrders: portfolio.summary.totalOpenStockOrders,
      alerts: portfolio.alerts,
    },
    market: {
      benchmarkTrend: marketScenario.summary.benchmarkTrend,
      topGainerSymbol: marketScenario.summary.topGainerSymbol,
      topLoserSymbol: marketScenario.summary.topLoserSymbol,
      mostActiveSymbol: marketScenario.summary.mostActiveSymbol,
      focusSymbols: focusScan.results.map((entry) => entry.symbol),
    },
    universe: {
      requestedSymbols: normalizeSymbols(options.symbols),
      finalSymbols,
      sourceCount: sourceTags.size,
    },
    candidates,
    warnings,
  };
}

function createCandidate(input: {
  symbol: string;
  sourceTags: string[];
  holding: AggregatedHolding | null;
  market: MarketContext | null;
  study: StockStudyBatchItem | null;
}): StockTradeCandidate {
  const analysis = input.study?.analysis ?? null;
  const action = resolveCandidateAction(input.holding, analysis);
  const notes = [
    ...(input.holding?.notes ?? []),
    ...(analysis?.notes.slice(0, 2) ?? []),
  ];
  const warnings = [
    ...(input.study?.warnings ?? []),
  ];

  return {
    rank: 0,
    symbol: input.symbol,
    action,
    priorityScore: resolvePriorityScore({
      action,
      sourceTags: input.sourceTags,
      holding: input.holding,
      analysis,
    }),
    held: input.holding?.held ?? false,
    sourceTags: input.sourceTags,
    currentWeightPercent: input.holding?.currentWeightPercent ?? null,
    currentPrice:
      input.market?.currentPrice ??
      input.holding?.currentPrice ??
      analysis?.quote.currentPrice ??
      null,
    changePercent: input.market?.changePercent ?? null,
    dailyPnl: input.holding?.dailyPnl ?? null,
    unrealizedPnlPercent: input.holding?.unrealizedPnlPercent ?? null,
    spreadBps:
      input.market?.spreadBps ??
      input.holding?.spreadBps ??
      analysis?.quote.spreadBps ??
      null,
    score: analysis?.score.total ?? null,
    rating: analysis?.score.rating ?? null,
    bias: analysis?.score.bias ?? null,
    eligibleForNewEntries: analysis?.riskPlan.eligibleForNewEntries ?? false,
    sizeTier: analysis?.riskPlan.sizeTier ?? null,
    stopReference: analysis?.riskPlan.stopReference ?? null,
    stopDistancePercent: analysis?.riskPlan.stopDistancePercent ?? null,
    notes,
    warnings,
  };
}

function resolveCandidateAction(
  holding: AggregatedHolding | null,
  analysis: StockSetupAnalysis | null,
): TradeCandidateAction {
  if (
    holding &&
    holding.currentWeightPercent !== null &&
    holding.currentWeightPercent >= 25
  ) {
    return "trim";
  }

  if (!analysis) {
    return holding ? "hold" : "avoid";
  }

  if (!holding && analysis.riskPlan.eligibleForNewEntries && analysis.score.bias !== "avoid") {
    return "watch_long";
  }

  if (analysis.score.bias === "avoid") {
    return holding ? "hold" : "avoid";
  }

  if (holding) {
    return "hold";
  }

  return analysis.riskPlan.eligibleForNewEntries ? "watch_long" : "avoid";
}

function resolvePriorityScore(input: {
  action: TradeCandidateAction;
  sourceTags: string[];
  holding: AggregatedHolding | null;
  analysis: StockSetupAnalysis | null;
}): number {
  const actionWeight: Record<TradeCandidateAction, number> = {
    trim: 400,
    watch_long: 300,
    hold: 200,
    avoid: 100,
  };
  let score = actionWeight[input.action];

  if (input.analysis) {
    score += input.analysis.score.total;
  }

  const currentWeightPercent = input.holding?.currentWeightPercent ?? null;
  if (currentWeightPercent !== null) {
    score += Math.min(currentWeightPercent, 50);
  }

  if (input.sourceTags.includes("scanner_preset")) {
    score += 10;
  }

  if (input.sourceTags.includes("top_gainer")) {
    score += 6;
  }

  if (input.sourceTags.includes("most_active")) {
    score += 4;
  }

  if (input.sourceTags.includes("top_loser")) {
    score -= 5;
  }

  if (!input.holding && input.analysis && !input.analysis.riskPlan.eligibleForNewEntries) {
    score -= 40;
  }

  if (!input.analysis) {
    score -= 120;
  }

  return score;
}

function aggregateHoldingsBySymbol(
  holdings: StockPortfolioHolding[],
): Map<string, AggregatedHolding> {
  const result = new Map<string, AggregatedHolding>();

  for (const holding of holdings) {
    const existing = result.get(holding.symbol);
    if (!existing) {
      const notes =
        holding.weightPercentOfNetLiq !== null && holding.weightPercentOfNetLiq >= 25
          ? [`High concentration at ${holding.weightPercentOfNetLiq}% of net liquidation.`]
          : [];

      result.set(holding.symbol, {
        symbol: holding.symbol,
        held: true,
        currentWeightPercent: holding.weightPercentOfNetLiq,
        currentPrice: holding.currentPrice,
        dailyPnl: holding.dailyPnl,
        unrealizedPnlPercent: holding.unrealizedPnlPercent,
        spreadBps: holding.spreadBps,
        notes,
      });
      continue;
    }

    existing.currentWeightPercent = sumNullable(
      existing.currentWeightPercent,
      holding.weightPercentOfNetLiq,
    );
    existing.dailyPnl = sumNullable(existing.dailyPnl, holding.dailyPnl);
    existing.currentPrice = existing.currentPrice ?? holding.currentPrice;
    existing.unrealizedPnlPercent =
      existing.unrealizedPnlPercent ?? holding.unrealizedPnlPercent;
    existing.spreadBps = existing.spreadBps ?? holding.spreadBps;
  }

  return result;
}

function buildMarketContextBySymbol(
  entries: StockMarketScannerEntry[],
): Map<string, MarketContext> {
  const result = new Map<string, MarketContext>();

  for (const entry of entries) {
    if (!result.has(entry.symbol)) {
      result.set(entry.symbol, {
        currentPrice: entry.currentPrice,
        changePercent: entry.changePercent,
        spreadBps: entry.spreadBps,
      });
      continue;
    }

    const existing = result.get(entry.symbol);
    if (!existing) {
      continue;
    }

    existing.currentPrice = existing.currentPrice ?? entry.currentPrice;
    existing.changePercent = existing.changePercent ?? entry.changePercent;
    existing.spreadBps = existing.spreadBps ?? entry.spreadBps;
  }

  return result;
}

function addSymbols(
  sourceTags: Map<string, Set<string>>,
  symbols: string[],
  tag: string,
) {
  for (const symbol of symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      continue;
    }

    let tags = sourceTags.get(normalized);
    if (!tags) {
      tags = new Set<string>();
      sourceTags.set(normalized, tags);
    }

    tags.add(tag);
  }
}

function normalizeSymbols(symbols: string[] | undefined): string[] {
  if (!symbols) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const symbol of symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function sortCandidates(left: StockTradeCandidate, right: StockTradeCandidate): number {
  if (right.priorityScore !== left.priorityScore) {
    return right.priorityScore - left.priorityScore;
  }

  const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  return left.symbol.localeCompare(right.symbol);
}

function normalizeCount(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || value === undefined) {
    return fallback;
  }

  return Math.max(1, Math.min(value, maximum));
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }

  return (left ?? 0) + (right ?? 0);
}
