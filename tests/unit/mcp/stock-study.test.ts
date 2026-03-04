import { describe, expect, test } from "bun:test";
import {
  buildStockStudies,
  buildStockStudy,
} from "../../../src/mcp/stock-study.ts";
import type {
  MarketSnapshot,
  PositionRow,
  StockHistoricalBarsRequestOptions,
  StockHistoricalBarsResponse,
} from "../../../src/tws/types.ts";

describe("stock-study", () => {
  test("builds a consolidated stock study with analysis from one request bundle", async () => {
    const calls: string[] = [];
    const gateway = {
      async requestStockHistoricalBars(options: StockHistoricalBarsRequestOptions) {
        calls.push(`bars:${options.barSizeSetting ?? "unknown"}`);
        return buildHistoricalBarsResponse(
          options.symbol,
          options.barSizeSetting === "15 mins" ? 10 : 80,
          options.barSizeSetting === "15 mins" ? 0.25 : 0.8,
        );
      },
      async requestMarketDataSnapshot(): Promise<MarketSnapshot> {
        calls.push("snapshot");
        return buildSnapshot({
          symbol: "AAPL",
          last: 165.2,
          bid: 165.18,
          ask: 165.22,
          volume: 4_200_000,
        });
      },
      async requestPositions(): Promise<{ rows: PositionRow[] }> {
        calls.push("positions");
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
              position: "25",
              averageCost: 150,
            },
          ],
        };
      },
      requestMarketDataType() {
        throw new Error("not used");
      },
    };

    const study = await buildStockStudy(gateway as never, {
      symbol: "AAPL",
    });

    expect(calls).toEqual(["bars:1 day", "bars:15 mins", "snapshot", "positions"]);
    expect(study.dailyBars).not.toBeNull();
    expect(study.intradayBars).not.toBeNull();
    expect(study.snapshot).not.toBeNull();
    expect(study.positionContext?.held).toBe(true);
    expect(study.positionContext?.totalPosition).toBe(25);
    expect(study.analysis).not.toBeNull();
    expect(study.analysis?.riskPlan.eligibleForNewEntries).toBe(true);
    expect(study.warnings).toEqual([]);
  });

  test("keeps partial results when optional components fail", async () => {
    const gateway = {
      async requestStockHistoricalBars(options: StockHistoricalBarsRequestOptions) {
        return buildHistoricalBarsResponse(options.symbol, 60, 0.4);
      },
      async requestMarketDataSnapshot() {
        throw new Error("No market data permissions");
      },
      async requestPositions() {
        throw new Error("Positions temporarily unavailable");
      },
    };

    const study = await buildStockStudy(gateway as never, {
      symbol: "MSFT",
      includeIntradayBars: false,
    });

    expect(study.dailyBars).not.toBeNull();
    expect(study.snapshot).toBeNull();
    expect(study.positionContext).toBeNull();
    expect(study.analysis).not.toBeNull();
    expect(study.warnings.some((warning) => warning.startsWith("snapshot_unavailable:"))).toBe(
      true,
    );
    expect(
      study.warnings.some((warning) => warning.startsWith("position_context_unavailable:")),
    ).toBe(true);
  });

  test("builds and ranks a watchlist while reusing one shared positions request", async () => {
    let positionCalls = 0;
    const gateway = {
      async requestStockHistoricalBars(options: StockHistoricalBarsRequestOptions) {
        const symbol = options.symbol.trim().toUpperCase();
        const step =
          symbol === "AAPL" ? 1.1 : symbol === "MSFT" ? 0.7 : -0.05;
        const count = options.barSizeSetting === "15 mins" ? 12 : 90;
        const intradayStep = symbol === "AAPL" ? 0.3 : 0.15;

        return buildHistoricalBarsResponse(
          symbol,
          count,
          options.barSizeSetting === "15 mins" ? intradayStep : step,
        );
      },
      async requestMarketDataSnapshot(input: { symbol: string }): Promise<MarketSnapshot> {
        const symbol = input.symbol.trim().toUpperCase();

        if (symbol === "AAPL") {
          return buildSnapshot({
            symbol,
            last: 198.2,
            bid: 198.18,
            ask: 198.22,
            volume: 6_400_000,
          });
        }

        return buildSnapshot({
          symbol,
          last: 163.1,
          bid: 163.08,
          ask: 163.12,
          volume: 4_100_000,
        });
      },
      async requestPositions(): Promise<{ rows: PositionRow[] }> {
        positionCalls += 1;
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
              averageCost: 172,
            },
          ],
        };
      },
    };

    const study = await buildStockStudies(gateway as never, {
      symbols: ["msft", "aapl", "msft"],
      includeIntradayBars: false,
      rankLimit: 2,
    });

    expect(positionCalls).toBe(1);
    expect(study.requestedSymbols).toEqual(["MSFT", "AAPL"]);
    expect(study.studies).toHaveLength(2);
    expect(study.ranking).toHaveLength(2);
    expect(study.ranking[0]?.symbol).toBe("AAPL");
    expect(study.ranking[0]?.eligibleForNewEntries).toBe(true);
    expect(study.studies[0]?.analysis?.riskPlan.sizeTier).toMatch(
      /^(normal|reduced|small|none)$/,
    );
    expect(study.failures).toEqual([]);
    expect(study.totals).toEqual({
      requested: 2,
      completed: 2,
      analyzed: 2,
      failed: 0,
    });
  });

  test("keeps successful watchlist studies and reports per-symbol failures", async () => {
    const gateway = {
      async requestStockHistoricalBars(options: StockHistoricalBarsRequestOptions) {
        if (options.symbol === "FAIL") {
          throw new Error("Historical data unavailable");
        }

        return buildHistoricalBarsResponse(options.symbol, 70, 0.6);
      },
      async requestMarketDataSnapshot(input: { symbol: string }): Promise<MarketSnapshot> {
        if (input.symbol === "FAIL") {
          throw new Error("Snapshot unavailable");
        }

        return buildSnapshot({
          symbol: input.symbol,
          last: 150.4,
          bid: 150.38,
          ask: 150.42,
          volume: 2_900_000,
        });
      },
      async requestPositions() {
        throw new Error("not used");
      },
    };

    const study = await buildStockStudies(gateway as never, {
      symbols: ["AAPL", "FAIL"],
      includeIntradayBars: false,
      includePositionContext: false,
    });

    expect(study.studies).toHaveLength(1);
    expect(study.studies[0]?.symbol).toBe("AAPL");
    expect(study.failures).toEqual([
      {
        symbol: "FAIL",
        error:
          "Unable to build stock study because historical bars, snapshot data, and position context all failed.",
      },
    ]);
    expect(
      study.warnings.some((warning) =>
        warning.startsWith("study_failed:FAIL:Unable to build stock study because"),
      ),
    ).toBe(true);
  });
});

function buildHistoricalBarsResponse(
  symbol: string,
  count: number,
  step: number,
): StockHistoricalBarsResponse {
  const bars = Array.from({ length: count }, (_, index) => {
    const close = 100 + step * index;
    return {
      time: `2026-02-${String((index % 28) + 1).padStart(2, "0")}`,
      open: round(close - step * 0.5),
      high: round(close + Math.max(Math.abs(step), 0.4)),
      low: round(close - Math.max(Math.abs(step), 0.7)),
      close: round(close),
      volume: String(2_000_000 + index * 10_000),
      wap: String(round(close - step * 0.1)),
      barCount: 12,
    };
  });

  return {
    reqId: 1,
    contract: {
      symbol,
      exchange: "SMART",
      primaryExchange: "NASDAQ",
      currency: "USD",
    },
    endDateTime: "",
    durationStr: count > 20 ? "6 M" : "1 D",
    barSizeSetting: count > 20 ? "1 day" : "15 mins",
    whatToShow: "TRADES",
    useRTH: true,
    bars,
    startDateTime: bars[0]?.time ?? null,
    endDateTimeReturned: bars.at(-1)?.time ?? null,
  };
}

function buildSnapshot(input: {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
}): MarketSnapshot {
  return {
    reqId: 1,
    contract: {
      symbol: input.symbol,
      secType: "STK",
      exchange: "SMART",
      primaryExchange: "NASDAQ",
      currency: "USD",
    },
    fields: {
      last: input.last,
      bid: input.bid,
      ask: input.ask,
      volume: input.volume,
    },
    rawTicks: {},
    warnings: [],
    completed: true,
    timedOut: false,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
