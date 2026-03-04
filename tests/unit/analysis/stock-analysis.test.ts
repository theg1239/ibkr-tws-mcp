import { describe, expect, test } from "bun:test";
import {
  analyzeStockSetup,
  rankStockSetups,
} from "../../../src/analysis/stock-analysis.ts";
import type { MarketSnapshot, StockHistoricalBar } from "../../../src/tws/types.ts";

describe("stock-analysis", () => {
  test("scores a strong trend stock as a constructive long candidate", () => {
    const dailyBars = buildBars({
      count: 90,
      startClose: 100,
      closeStep: 0.8,
      volumeStart: 2_000_000,
      volumeStep: 25_000,
    });
    const intradayBars = buildBars({
      count: 12,
      startClose: 168,
      closeStep: 0.35,
      volumeStart: 150_000,
      volumeStep: 5_000,
    });
    const snapshot = buildSnapshot({
      last: 172.4,
      bid: 172.35,
      ask: 172.45,
      volume: 4_800_000,
    });

    const analysis = analyzeStockSetup({
      symbol: "AAPL",
      dailyBars,
      intradayBars,
      snapshot,
    });

    expect(analysis.score.total).toBeGreaterThanOrEqual(70);
    expect(["A", "B"]).toContain(analysis.score.rating);
    expect(["long_breakout_watch", "trend_pullback_watch"]).toContain(
      analysis.score.bias,
    );
    expect(analysis.riskFlags).not.toContain("low_liquidity");
    expect(analysis.riskPlan.eligibleForNewEntries).toBe(true);
    expect(["normal", "reduced"]).toContain(analysis.riskPlan.sizeTier);
    expect(analysis.riskPlan.maxPortfolioRiskPercent).toBeGreaterThan(0);
    expect(analysis.riskPlan.stopReference).not.toBeNull();
  });

  test("penalizes weak, illiquid setups and ranks stronger setups first", () => {
    const strong = analyzeStockSetup({
      symbol: "MSFT",
      dailyBars: buildBars({
        count: 70,
        startClose: 200,
        closeStep: 0.9,
        volumeStart: 3_000_000,
        volumeStep: 10_000,
      }),
      snapshot: buildSnapshot({
        last: 263,
        bid: 262.98,
        ask: 263.02,
        volume: 5_000_000,
      }),
    });
    const weak = analyzeStockSetup({
      symbol: "XYZ",
      dailyBars: buildBars({
        count: 70,
        startClose: 20,
        closeStep: -0.08,
        volumeStart: 80_000,
        volumeStep: 0,
      }),
      snapshot: buildSnapshot({
        last: 14.4,
        bid: 14.2,
        ask: 14.6,
        volume: 20_000,
      }),
    });

    expect(weak.score.total).toBeLessThan(strong.score.total);
    expect(weak.riskFlags).toContain("low_liquidity");
    expect(weak.riskFlags).toContain("wide_spread");
    expect(weak.riskPlan.avoidNewEntries).toBe(true);
    expect(weak.riskPlan.sizeTier).toBe("none");
    expect(weak.riskPlan.reasons).toContain("liquidity_below_minimum");
    expect(weak.riskPlan.reasons).toContain("spread_above_limit");
    expect(rankStockSetups([weak, strong]).map((item) => item.symbol)).toEqual([
      "MSFT",
      "XYZ",
    ]);
  });

  test("uses delayed tick fields for spread and volume when live fields are missing", () => {
    const analysis = analyzeStockSetup({
      symbol: "AMD",
      dailyBars: buildBars({
        count: 70,
        startClose: 120,
        closeStep: 0.5,
        volumeStart: 1_000_000,
        volumeStep: 10_000,
      }),
      snapshot: {
        reqId: 1,
        contract: {
          symbol: "AMD",
          secType: "STK",
          exchange: "SMART",
          primaryExchange: "NASDAQ",
          currency: "USD",
        },
        fields: {
          delayedLast: 154.2,
          tick_66: 154.1,
          tick_67: 154.3,
          tick_74: 3_200_000,
          tick_75: 153.0,
          marketDataType: 3,
        },
        rawTicks: {},
        warnings: [],
        completed: true,
        timedOut: false,
      },
    });

    expect(analysis.quote.bid).toBe(154.1);
    expect(analysis.quote.ask).toBe(154.3);
    expect(analysis.quote.spreadBps).not.toBeNull();
    expect(analysis.quote.snapshotVolume).toBe(3_200_000);
    expect(analysis.quote.relativeVolume).toBeGreaterThan(1);
  });
});

function buildBars(input: {
  count: number;
  startClose: number;
  closeStep: number;
  volumeStart: number;
  volumeStep: number;
}): StockHistoricalBar[] {
  const bars: StockHistoricalBar[] = [];

  for (let index = 0; index < input.count; index += 1) {
    const close = input.startClose + input.closeStep * index;
    const open = close - input.closeStep * 0.4;
    const high = close + Math.max(Math.abs(input.closeStep), 0.5);
    const low = open - 0.6;
    const volume = Math.max(1, Math.round(input.volumeStart + input.volumeStep * index));

    bars.push({
      time: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: String(volume),
      wap: String(round((high + low + close) / 3)),
      barCount: 10,
    });
  }

  return bars;
}

function buildSnapshot(input: {
  last: number;
  bid: number;
  ask: number;
  volume: number;
}): MarketSnapshot {
  return {
    reqId: 1,
    contract: {
      symbol: "AAPL",
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
