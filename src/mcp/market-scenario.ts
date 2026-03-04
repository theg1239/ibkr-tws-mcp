import type { TwsGatewayClient } from "../tws/client.ts";
import type {
  MarketDataType,
  MarketSnapshot,
  StockScannerRow,
  TickValue,
} from "../tws/types.ts";

const DEFAULT_SCANNER_ROWS = 8;
const DEFAULT_BENCHMARK_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"] as const;
const MAX_ENRICHED_ROWS = 25;
export const STOCK_SCANNER_PRESET_VALUES = [
  "intraday_momentum",
  "opening_gap_up",
  "opening_gap_down",
  "liquid_leaders",
  "liquid_losers",
] as const;

export type StockScannerPreset = (typeof STOCK_SCANNER_PRESET_VALUES)[number];

export type StockMarketScannerViewRequestOptions = {
  scanCode?: string;
  preset?: StockScannerPreset;
  locationCode?: string;
  numberOfRows?: number;
  marketDataType?: MarketDataType;
  includeSnapshots?: boolean;
  snapshotTimeoutMs?: number;
  abovePrice?: number;
  belowPrice?: number;
  aboveVolume?: number;
  marketCapAbove?: number;
  marketCapBelow?: number;
  stockTypeFilter?: string;
  timeoutMs?: number;
};

export type StockMarketScannerEntry = {
  rank: number;
  symbol: string;
  conid: number;
  exchange: string;
  marketName: string;
  tradingClass: string;
  distance: string;
  distancePercent: number | null;
  benchmark: string;
  projection: string;
  currentPrice: number | null;
  priorClose: number | null;
  changePercent: number | null;
  volume: number | null;
  spreadBps: number | null;
  marketDataType: MarketDataType | null;
  delayed: boolean;
  snapshot: MarketSnapshot | null;
  snapshotWarnings: string[];
  snapshotError: string | null;
};

export type StockMarketScannerViewResponse = {
  generatedAt: string;
  requested: {
    preset: StockScannerPreset | null;
    scanCode: string;
    locationCode: string;
    numberOfRows: number;
    marketDataType: MarketDataType | null;
    includeSnapshots: boolean;
    filters: {
      abovePrice: number | null;
      belowPrice: number | null;
      aboveVolume: number | null;
      marketCapAbove: number | null;
      marketCapBelow: number | null;
      stockTypeFilter: string | null;
    };
  };
  results: StockMarketScannerEntry[];
  warnings: string[];
};

export type StockBenchmarkSnapshot = {
  symbol: string;
  currentPrice: number | null;
  priorClose: number | null;
  changePercent: number | null;
  marketDataType: MarketDataType | null;
  delayed: boolean;
  snapshot: MarketSnapshot | null;
  snapshotWarnings: string[];
  snapshotError: string | null;
};

export type StockMarketScenarioRequestOptions = {
  locationCode?: string;
  rowsPerScan?: number;
  marketDataType?: MarketDataType;
  includeSnapshots?: boolean;
  snapshotTimeoutMs?: number;
  benchmarkSymbols?: string[];
  timeoutMs?: number;
};

export type StockMarketScenarioResponse = {
  generatedAt: string;
  requested: {
    locationCode: string;
    rowsPerScan: number;
    marketDataType: MarketDataType | null;
    includeSnapshots: boolean;
    benchmarkSymbols: string[];
  };
  benchmarks: StockBenchmarkSnapshot[];
  movers: {
    topGainers: StockMarketScannerEntry[];
    topLosers: StockMarketScannerEntry[];
    mostActive: StockMarketScannerEntry[];
  };
  summary: {
    benchmarkTrend: "risk_on" | "risk_off" | "mixed" | "unknown";
    topGainerSymbol: string | null;
    topLoserSymbol: string | null;
    mostActiveSymbol: string | null;
  };
  alerts: string[];
  warnings: string[];
};

export async function buildStockScannerView(
  gateway: TwsGatewayClient,
  options: StockMarketScannerViewRequestOptions,
): Promise<StockMarketScannerViewResponse> {
  const resolvedScanner = resolveScannerRequest(options);
  const requestedScanCode = resolvedScanner.scanCode;

  const locationCode = options.locationCode?.trim().toUpperCase() || "STK.US.MAJOR";
  const numberOfRows = normalizeRows(options.numberOfRows);
  const includeSnapshots = options.includeSnapshots ?? true;
  const requestedMarketDataType = options.marketDataType ?? null;

  const scan = await gateway.requestStockScanner({
    scanCode: requestedScanCode,
    locationCode,
    numberOfRows,
    abovePrice: resolvedScanner.abovePrice ?? undefined,
    belowPrice: resolvedScanner.belowPrice ?? undefined,
    aboveVolume: resolvedScanner.aboveVolume ?? undefined,
    marketCapAbove: resolvedScanner.marketCapAbove ?? undefined,
    marketCapBelow: resolvedScanner.marketCapBelow ?? undefined,
    stockTypeFilter: resolvedScanner.stockTypeFilter ?? undefined,
    timeoutMs: options.timeoutMs,
  });

  const results = includeSnapshots
    ? await enrichScannerRows(gateway, scan.rows, {
        marketDataType: requestedMarketDataType,
        snapshotTimeoutMs: options.snapshotTimeoutMs ?? options.timeoutMs,
      })
    : scan.rows.map((row) => createScannerEntryWithoutSnapshot(row));

  return {
    generatedAt: new Date().toISOString(),
    requested: {
      preset: resolvedScanner.preset,
      scanCode: requestedScanCode,
      locationCode,
      numberOfRows,
      marketDataType: requestedMarketDataType,
      includeSnapshots,
      filters: {
        abovePrice: resolvedScanner.abovePrice,
        belowPrice: resolvedScanner.belowPrice,
        aboveVolume: resolvedScanner.aboveVolume,
        marketCapAbove: resolvedScanner.marketCapAbove,
        marketCapBelow: resolvedScanner.marketCapBelow,
        stockTypeFilter: resolvedScanner.stockTypeFilter,
      },
    },
    results,
    warnings: [
      ...collectScannerWarnings(results),
      ...(resolvedScanner.warning ? [resolvedScanner.warning] : []),
    ],
  };
}

export async function buildStockMarketScenario(
  gateway: TwsGatewayClient,
  options: StockMarketScenarioRequestOptions = {},
): Promise<StockMarketScenarioResponse> {
  const rowsPerScan = normalizeRows(options.rowsPerScan);
  const locationCode = options.locationCode?.trim().toUpperCase() || "STK.US.MAJOR";
  const includeSnapshots = options.includeSnapshots ?? true;
  const requestedMarketDataType = options.marketDataType ?? null;
  const benchmarkSymbols = normalizeBenchmarkSymbols(options.benchmarkSymbols);

  const [topGainers, topLosers, mostActive, benchmarks] = await Promise.all([
    buildStockScannerView(gateway, {
      scanCode: "TOP_PERC_GAIN",
      locationCode,
      numberOfRows: rowsPerScan,
      marketDataType: requestedMarketDataType ?? undefined,
      includeSnapshots,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
      timeoutMs: options.timeoutMs,
    }),
    buildStockScannerView(gateway, {
      scanCode: "TOP_PERC_LOSE",
      locationCode,
      numberOfRows: rowsPerScan,
      marketDataType: requestedMarketDataType ?? undefined,
      includeSnapshots,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
      timeoutMs: options.timeoutMs,
    }),
    buildStockScannerView(gateway, {
      scanCode: "MOST_ACTIVE",
      locationCode,
      numberOfRows: rowsPerScan,
      marketDataType: requestedMarketDataType ?? undefined,
      includeSnapshots,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
      timeoutMs: options.timeoutMs,
    }),
    includeSnapshots
      ? buildBenchmarkSnapshots(gateway, benchmarkSymbols, {
          marketDataType: requestedMarketDataType,
          snapshotTimeoutMs: options.snapshotTimeoutMs ?? options.timeoutMs,
        })
      : Promise.resolve(benchmarkSymbols.map((symbol) => createEmptyBenchmarkSnapshot(symbol))),
  ]);

  const warnings = [
    ...topGainers.warnings,
    ...topLosers.warnings,
    ...mostActive.warnings,
    ...benchmarks.flatMap((item) => [
      ...(item.snapshotError ? [`benchmark_snapshot_error:${item.symbol}:${item.snapshotError}`] : []),
      ...item.snapshotWarnings.map(
        (warning) => `benchmark_snapshot_warning:${item.symbol}:${warning}`,
      ),
    ]),
  ];

  const alerts = [
    ...buildBenchmarkAlerts(benchmarks),
    ...buildMoverAlerts("top_gainer", topGainers.results[0]),
    ...buildMoverAlerts("top_loser", topLosers.results[0]),
    ...buildMoverAlerts("most_active", mostActive.results[0]),
  ];

  return {
    generatedAt: new Date().toISOString(),
    requested: {
      locationCode,
      rowsPerScan,
      marketDataType: requestedMarketDataType,
      includeSnapshots,
      benchmarkSymbols,
    },
    benchmarks,
    movers: {
      topGainers: topGainers.results,
      topLosers: topLosers.results,
      mostActive: mostActive.results,
    },
    summary: {
      benchmarkTrend: resolveBenchmarkTrend(benchmarks),
      topGainerSymbol: topGainers.results[0]?.symbol ?? null,
      topLoserSymbol: topLosers.results[0]?.symbol ?? null,
      mostActiveSymbol: mostActive.results[0]?.symbol ?? null,
    },
    alerts,
    warnings,
  };
}

type ResolvedScannerRequest = {
  preset: StockScannerPreset | null;
  scanCode: string;
  abovePrice: number | null;
  belowPrice: number | null;
  aboveVolume: number | null;
  marketCapAbove: number | null;
  marketCapBelow: number | null;
  stockTypeFilter: string | null;
  warning: string | null;
};

function resolveScannerRequest(
  options: StockMarketScannerViewRequestOptions,
): ResolvedScannerRequest {
  const preset = options.preset ?? null;
  const defaults = preset ? scannerPresetDefaults(preset) : null;
  const requestedScanCode = (options.scanCode ?? defaults?.scanCode ?? "")
    .trim()
    .toUpperCase();

  if (!requestedScanCode) {
    throw new Error('Provide either "scanCode" or "preset" for the stock scanner.');
  }

  return {
    preset,
    scanCode: requestedScanCode,
    abovePrice: options.abovePrice ?? defaults?.abovePrice ?? null,
    belowPrice: options.belowPrice ?? defaults?.belowPrice ?? null,
    aboveVolume: options.aboveVolume ?? defaults?.aboveVolume ?? null,
    marketCapAbove: options.marketCapAbove ?? defaults?.marketCapAbove ?? null,
    marketCapBelow: options.marketCapBelow ?? defaults?.marketCapBelow ?? null,
    stockTypeFilter: options.stockTypeFilter ?? defaults?.stockTypeFilter ?? null,
    warning: defaults?.warning ?? null,
  };
}

function scannerPresetDefaults(
  preset: StockScannerPreset,
): Omit<ResolvedScannerRequest, "preset"> {
  switch (preset) {
    case "intraday_momentum":
      return {
        scanCode: "TOP_PERC_GAIN",
        abovePrice: 5,
        belowPrice: null,
        aboveVolume: 500_000,
        marketCapAbove: null,
        marketCapBelow: null,
        stockTypeFilter: "CORP",
        warning: null,
      };
    case "opening_gap_up":
      return {
        scanCode: "TOP_OPEN_PERC_GAIN",
        abovePrice: 5,
        belowPrice: null,
        aboveVolume: 250_000,
        marketCapAbove: null,
        marketCapBelow: null,
        stockTypeFilter: "CORP",
        warning:
          "preset_note:opening_gap_up uses TOP_OPEN_PERC_GAIN, which is most useful after the regular-session open.",
      };
    case "opening_gap_down":
      return {
        scanCode: "TOP_OPEN_PERC_LOSE",
        abovePrice: 5,
        belowPrice: null,
        aboveVolume: 250_000,
        marketCapAbove: null,
        marketCapBelow: null,
        stockTypeFilter: "CORP",
        warning:
          "preset_note:opening_gap_down uses TOP_OPEN_PERC_LOSE, which is most useful after the regular-session open.",
      };
    case "liquid_leaders":
      return {
        scanCode: "HOT_BY_VOLUME",
        abovePrice: 10,
        belowPrice: null,
        aboveVolume: 1_000_000,
        marketCapAbove: 10_000_000_000,
        marketCapBelow: null,
        stockTypeFilter: "CORP",
        warning: null,
      };
    case "liquid_losers":
      return {
        scanCode: "TOP_PERC_LOSE",
        abovePrice: 10,
        belowPrice: null,
        aboveVolume: 1_000_000,
        marketCapAbove: 10_000_000_000,
        marketCapBelow: null,
        stockTypeFilter: "CORP",
        warning: null,
      };
  }
}

async function enrichScannerRows(
  gateway: TwsGatewayClient,
  rows: StockScannerRow[],
  options: {
    marketDataType: MarketDataType | null;
    snapshotTimeoutMs: number | undefined;
  },
): Promise<StockMarketScannerEntry[]> {
  return await mapWithConcurrency(rows, 4, async (row) => {
    const base = createScannerEntryWithoutSnapshot(row);

    try {
      const snapshot = await gateway.requestMarketDataSnapshot({
        symbol: row.symbol,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        marketDataType: options.marketDataType ?? undefined,
        timeoutMs: options.snapshotTimeoutMs,
      });
      const quote = readSnapshotQuote(snapshot);

      return {
        ...base,
        currentPrice: quote.currentPrice,
        priorClose: quote.priorClose,
        changePercent: quote.changePercent ?? base.distancePercent,
        volume: quote.volume,
        spreadBps: quote.spreadBps,
        marketDataType: quote.marketDataType,
        delayed: quote.marketDataType === 3 || quote.marketDataType === 4,
        snapshot,
        snapshotWarnings: snapshot.warnings,
        snapshotError: null,
      };
    } catch (error) {
      return {
        ...base,
        snapshotError: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function buildBenchmarkSnapshots(
  gateway: TwsGatewayClient,
  symbols: string[],
  options: {
    marketDataType: MarketDataType | null;
    snapshotTimeoutMs: number | undefined;
  },
): Promise<StockBenchmarkSnapshot[]> {
  return await mapWithConcurrency(symbols, 4, async (symbol) => {
    try {
      const snapshot = await gateway.requestMarketDataSnapshot({
        symbol,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        marketDataType: options.marketDataType ?? undefined,
        timeoutMs: options.snapshotTimeoutMs,
      });
      const quote = readSnapshotQuote(snapshot);

      return {
        symbol,
        currentPrice: quote.currentPrice,
        priorClose: quote.priorClose,
        changePercent: quote.changePercent,
        marketDataType: quote.marketDataType,
        delayed: quote.marketDataType === 3 || quote.marketDataType === 4,
        snapshot,
        snapshotWarnings: snapshot.warnings,
        snapshotError: null,
      };
    } catch (error) {
      return {
        symbol,
        currentPrice: null,
        priorClose: null,
        changePercent: null,
        marketDataType: null,
        delayed: false,
        snapshot: null,
        snapshotWarnings: [],
        snapshotError: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function createScannerEntryWithoutSnapshot(row: StockScannerRow): StockMarketScannerEntry {
  return {
    rank: row.rank,
    symbol: row.symbol,
    conid: row.conid,
    exchange: row.exchange,
    marketName: row.marketName,
    tradingClass: row.tradingClass,
    distance: row.distance,
    distancePercent: parsePercent(row.distance),
    benchmark: row.benchmark,
    projection: row.projection,
    currentPrice: null,
    priorClose: null,
    changePercent: parsePercent(row.distance),
    volume: null,
    spreadBps: null,
    marketDataType: null,
    delayed: false,
    snapshot: null,
    snapshotWarnings: [],
    snapshotError: null,
  };
}

function readSnapshotQuote(snapshot: MarketSnapshot): {
  currentPrice: number | null;
  priorClose: number | null;
  changePercent: number | null;
  volume: number | null;
  spreadBps: number | null;
  marketDataType: MarketDataType | null;
} {
  const currentPrice =
    readSnapshotNumber(snapshot, "last") ??
    readSnapshotNumber(snapshot, "delayedLast") ??
    midpoint(
      readSnapshotNumber(snapshot, "bid") ?? readSnapshotNumber(snapshot, "tick_66"),
      readSnapshotNumber(snapshot, "ask") ?? readSnapshotNumber(snapshot, "tick_67"),
    ) ??
    readSnapshotNumber(snapshot, "close") ??
    readSnapshotNumber(snapshot, "tick_75");
  const priorClose =
    readSnapshotNumber(snapshot, "close") ??
    readSnapshotNumber(snapshot, "tick_75");
  const volume =
    readSnapshotNumber(snapshot, "volume") ??
    readSnapshotNumber(snapshot, "tick_74");
  const bid =
    readSnapshotNumber(snapshot, "bid") ??
    readSnapshotNumber(snapshot, "tick_66");
  const ask =
    readSnapshotNumber(snapshot, "ask") ??
    readSnapshotNumber(snapshot, "tick_67");
  const mid = midpoint(bid, ask);
  const spreadBps =
    bid !== null && ask !== null && mid !== null && mid > 0
      ? roundNumber(((ask - bid) / mid) * 10_000, 2)
      : null;
  const changePercent =
    currentPrice !== null && priorClose !== null && priorClose !== 0
      ? roundNumber(((currentPrice - priorClose) / priorClose) * 100, 2)
      : null;
  const marketDataType = readMarketDataType(snapshot);

  return {
    currentPrice,
    priorClose,
    changePercent,
    volume,
    spreadBps,
    marketDataType,
  };
}

function readSnapshotNumber(snapshot: MarketSnapshot, key: string): number | null {
  const value = snapshot.fields[key] ?? snapshot.rawTicks[key] ?? null;
  return toFiniteNumber(value);
}

function readMarketDataType(snapshot: MarketSnapshot): MarketDataType | null {
  const directType = readSnapshotNumber(snapshot, "marketDataType");
  const rawType = readSnapshotNumber(snapshot, "tick_-58");
  const value = directType ?? rawType;

  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  return null;
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

function parsePercent(value: string): number | null {
  const normalized = value.replace(/[%+,]/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function midpoint(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null;
  }

  return roundNumber((left + right) / 2, 4);
}

function normalizeRows(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined) {
    return DEFAULT_SCANNER_ROWS;
  }

  return Math.max(1, Math.min(value, MAX_ENRICHED_ROWS));
}

function normalizeBenchmarkSymbols(symbols: string[] | undefined): string[] {
  const rawSymbols = symbols ?? [...DEFAULT_BENCHMARK_SYMBOLS];
  const result: string[] = [];

  for (const symbol of rawSymbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || result.includes(normalized)) {
      continue;
    }

    result.push(normalized);
  }

  return result;
}

function createEmptyBenchmarkSnapshot(symbol: string): StockBenchmarkSnapshot {
  return {
    symbol,
    currentPrice: null,
    priorClose: null,
    changePercent: null,
    marketDataType: null,
    delayed: false,
    snapshot: null,
    snapshotWarnings: [],
    snapshotError: null,
  };
}

function collectScannerWarnings(entries: StockMarketScannerEntry[]): string[] {
  return entries.flatMap((entry) => [
    ...(entry.snapshotError ? [`snapshot_error:${entry.symbol}:${entry.snapshotError}`] : []),
    ...entry.snapshotWarnings.map(
      (warning) => `snapshot_warning:${entry.symbol}:${warning}`,
    ),
  ]);
}

function resolveBenchmarkTrend(
  benchmarks: StockBenchmarkSnapshot[],
): "risk_on" | "risk_off" | "mixed" | "unknown" {
  const changes = benchmarks
    .map((item) => item.changePercent)
    .filter((value): value is number => value !== null);

  if (changes.length === 0) {
    return "unknown";
  }

  const positiveCount = changes.filter((value) => value > 0).length;
  const negativeCount = changes.filter((value) => value < 0).length;

  if (positiveCount > negativeCount) {
    return "risk_on";
  }

  if (negativeCount > positiveCount) {
    return "risk_off";
  }

  return "mixed";
}

function buildBenchmarkAlerts(benchmarks: StockBenchmarkSnapshot[]): string[] {
  return benchmarks.flatMap((item) => {
    if (item.changePercent === null) {
      return [];
    }

    if (item.changePercent >= 1) {
      return [`benchmark_strength:${item.symbol}:${formatNumber(item.changePercent)}%`];
    }

    if (item.changePercent <= -1) {
      return [`benchmark_weakness:${item.symbol}:${formatNumber(item.changePercent)}%`];
    }

    return [];
  });
}

function buildMoverAlerts(
  label: "top_gainer" | "top_loser" | "most_active",
  entry: StockMarketScannerEntry | undefined,
): string[] {
  if (!entry) {
    return [];
  }

  const metric =
    entry.changePercent ??
    entry.distancePercent;

  if (metric === null) {
    return [`${label}:${entry.symbol}`];
  }

  return [`${label}:${entry.symbol}:${formatNumber(metric)}%`];
}

async function mapWithConcurrency<TInput, TOutput>(
  items: ReadonlyArray<TInput>,
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: normalizedConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  });

  await Promise.all(workers);
  return results;
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
