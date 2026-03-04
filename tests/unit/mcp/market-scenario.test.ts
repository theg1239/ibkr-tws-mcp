import { describe, expect, test } from "bun:test";
import {
  buildStockMarketScenario,
  buildStockScannerView,
} from "../../../src/mcp/market-scenario.ts";

describe("market-scenario", () => {
  test("builds an enriched stock scanner view", async () => {
    const calls: string[] = [];
    const gateway = {
      async requestStockScanner() {
        calls.push("requestStockScanner");
        return {
          reqId: 1,
          scanCode: "TOP_PERC_GAIN",
          instrument: "STK",
          locationCode: "STK.US.MAJOR",
          rows: [
            {
              rank: 0,
              conid: 1,
              symbol: "AAPL",
              secType: "STK",
              lastTradeDateOrContractMonth: "",
              strike: null,
              right: "",
              exchange: "SMART",
              currency: "USD",
              localSymbol: "AAPL",
              marketName: "NASDAQ.NMS",
              tradingClass: "NMS",
              distance: "5.25%",
              benchmark: "",
              projection: "",
              legsStr: "",
            },
          ],
        };
      },
      async requestMarketDataSnapshot() {
        calls.push("requestMarketDataSnapshot");
        return buildSnapshot({
          symbol: "AAPL",
          last: 210,
          bid: 209.9,
          ask: 210.1,
          close: 200,
          volume: 2_000_000,
        });
      },
    };

    const result = await buildStockScannerView(gateway as never, {
      scanCode: "TOP_PERC_GAIN",
      includeSnapshots: true,
      marketDataType: 3,
    });

    expect(calls).toEqual(["requestStockScanner", "requestMarketDataSnapshot"]);
    expect(result.results[0]?.symbol).toBe("AAPL");
    expect(result.results[0]?.distancePercent).toBe(5.25);
    expect(result.results[0]?.changePercent).toBe(5);
    expect(result.results[0]?.delayed).toBe(true);
  });

  test("applies built-in scanner presets to the existing scan path", async () => {
    const gateway = {
      async requestStockScanner(input: {
        scanCode?: string;
        abovePrice?: number;
        aboveVolume?: number;
        marketCapAbove?: number;
      }) {
        expect(input.scanCode).toBe("HOT_BY_VOLUME");
        expect(input.abovePrice).toBe(10);
        expect(input.aboveVolume).toBe(1_000_000);
        expect(input.marketCapAbove).toBe(10_000_000_000);

        return {
          reqId: 1,
          scanCode: input.scanCode || "",
          instrument: "STK",
          locationCode: "STK.US.MAJOR",
          rows: [],
        };
      },
      async requestMarketDataSnapshot() {
        throw new Error("requestMarketDataSnapshot should not be called when includeSnapshots=false");
      },
    };

    const result = await buildStockScannerView(gateway as never, {
      preset: "liquid_leaders",
      includeSnapshots: false,
    });

    expect(result.requested.preset).toBe("liquid_leaders");
    expect(result.requested.scanCode).toBe("HOT_BY_VOLUME");
    expect(result.requested.filters.abovePrice).toBe(10);
    expect(result.requested.filters.aboveVolume).toBe(1_000_000);
    expect(result.requested.filters.marketCapAbove).toBe(10_000_000_000);
    expect(result.results).toEqual([]);
  });

  test("builds a consolidated market scenario with benchmarks and movers", async () => {
    const calls: string[] = [];
    const gateway = {
      async requestStockScanner(input: { scanCode: string }) {
        calls.push(`requestStockScanner:${input.scanCode}`);
        return {
          reqId: 1,
          scanCode: input.scanCode,
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
              localSymbol: "SYM",
              marketName: "NASDAQ.NMS",
              tradingClass: "NMS",
              distance:
                input.scanCode === "TOP_PERC_LOSE"
                  ? "-3.1%"
                  : input.scanCode === "MOST_ACTIVE"
                    ? "0"
                    : "4.8%",
              benchmark: "",
              projection: "",
              legsStr: "",
            },
          ],
        };
      },
      async requestMarketDataSnapshot(input: { symbol: string }) {
        calls.push(`requestMarketDataSnapshot:${input.symbol}`);
        if (input.symbol === "SPY") {
          return buildSnapshot({
            symbol: "SPY",
            last: 500,
            bid: 499.9,
            ask: 500.1,
            close: 495,
            volume: 10_000_000,
          });
        }

        if (input.symbol === "QQQ") {
          return buildSnapshot({
            symbol: "QQQ",
            last: 440,
            bid: 439.9,
            ask: 440.1,
            close: 438,
            volume: 8_000_000,
          });
        }

        return buildSnapshot({
          symbol: input.symbol,
          last: 210,
          bid: 209.9,
          ask: 210.1,
          close: 200,
          volume: 2_000_000,
        });
      },
    };

    const result = await buildStockMarketScenario(gateway as never, {
      rowsPerScan: 3,
      marketDataType: 3,
      benchmarkSymbols: ["SPY", "QQQ"],
    });

    expect(
      calls.filter((call) => call.startsWith("requestStockScanner:")),
    ).toHaveLength(3);
    expect(
      calls.filter((call) => call.startsWith("requestMarketDataSnapshot:")),
    ).toHaveLength(5);
    expect(result.summary.benchmarkTrend).toBe("risk_on");
    expect(result.summary.topGainerSymbol).toBe("AAPL");
    expect(result.summary.topLoserSymbol).toBe("MSFT");
    expect(result.movers.mostActive[0]?.symbol).toBe("NVDA");
    expect(result.alerts).toContain("top_gainer:AAPL:5%");
  });
});

function buildSnapshot(input: {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  close: number;
  volume: number;
}) {
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
      delayedLast: input.last,
      tick_66: input.bid,
      tick_67: input.ask,
      tick_75: input.close,
      tick_74: input.volume,
      marketDataType: 3,
    },
    rawTicks: {},
    warnings: [],
    completed: true,
    timedOut: false,
  };
}
