import type { MarketSnapshot, StockHistoricalBar } from "../tws/types.ts";

export type StockSetupRating = "A" | "B" | "C" | "D";
export type StockSetupBias =
  | "long_breakout_watch"
  | "trend_pullback_watch"
  | "neutral_wait"
  | "avoid";

export type StockAnalysisInput = {
  symbol: string;
  dailyBars: StockHistoricalBar[];
  intradayBars?: StockHistoricalBar[];
  snapshot?: MarketSnapshot | null;
  warnings?: string[];
};

export type StockAnalysisQuote = {
  currentPrice: number | null;
  priorClose: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadBps: number | null;
  snapshotVolume: number | null;
  relativeVolume: number | null;
};

export type StockAnalysisTrend = {
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  return1DPercent: number | null;
  return5DPercent: number | null;
  return20DPercent: number | null;
  return60DPercent: number | null;
  intradayReturnPercent: number | null;
  atr14: number | null;
  atr14Percent: number | null;
};

export type StockAnalysisLevels = {
  high20D: number | null;
  low20D: number | null;
  rangePosition20D: number | null;
  breakoutDistancePercent: number | null;
  pullbackReference: number | null;
  riskStopReference: number | null;
};

export type StockAnalysisDataQuality = {
  dailyBarsUsed: number;
  intradayBarsUsed: number;
  snapshotAvailable: boolean;
  warnings: string[];
};

export type StockAnalysisScore = {
  total: number;
  rating: StockSetupRating;
  bias: StockSetupBias;
};

export type StockAnalysisThresholds = {
  maxSpreadBps: number;
  minAverageDailyVolume20: number;
  maxAtr14Percent: number;
  maxBreakoutExtensionPercent: number;
  minScoreForNewEntries: number;
};

export type StockRiskSizeTier = "normal" | "reduced" | "small" | "none";

export type StockRiskPlan = {
  eligibleForNewEntries: boolean;
  avoidNewEntries: boolean;
  sizeTier: StockRiskSizeTier;
  maxPortfolioRiskPercent: number;
  entryReference: number | null;
  stopReference: number | null;
  stopDistancePercent: number | null;
  targetReference: number | null;
  thresholds: StockAnalysisThresholds;
  reasons: string[];
};

export type StockSetupAnalysis = {
  symbol: string;
  generatedAt: string;
  quote: StockAnalysisQuote;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
  score: StockAnalysisScore;
  riskPlan: StockRiskPlan;
  riskFlags: string[];
  notes: string[];
  dataQuality: StockAnalysisDataQuality;
};

type NormalizedBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type QuoteContext = StockAnalysisQuote & {
  averageDailyVolume20: number | null;
};

const RISK_PLAN_THRESHOLDS: StockAnalysisThresholds = {
  maxSpreadBps: 25,
  minAverageDailyVolume20: 250_000,
  maxAtr14Percent: 8,
  maxBreakoutExtensionPercent: 3,
  minScoreForNewEntries: 60,
};

export function analyzeStockSetup(input: StockAnalysisInput): StockSetupAnalysis {
  const normalizedDailyBars = normalizeBars(input.dailyBars);
  if (normalizedDailyBars.length < 20) {
    throw new Error("At least 20 valid daily bars are required to analyze a stock setup.");
  }

  const normalizedIntradayBars = normalizeBars(input.intradayBars ?? []);
  const currentPrice = resolveCurrentPrice(input.snapshot, normalizedDailyBars);
  const priorClose = resolvePriorClose(normalizedDailyBars);
  const averageDailyVolume20 = average(
    takeLast(normalizedDailyBars, 20)
      .map((bar) => bar.volume)
      .filter((value): value is number => value !== null),
  );
  const quote = buildQuoteContext({
    currentPrice,
    priorClose,
    snapshot: input.snapshot,
    averageDailyVolume20,
  });
  const trend = buildTrendMetrics({
    currentPrice,
    dailyBars: normalizedDailyBars,
    intradayBars: normalizedIntradayBars,
  });
  const levels = buildLevelMetrics({
    currentPrice,
    dailyBars: normalizedDailyBars,
    sma20: trend.sma20,
    atr14: trend.atr14,
  });

  const warningFlags = [...(input.warnings ?? [])];
  const riskFlags = buildRiskFlags({
    quote,
    trend,
    levels,
    dailyBarCount: normalizedDailyBars.length,
    warningFlags,
  });
  const score = buildScore({
    quote,
    trend,
    levels,
    riskFlags,
  });
  const riskPlan = buildRiskPlan({
    quote,
    trend,
    levels,
    score,
  });
  const notes = buildNotes({
    symbol: input.symbol,
    quote,
    trend,
    levels,
    score,
    riskPlan,
    riskFlags,
  });

  return {
    symbol: input.symbol.trim().toUpperCase(),
    generatedAt: new Date().toISOString(),
    quote: {
      currentPrice: quote.currentPrice,
      priorClose: quote.priorClose,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      spreadBps: quote.spreadBps,
      snapshotVolume: quote.snapshotVolume,
      relativeVolume: quote.relativeVolume,
    },
    trend,
    levels,
    score,
    riskPlan,
    riskFlags,
    notes,
    dataQuality: {
      dailyBarsUsed: normalizedDailyBars.length,
      intradayBarsUsed: normalizedIntradayBars.length,
      snapshotAvailable: input.snapshot !== null && input.snapshot !== undefined,
      warnings: warningFlags,
    },
  };
}

export function rankStockSetups(analyses: StockSetupAnalysis[]): StockSetupAnalysis[] {
  return [...analyses].sort((left, right) => {
    if (right.score.total !== left.score.total) {
      return right.score.total - left.score.total;
    }

    const leftReturn = left.trend.return20DPercent ?? Number.NEGATIVE_INFINITY;
    const rightReturn = right.trend.return20DPercent ?? Number.NEGATIVE_INFINITY;
    if (rightReturn !== leftReturn) {
      return rightReturn - leftReturn;
    }

    const leftSpread = left.quote.spreadBps ?? Number.POSITIVE_INFINITY;
    const rightSpread = right.quote.spreadBps ?? Number.POSITIVE_INFINITY;
    return leftSpread - rightSpread;
  });
}

function normalizeBars(bars: StockHistoricalBar[]): NormalizedBar[] {
  return bars
    .map((bar) => {
      if (
        bar.open === null ||
        bar.high === null ||
        bar.low === null ||
        bar.close === null
      ) {
        return null;
      }

      return {
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: toNumber(bar.volume),
      };
    })
    .filter((bar): bar is NormalizedBar => bar !== null);
}

function resolveCurrentPrice(
  snapshot: MarketSnapshot | null | undefined,
  dailyBars: NormalizedBar[],
): number | null {
  const snapshotPrice =
    readSnapshotNumberAny(snapshot, ["last", "delayedLast", "tick_68"]) ??
    readSnapshotNumberAny(snapshot, ["close", "tick_75"]) ??
    midpoint(
      readSnapshotNumberAny(snapshot, ["bid", "tick_66"]),
      readSnapshotNumberAny(snapshot, ["ask", "tick_67"]),
    );

  if (snapshotPrice !== null) {
    return snapshotPrice;
  }

  return dailyBars.at(-1)?.close ?? null;
}

function resolvePriorClose(dailyBars: NormalizedBar[]): number | null {
  if (dailyBars.length >= 2) {
    return dailyBars.at(-2)?.close ?? null;
  }

  return dailyBars.at(-1)?.close ?? null;
}

function buildQuoteContext(input: {
  currentPrice: number | null;
  priorClose: number | null;
  snapshot: MarketSnapshot | null | undefined;
  averageDailyVolume20: number | null;
}): QuoteContext {
  const bid = readSnapshotNumberAny(input.snapshot, ["bid", "tick_66"]);
  const ask = readSnapshotNumberAny(input.snapshot, ["ask", "tick_67"]);
  const mid = midpoint(bid, ask);
  const spreadBps =
    bid !== null && ask !== null && mid !== null && mid > 0
      ? roundNumber(((ask - bid) / mid) * 10_000, 2)
      : null;
  const snapshotVolume = readSnapshotNumberAny(input.snapshot, ["volume", "tick_74"]);
  const relativeVolume =
    snapshotVolume !== null &&
    input.averageDailyVolume20 !== null &&
    input.averageDailyVolume20 > 0
      ? roundNumber(snapshotVolume / input.averageDailyVolume20, 2)
      : null;

  return {
    currentPrice: input.currentPrice,
    priorClose: input.priorClose,
    bid,
    ask,
    mid,
    spreadBps,
    snapshotVolume,
    relativeVolume,
    averageDailyVolume20: input.averageDailyVolume20,
  };
}

function buildTrendMetrics(input: {
  currentPrice: number | null;
  dailyBars: NormalizedBar[];
  intradayBars: NormalizedBar[];
}): StockAnalysisTrend {
  const closes = input.dailyBars.map((bar) => bar.close);
  const latestClose = closes.at(-1) ?? null;
  const comparisonPrice = input.currentPrice ?? latestClose;
  const intradayCloses = input.intradayBars.map((bar) => bar.close);
  const intradayStart = intradayCloses.at(0) ?? null;
  const intradayEnd = intradayCloses.at(-1) ?? null;
  const atr14 = calculateAtr(input.dailyBars, 14);

  return {
    sma20: movingAverage(closes, 20),
    sma50: movingAverage(closes, 50),
    sma100: movingAverage(closes, 100),
    return1DPercent: percentageChange(comparisonPrice, closes.at(-2) ?? null),
    return5DPercent: percentageChange(comparisonPrice, offsetClose(closes, 5)),
    return20DPercent: percentageChange(comparisonPrice, offsetClose(closes, 20)),
    return60DPercent: percentageChange(comparisonPrice, offsetClose(closes, 60)),
    intradayReturnPercent: percentageChange(intradayEnd, intradayStart),
    atr14,
    atr14Percent:
      atr14 !== null && comparisonPrice !== null && comparisonPrice > 0
        ? roundNumber((atr14 / comparisonPrice) * 100, 2)
        : null,
  };
}

function buildLevelMetrics(input: {
  currentPrice: number | null;
  dailyBars: NormalizedBar[];
  sma20: number | null;
  atr14: number | null;
}): StockAnalysisLevels {
  const lastTwentyBars = takeLast(input.dailyBars, 20);
  const highs = lastTwentyBars.map((bar) => bar.high);
  const lows = lastTwentyBars.map((bar) => bar.low);
  const high20D = highs.length > 0 ? Math.max(...highs) : null;
  const low20D = lows.length > 0 ? Math.min(...lows) : null;
  const rangePosition20D =
    input.currentPrice !== null &&
    high20D !== null &&
    low20D !== null &&
    high20D > low20D
      ? roundNumber((input.currentPrice - low20D) / (high20D - low20D), 3)
      : null;
  const breakoutDistancePercent =
    input.currentPrice !== null && high20D !== null && high20D > 0
      ? roundNumber(((input.currentPrice / high20D) - 1) * 100, 2)
      : null;
  const pullbackReference = input.sma20 ?? low20D;
  const riskStopReference =
    pullbackReference !== null && input.atr14 !== null
      ? roundNumber(pullbackReference - input.atr14, 2)
      : pullbackReference;

  return {
    high20D,
    low20D,
    rangePosition20D,
    breakoutDistancePercent,
    pullbackReference,
    riskStopReference,
  };
}

function buildRiskFlags(input: {
  quote: QuoteContext;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
  dailyBarCount: number;
  warningFlags: string[];
}): string[] {
  const flags = new Set<string>(input.warningFlags);

  if (input.dailyBarCount < 60) {
    flags.add("limited_daily_history");
  }

  if (
    input.quote.currentPrice !== null &&
    input.trend.sma20 !== null &&
    input.quote.currentPrice < input.trend.sma20
  ) {
    flags.add("below_20d_sma");
  }

  if (
    input.quote.currentPrice !== null &&
    input.trend.sma50 !== null &&
    input.quote.currentPrice < input.trend.sma50
  ) {
    flags.add("below_50d_sma");
  }

  if ((input.trend.return20DPercent ?? 0) <= 0) {
    flags.add("negative_20d_momentum");
  }

  if (
    input.quote.spreadBps !== null &&
    input.quote.spreadBps > RISK_PLAN_THRESHOLDS.maxSpreadBps
  ) {
    flags.add("wide_spread");
  }

  if (
    input.quote.averageDailyVolume20 !== null &&
    input.quote.averageDailyVolume20 < RISK_PLAN_THRESHOLDS.minAverageDailyVolume20
  ) {
    flags.add("low_liquidity");
  }

  if (
    input.trend.atr14Percent !== null &&
    input.trend.atr14Percent > RISK_PLAN_THRESHOLDS.maxAtr14Percent
  ) {
    flags.add("high_volatility");
  }

  if (
    input.levels.breakoutDistancePercent !== null &&
    input.levels.breakoutDistancePercent > RISK_PLAN_THRESHOLDS.maxBreakoutExtensionPercent
  ) {
    flags.add("extended_above_20d_high");
  }

  return [...flags];
}

function buildScore(input: {
  quote: QuoteContext;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
  riskFlags: string[];
}): StockAnalysisScore {
  let total = 50;
  const currentPrice = input.quote.currentPrice;
  const trendAligned =
    currentPrice !== null &&
    input.trend.sma20 !== null &&
    input.trend.sma50 !== null &&
    currentPrice > input.trend.sma20 &&
    input.trend.sma20 > input.trend.sma50;

  total += trendAligned ? 15 : -12;

  if (
    currentPrice !== null &&
    input.trend.sma20 !== null
  ) {
    total += currentPrice > input.trend.sma20 ? 8 : -8;
  }

  if (
    currentPrice !== null &&
    input.trend.sma50 !== null
  ) {
    total += currentPrice > input.trend.sma50 ? 8 : -12;
  }

  total += scoreFromReturn(input.trend.return20DPercent, 12, -12, 2);
  total += scoreFromReturn(input.trend.return5DPercent, 6, -6, 1);
  total += scoreFromReturn(input.trend.return60DPercent, 8, -6, 4);
  total += scoreFromReturn(input.trend.intradayReturnPercent, 4, -4, 0.5);

  if (input.levels.rangePosition20D !== null) {
    if (input.levels.rangePosition20D >= 0.75) {
      total += 6;
    } else if (input.levels.rangePosition20D <= 0.35) {
      total -= 6;
    }
  }

  if (input.quote.averageDailyVolume20 !== null) {
    if (input.quote.averageDailyVolume20 >= 5_000_000) {
      total += 8;
    } else if (input.quote.averageDailyVolume20 >= 1_000_000) {
      total += 5;
    } else if (input.quote.averageDailyVolume20 < 250_000) {
      total -= 8;
    }
  }

  if (input.quote.relativeVolume !== null) {
    if (input.quote.relativeVolume >= 1.25) {
      total += 6;
    } else if (input.quote.relativeVolume < 0.5) {
      total -= 5;
    }
  }

  if (input.quote.spreadBps !== null) {
    if (input.quote.spreadBps <= 8) {
      total += 5;
    } else if (input.quote.spreadBps > 80) {
      total -= 12;
    } else if (input.quote.spreadBps > 25) {
      total -= 8;
    }
  }

  if (input.trend.atr14Percent !== null) {
    if (input.trend.atr14Percent <= 4) {
      total += 4;
    } else if (input.trend.atr14Percent > 8) {
      total -= 8;
    }
  }

  total -= input.riskFlags.includes("limited_daily_history") ? 4 : 0;
  total = clamp(Math.round(total), 0, 100);

  return {
    total,
    rating: toRating(total),
    bias: toBias(total, trendAligned, input.quote.currentPrice, input.trend.sma20),
  };
}

function buildRiskPlan(input: {
  quote: QuoteContext;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
  score: StockAnalysisScore;
}): StockRiskPlan {
  const reasons: string[] = [];
  const currentPrice = input.quote.currentPrice;

  if (currentPrice === null) {
    reasons.push("no_current_price");
  }

  if (
    input.quote.spreadBps !== null &&
    input.quote.spreadBps > RISK_PLAN_THRESHOLDS.maxSpreadBps
  ) {
    reasons.push("spread_above_limit");
  }

  if (
    input.quote.averageDailyVolume20 !== null &&
    input.quote.averageDailyVolume20 < RISK_PLAN_THRESHOLDS.minAverageDailyVolume20
  ) {
    reasons.push("liquidity_below_minimum");
  }

  if (
    input.trend.atr14Percent !== null &&
    input.trend.atr14Percent > RISK_PLAN_THRESHOLDS.maxAtr14Percent
  ) {
    reasons.push("volatility_above_limit");
  }

  if (
    input.levels.breakoutDistancePercent !== null &&
    input.levels.breakoutDistancePercent > RISK_PLAN_THRESHOLDS.maxBreakoutExtensionPercent
  ) {
    reasons.push("too_extended_from_breakout");
  }

  if (input.score.total < RISK_PLAN_THRESHOLDS.minScoreForNewEntries) {
    reasons.push("setup_score_below_minimum");
  }

  if (input.score.bias === "avoid") {
    reasons.push("analysis_bias_is_avoid");
  }

  if (
    currentPrice !== null &&
    input.trend.sma20 !== null &&
    currentPrice < input.trend.sma20
  ) {
    reasons.push("below_20d_sma_for_entry");
  }

  const stopReference = input.levels.riskStopReference;
  const stopDistancePercent =
    currentPrice !== null &&
    stopReference !== null &&
    currentPrice > 0
      ? roundNumber(((currentPrice - stopReference) / currentPrice) * 100, 2)
      : null;

  if (stopDistancePercent !== null && stopDistancePercent > 10) {
    reasons.push("stop_distance_too_wide");
  }

  const eligibleForNewEntries = reasons.length === 0;
  const sizeTier = determineRiskSizeTier({
    eligibleForNewEntries,
    score: input.score,
    reasons,
  });

  return {
    eligibleForNewEntries,
    avoidNewEntries: !eligibleForNewEntries,
    sizeTier,
    maxPortfolioRiskPercent: riskPercentForSizeTier(sizeTier),
    entryReference: resolveEntryReference(input),
    stopReference,
    stopDistancePercent,
    targetReference: resolveTargetReference(input),
    thresholds: RISK_PLAN_THRESHOLDS,
    reasons,
  };
}

function buildNotes(input: {
  symbol: string;
  quote: QuoteContext;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
  score: StockAnalysisScore;
  riskPlan: StockRiskPlan;
  riskFlags: string[];
}): string[] {
  const notes: string[] = [];
  const priceText =
    input.quote.currentPrice !== null
      ? `${roundNumber(input.quote.currentPrice, 2)}`
      : "unavailable";
  const momentumText =
    input.trend.return20DPercent !== null
      ? `${roundNumber(input.trend.return20DPercent, 2)}% over 20D`
      : "momentum unavailable";

  notes.push(
    `${input.symbol.toUpperCase()} scores ${input.score.total}/100 (${input.score.rating}) with ${momentumText}. Current price: ${priceText}.`,
  );

  if (
    input.quote.currentPrice !== null &&
    input.trend.sma20 !== null &&
    input.trend.sma50 !== null
  ) {
    notes.push(
      `20D/50D structure: ${roundNumber(input.trend.sma20, 2)} / ${roundNumber(input.trend.sma50, 2)}.`,
    );
  }

  if (input.levels.high20D !== null && input.levels.breakoutDistancePercent !== null) {
    notes.push(
      `20D range high is ${roundNumber(input.levels.high20D, 2)} and price is ${roundNumber(input.levels.breakoutDistancePercent, 2)}% from that breakout level.`,
    );
  }

  if (input.quote.spreadBps !== null) {
    notes.push(`Spread is ${roundNumber(input.quote.spreadBps, 2)} bps.`);
  } else {
    notes.push("Spread data is unavailable from the latest snapshot.");
  }

  if (input.quote.relativeVolume !== null) {
    notes.push(`Relative volume is ${roundNumber(input.quote.relativeVolume, 2)}x the 20D average.`);
  }

  if (input.riskFlags.length > 0) {
    notes.push(`Primary risk flags: ${input.riskFlags.join(", ")}.`);
  }

  if (input.riskPlan.eligibleForNewEntries) {
    notes.push(
      `Risk plan allows new entries with ${input.riskPlan.sizeTier} size and a max portfolio risk of ${input.riskPlan.maxPortfolioRiskPercent}%.`,
    );
  } else {
    notes.push(
      `Risk plan blocks new entries until these improve: ${input.riskPlan.reasons.join(", ")}.`,
    );
  }

  if (
    input.riskPlan.entryReference !== null ||
    input.riskPlan.stopReference !== null
  ) {
    const entryText =
      input.riskPlan.entryReference !== null
        ? `${roundNumber(input.riskPlan.entryReference, 2)}`
        : "unavailable";
    const stopText =
      input.riskPlan.stopReference !== null
        ? `${roundNumber(input.riskPlan.stopReference, 2)}`
        : "unavailable";
    const stopDistanceText =
      input.riskPlan.stopDistancePercent !== null
        ? `${roundNumber(input.riskPlan.stopDistancePercent, 2)}%`
        : "unavailable";

    notes.push(
      `Entry reference: ${entryText}. Stop reference: ${stopText}. Estimated stop distance: ${stopDistanceText}.`,
    );
  }

  return notes;
}

function determineRiskSizeTier(input: {
  eligibleForNewEntries: boolean;
  score: StockAnalysisScore;
  reasons: string[];
}): StockRiskSizeTier {
  if (input.eligibleForNewEntries) {
    return "normal";
  }

  const moderateReasons = new Set([
    "spread_above_limit",
    "too_extended_from_breakout",
    "setup_score_below_minimum",
  ]);
  const onlyModerateReasons = input.reasons.every((reason) => moderateReasons.has(reason));

  if (input.score.total >= 65 && input.reasons.length <= 2 && onlyModerateReasons) {
    return "reduced";
  }

  if (
    input.score.total >= 50 &&
    input.reasons.length <= 3 &&
    !input.reasons.includes("analysis_bias_is_avoid")
  ) {
    return "small";
  }

  return "none";
}

function riskPercentForSizeTier(sizeTier: StockRiskSizeTier): number {
  if (sizeTier === "normal") {
    return 0.75;
  }

  if (sizeTier === "reduced") {
    return 0.5;
  }

  if (sizeTier === "small") {
    return 0.25;
  }

  return 0;
}

function resolveEntryReference(input: {
  quote: QuoteContext;
  levels: StockAnalysisLevels;
  score: StockAnalysisScore;
}): number | null {
  if (input.score.bias === "long_breakout_watch") {
    return input.levels.high20D ?? input.quote.currentPrice;
  }

  if (input.score.bias === "trend_pullback_watch") {
    return input.levels.pullbackReference ?? input.quote.currentPrice;
  }

  return input.quote.currentPrice;
}

function resolveTargetReference(input: {
  quote: QuoteContext;
  trend: StockAnalysisTrend;
  levels: StockAnalysisLevels;
}): number | null {
  if (
    input.quote.currentPrice !== null &&
    input.trend.atr14 !== null
  ) {
    return roundNumber(input.quote.currentPrice + input.trend.atr14 * 2, 2);
  }

  return input.levels.high20D;
}

function movingAverage(values: number[], period: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const slice = takeLast(values, period);
  return roundNumber(average(slice), 2);
}

function calculateAtr(bars: NormalizedBar[], period: number): number | null {
  if (bars.length < 2) {
    return null;
  }

  const recentBars = takeLast(bars, period + 1);
  const trueRanges: number[] = [];

  for (let index = 1; index < recentBars.length; index += 1) {
    const currentBar = recentBars[index]!;
    const previousBar = recentBars[index - 1]!;
    const range = Math.max(
      currentBar.high - currentBar.low,
      Math.abs(currentBar.high - previousBar.close),
      Math.abs(currentBar.low - previousBar.close),
    );
    trueRanges.push(range);
  }

  return trueRanges.length > 0 ? roundNumber(average(trueRanges), 2) : null;
}

function scoreFromReturn(
  value: number | null,
  positiveCap: number,
  negativeCap: number,
  divisor: number,
): number {
  if (value === null) {
    return 0;
  }

  if (value >= 0) {
    return Math.min(positiveCap, Math.round(value / divisor));
  }

  return Math.max(negativeCap, Math.round(value / divisor));
}

function toRating(total: number): StockSetupRating {
  if (total >= 75) {
    return "A";
  }

  if (total >= 60) {
    return "B";
  }

  if (total >= 45) {
    return "C";
  }

  return "D";
}

function toBias(
  total: number,
  trendAligned: boolean,
  currentPrice: number | null,
  sma20: number | null,
): StockSetupBias {
  if (total >= 72 && trendAligned) {
    return "long_breakout_watch";
  }

  if (
    total >= 58 &&
    currentPrice !== null &&
    sma20 !== null &&
    currentPrice >= sma20
  ) {
    return "trend_pullback_watch";
  }

  if (total >= 45) {
    return "neutral_wait";
  }

  return "avoid";
}

function readSnapshotNumber(
  snapshot: MarketSnapshot | null | undefined,
  key: string,
): number | null {
  if (!snapshot) {
    return null;
  }

  const value = snapshot.fields[key] ?? snapshot.rawTicks[key];
  return toNumber(value);
}

function readSnapshotNumberAny(
  snapshot: MarketSnapshot | null | undefined,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = readSnapshotNumber(snapshot, key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((runningTotal, value) => runningTotal + value, 0);
  return sum / values.length;
}

function offsetClose(closes: number[], offsetDays: number): number | null {
  if (closes.length <= offsetDays) {
    return closes.at(0) ?? null;
  }

  return closes.at(-(offsetDays + 1)) ?? null;
}

function percentageChange(current: number | null, base: number | null): number | null {
  if (current === null || base === null || base === 0) {
    return null;
  }

  return roundNumber(((current / base) - 1) * 100, 2);
}

function midpoint(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null;
  }

  return roundNumber((left + right) / 2, 4);
}

function takeLast<T>(values: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }

  return values.slice(Math.max(0, values.length - count));
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}
