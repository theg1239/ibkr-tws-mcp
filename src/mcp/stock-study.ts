import {
  analyzeStockSetup,
  rankStockSetups,
  type StockRiskPlan,
  type StockSetupAnalysis,
} from "../analysis/stock-analysis.ts";
import type { TwsGatewayClient } from "../tws/client.ts";
import type {
  MarketDataType,
  MarketSnapshot,
  PositionRow,
  StockHistoricalBarsRequestOptions,
  StockHistoricalBarsResponse,
} from "../tws/types.ts";

const DEFAULT_BATCH_CONCURRENCY = 3;

export type StockStudyRequestOptions = {
  symbol: string;
  exchange?: string;
  primaryExchange?: string;
  currency?: string;
  endDateTime?: string;
  durationStr?: string;
  barSizeSetting?: string;
  whatToShow?: string;
  useRTH?: boolean;
  timeoutMs?: number;
  includeSnapshot?: boolean;
  snapshotTimeoutMs?: number;
  snapshotMarketDataType?: MarketDataType;
  includeIntradayBars?: boolean;
  intradayDurationStr?: string;
  intradayBarSizeSetting?: string;
  includeAnalysis?: boolean;
  includePositionContext?: boolean;
  positionsTimeoutMs?: number;
};

export type StockStudyBatchRequestOptions = Omit<StockStudyRequestOptions, "symbol"> & {
  symbols: string[];
  rankLimit?: number;
};

export type StockPositionContext = {
  held: boolean;
  accounts: string[];
  totalPosition: number | null;
  weightedAverageCost: number | null;
  rows: PositionRow[];
};

export type StockStudyResponse = {
  symbol: string;
  requested: {
    daily: StockHistoricalBarsRequestOptions;
    intradayIncluded: boolean;
    snapshotIncluded: boolean;
    analysisIncluded: boolean;
    positionContextIncluded: boolean;
  };
  dailyBars: StockHistoricalBarsResponse | null;
  intradayBars: StockHistoricalBarsResponse | null;
  snapshot: MarketSnapshot | null;
  positionContext: StockPositionContext | null;
  analysis: StockSetupAnalysis | null;
  warnings: string[];
};

export type StockStudyBatchItem = {
  symbol: string;
  dailyBarCount: number | null;
  intradayBarCount: number | null;
  snapshot: MarketSnapshot | null;
  positionContext: StockPositionContext | null;
  analysis: StockSetupAnalysis | null;
  warnings: string[];
};

export type StockStudyRankingEntry = {
  rank: number;
  symbol: string;
  score: number;
  rating: StockSetupAnalysis["score"]["rating"];
  bias: StockSetupAnalysis["score"]["bias"];
  eligibleForNewEntries: boolean;
  sizeTier: StockRiskPlan["sizeTier"];
};

export type StockStudyBatchFailure = {
  symbol: string;
  error: string;
};

export type StockStudyBatchResponse = {
  requestedSymbols: string[];
  studies: StockStudyBatchItem[];
  ranking: StockStudyRankingEntry[];
  failures: StockStudyBatchFailure[];
  totals: {
    requested: number;
    completed: number;
    analyzed: number;
    failed: number;
  };
  warnings: string[];
};

type AttemptResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: Error;
    };

type SingleStudyContext = {
  sharedPositionRows?: PositionRow[] | null;
  sharedPositionWarning?: string | null;
};

type StockStudyTaskSuccess = {
  symbol: string;
  study: StockStudyResponse;
  error: null;
};

type StockStudyTaskFailure = {
  symbol: string;
  study: null;
  error: string;
};

type StockStudyTaskResult = StockStudyTaskSuccess | StockStudyTaskFailure;

export async function buildStockStudy(
  gateway: TwsGatewayClient,
  options: StockStudyRequestOptions,
): Promise<StockStudyResponse> {
  return await buildSingleStockStudy(gateway, options);
}

export async function buildStockStudies(
  gateway: TwsGatewayClient,
  options: StockStudyBatchRequestOptions,
): Promise<StockStudyBatchResponse> {
  const requestedSymbols = normalizeSymbols(options.symbols);
  if (requestedSymbols.length === 0) {
    throw new Error("At least one stock symbol is required.");
  }

  const includePositionContext = options.includePositionContext ?? true;
  let sharedPositionRows: PositionRow[] | null | undefined = undefined;
  let sharedPositionWarning: string | null = null;

  if (includePositionContext) {
    const sharedPositionAttempt = await attempt(() =>
      gateway.requestPositions({
        timeoutMs: options.positionsTimeoutMs ?? options.timeoutMs,
      }),
    );

    if (sharedPositionAttempt.ok) {
      sharedPositionRows = sharedPositionAttempt.value.rows;
    } else {
      sharedPositionRows = null;
      sharedPositionWarning = `position_context_unavailable:${sharedPositionAttempt.error.message}`;
    }
  } else {
    sharedPositionRows = null;
  }

  const taskResults = await mapWithConcurrency(
    requestedSymbols,
    Math.min(DEFAULT_BATCH_CONCURRENCY, requestedSymbols.length),
    async (symbol) => {
      try {
        const study = await buildSingleStockStudy(
          gateway,
          toSingleStudyOptions(symbol, options),
          {
            sharedPositionRows,
            sharedPositionWarning,
          },
        );

        return {
          symbol,
          study,
          error: null,
        } satisfies StockStudyTaskSuccess;
      } catch (error) {
        return {
          symbol,
          study: null,
          error: error instanceof Error ? error.message : String(error),
        } satisfies StockStudyTaskFailure;
      }
    },
  );

  const completedStudies = taskResults
    .filter((result): result is StockStudyTaskSuccess => result.study !== null)
    .map((result) => result.study);
  const failures = taskResults
    .filter((result): result is StockStudyTaskFailure => result.study === null)
    .map((result) => ({
      symbol: result.symbol,
      error: result.error,
    }));

  if (completedStudies.length === 0) {
    throw new Error(
      "Unable to build stock studies because every requested symbol failed.",
    );
  }

  const sortedStudies = sortStudiesForRanking(completedStudies);

  return {
    requestedSymbols,
    studies: sortedStudies.map(toBatchItem),
    ranking: buildRankingEntries(sortedStudies, options.rankLimit),
    failures,
    totals: {
      requested: requestedSymbols.length,
      completed: sortedStudies.length,
      analyzed: sortedStudies.filter((study) => study.analysis !== null).length,
      failed: failures.length,
    },
    warnings: [
      ...(sharedPositionWarning ? [sharedPositionWarning] : []),
      ...failures.map(
        (failure) => `study_failed:${failure.symbol}:${failure.error}`,
      ),
    ],
  };
}

async function buildSingleStockStudy(
  gateway: TwsGatewayClient,
  options: StockStudyRequestOptions,
  context: SingleStudyContext = {},
): Promise<StockStudyResponse> {
  const symbol = options.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }

  const includeSnapshot = options.includeSnapshot ?? true;
  const includeAnalysis = options.includeAnalysis ?? true;
  const includePositionContext = options.includePositionContext ?? true;
  const includeIntradayBars = options.includeIntradayBars ?? includeAnalysis;
  const warnings: string[] = [];

  const dailyRequest = buildDailyRequest(symbol, options);
  const intradayRequest = buildIntradayRequest(symbol, options);
  const useSharedPositions = includePositionContext && context.sharedPositionRows !== undefined;

  const [dailyBarsAttempt, intradayBarsAttempt, snapshotAttempt, positionAttempt] =
    await Promise.all([
      attempt(() => gateway.requestStockHistoricalBars(dailyRequest)),
      includeIntradayBars
        ? attempt(() => gateway.requestStockHistoricalBars(intradayRequest))
        : Promise.resolve<AttemptResult<StockHistoricalBarsResponse> | null>(null),
      includeSnapshot
        ? attempt(() =>
            gateway.requestMarketDataSnapshot({
              symbol,
              secType: "STK",
              exchange: dailyRequest.exchange,
              primaryExchange: dailyRequest.primaryExchange,
              currency: dailyRequest.currency,
              marketDataType: options.snapshotMarketDataType,
              timeoutMs: options.snapshotTimeoutMs ?? options.timeoutMs,
            }),
          )
        : Promise.resolve<AttemptResult<MarketSnapshot> | null>(null),
      useSharedPositions
        ? Promise.resolve<AttemptResult<{ rows: PositionRow[] }> | null>(null)
        : includePositionContext
          ? attempt(() =>
              gateway.requestPositions({
                timeoutMs: options.positionsTimeoutMs ?? options.timeoutMs,
              }),
            )
          : Promise.resolve<AttemptResult<{ rows: PositionRow[] }> | null>(null),
    ]);

  const dailyBars = unwrapAttempt(
    dailyBarsAttempt,
    warnings,
    "daily_bars_unavailable",
  );
  const intradayBars = unwrapAttempt(
    intradayBarsAttempt,
    warnings,
    "intraday_bars_unavailable",
  );
  const snapshot = unwrapAttempt(
    snapshotAttempt,
    warnings,
    "snapshot_unavailable",
  );
  const positions = unwrapAttempt(
    positionAttempt,
    warnings,
    "position_context_unavailable",
  );
  const positionRows =
    context.sharedPositionRows !== undefined
      ? context.sharedPositionRows
      : positions?.rows ?? null;

  if (context.sharedPositionWarning) {
    warnings.push(context.sharedPositionWarning);
  }

  if (dailyBars === null && snapshot === null && positionRows === null) {
    throw new Error(
      "Unable to build stock study because historical bars, snapshot data, and position context all failed.",
    );
  }

  let analysis: StockSetupAnalysis | null = null;
  if (includeAnalysis && dailyBars !== null) {
    try {
      analysis = analyzeStockSetup({
        symbol,
        dailyBars: dailyBars.bars,
        intradayBars: intradayBars?.bars,
        snapshot,
        warnings,
      });
    } catch (error) {
      warnings.push(
        `analysis_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    symbol,
    requested: {
      daily: dailyRequest,
      intradayIncluded: includeIntradayBars,
      snapshotIncluded: includeSnapshot,
      analysisIncluded: includeAnalysis,
      positionContextIncluded: includePositionContext,
    },
    dailyBars,
    intradayBars,
    snapshot,
    positionContext: buildPositionContext(symbol, positionRows),
    analysis,
    warnings,
  };
}

function toSingleStudyOptions(
  symbol: string,
  options: StockStudyBatchRequestOptions,
): StockStudyRequestOptions {
  return {
    symbol,
    exchange: options.exchange,
    primaryExchange: options.primaryExchange,
    currency: options.currency,
    endDateTime: options.endDateTime,
    durationStr: options.durationStr,
    barSizeSetting: options.barSizeSetting,
    whatToShow: options.whatToShow,
    useRTH: options.useRTH,
    timeoutMs: options.timeoutMs,
    includeSnapshot: options.includeSnapshot,
    snapshotTimeoutMs: options.snapshotTimeoutMs,
    snapshotMarketDataType: options.snapshotMarketDataType,
    includeIntradayBars: options.includeIntradayBars,
    intradayDurationStr: options.intradayDurationStr,
    intradayBarSizeSetting: options.intradayBarSizeSetting,
    includeAnalysis: options.includeAnalysis,
    includePositionContext: options.includePositionContext,
    positionsTimeoutMs: options.positionsTimeoutMs,
  };
}

function buildDailyRequest(
  symbol: string,
  options: StockStudyRequestOptions,
): StockHistoricalBarsRequestOptions {
  return {
    symbol,
    exchange: options.exchange,
    primaryExchange: options.primaryExchange,
    currency: options.currency,
    endDateTime: options.endDateTime,
    durationStr: options.durationStr?.trim() || "6 M",
    barSizeSetting: options.barSizeSetting?.trim() || "1 day",
    whatToShow: options.whatToShow?.trim() || "TRADES",
    useRTH: options.useRTH ?? true,
    timeoutMs: options.timeoutMs,
  };
}

function buildIntradayRequest(
  symbol: string,
  options: StockStudyRequestOptions,
): StockHistoricalBarsRequestOptions {
  return {
    symbol,
    exchange: options.exchange,
    primaryExchange: options.primaryExchange,
    currency: options.currency,
    endDateTime: options.endDateTime,
    durationStr: options.intradayDurationStr?.trim() || "1 D",
    barSizeSetting: options.intradayBarSizeSetting?.trim() || "15 mins",
    whatToShow: options.whatToShow?.trim() || "TRADES",
    useRTH: options.useRTH ?? true,
    timeoutMs: options.timeoutMs,
  };
}

function sortStudiesForRanking(studies: StockStudyResponse[]): StockStudyResponse[] {
  const rankedAnalyses = rankStockSetups(
    studies
      .map((study) => study.analysis)
      .filter((analysis): analysis is StockSetupAnalysis => analysis !== null),
  );
  const rankedOrder = new Map(
    rankedAnalyses.map((analysis, index) => [analysis.symbol, index]),
  );

  return [...studies].sort((left, right) => {
    const leftRank = rankedOrder.get(left.symbol) ?? Number.POSITIVE_INFINITY;
    const rightRank = rankedOrder.get(right.symbol) ?? Number.POSITIVE_INFINITY;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.symbol.localeCompare(right.symbol);
  });
}

function buildRankingEntries(
  studies: StockStudyResponse[],
  rankLimit?: number,
): StockStudyRankingEntry[] {
  const analyzedStudies = studies.filter(
    (study): study is StockStudyResponse & { analysis: StockSetupAnalysis } =>
      study.analysis !== null,
  );
  const finalLimit =
    rankLimit && rankLimit > 0
      ? Math.min(rankLimit, analyzedStudies.length)
      : analyzedStudies.length;

  return analyzedStudies.slice(0, finalLimit).map((study, index) => ({
    rank: index + 1,
    symbol: study.symbol,
    score: study.analysis.score.total,
    rating: study.analysis.score.rating,
    bias: study.analysis.score.bias,
    eligibleForNewEntries: study.analysis.riskPlan.eligibleForNewEntries,
    sizeTier: study.analysis.riskPlan.sizeTier,
  }));
}

function toBatchItem(study: StockStudyResponse): StockStudyBatchItem {
  return {
    symbol: study.symbol,
    dailyBarCount: study.dailyBars?.bars.length ?? null,
    intradayBarCount: study.intradayBars?.bars.length ?? null,
    snapshot: study.snapshot,
    positionContext: study.positionContext,
    analysis: study.analysis,
    warnings: [...study.warnings],
  };
}

async function attempt<T>(work: () => Promise<T>): Promise<AttemptResult<T>> {
  try {
    return {
      ok: true,
      value: await work(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function unwrapAttempt<T>(
  attemptResult: AttemptResult<T> | null,
  warnings: string[],
  warningPrefix: string,
): T | null {
  if (attemptResult === null) {
    return null;
  }

  if (attemptResult.ok) {
    return attemptResult.value;
  }

  warnings.push(`${warningPrefix}:${attemptResult.error.message}`);
  return null;
}

function buildPositionContext(
  symbol: string,
  rows: PositionRow[] | null,
): StockPositionContext | null {
  if (rows === null) {
    return null;
  }

  const stockRows = rows.filter(
    (row) =>
      row.contract.secType.toUpperCase() === "STK" &&
      row.contract.symbol.trim().toUpperCase() === symbol,
  );
  const accounts = Array.from(new Set(stockRows.map((row) => row.account)));
  const numericPositions = stockRows
    .map((row) => parseDecimalValue(row.position))
    .filter((value): value is number => value !== null);
  const totalPosition =
    numericPositions.length > 0
      ? numericPositions.reduce((sum, value) => sum + value, 0)
      : null;
  const weightedAverageCost =
    totalPosition !== null && totalPosition !== 0
      ? calculateWeightedAverageCost(stockRows)
      : null;

  return {
    held: stockRows.length > 0 && totalPosition !== null && totalPosition !== 0,
    accounts,
    totalPosition,
    weightedAverageCost,
    rows: stockRows,
  };
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol.length > 0),
    ),
  );
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, concurrency) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function parseDecimalValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateWeightedAverageCost(rows: PositionRow[]): number | null {
  let totalQuantity = 0;
  let totalCost = 0;

  for (const row of rows) {
    const quantity = parseDecimalValue(row.position);
    if (quantity === null || row.averageCost === null) {
      continue;
    }

    totalQuantity += quantity;
    totalCost += quantity * row.averageCost;
  }

  if (totalQuantity === 0) {
    return null;
  }

  return Math.round((totalCost / totalQuantity) * 100) / 100;
}
