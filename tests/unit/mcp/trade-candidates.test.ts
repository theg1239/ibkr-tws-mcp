import { describe, expect, test } from "bun:test";
import { buildStockTradeCandidates } from "../../../src/mcp/trade-candidates.ts";

describe("trade-candidates", () => {
  test("builds a consolidated stock-only shortlist from portfolio, scanners, and studies", async () => {
    const calls: string[] = [];
    const gateway = {
      async requestAccountSummary() {
        calls.push("requestAccountSummary");
        return {
          reqId: 1,
          group: "All",
          tags:
            "NetLiquidation,TotalCashValue,BuyingPower,AvailableFunds,ExcessLiquidity,InitMarginReq,MaintMarginReq,GrossPositionValue",
          rows: [
            { account: "DU123", tag: "NetLiquidation", value: "100000", currency: "USD" },
            { account: "DU123", tag: "TotalCashValue", value: "5000", currency: "USD" },
          ],
          byAccount: {
            DU123: {
              NetLiquidation: {
                value: "100000",
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
              position: "100",
              averageCost: 150,
            },
          ],
        };
      },
      async requestOpenStockOrders() {
        calls.push("requestOpenStockOrders");
        return {
          orders: [],
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
                position: "100",
                averageCost: 150,
              },
              snapshot: buildSnapshot("AAPL", 300, 299.9, 300.1, 295, 3_000_000),
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
          reqId: 50,
          account: "DU123",
          modelCode: "",
          dailyPnL: 1250,
          unrealizedPnL: 5000,
          realizedPnL: 250,
          receivedAt: "2026-03-04T00:00:00.000Z",
        };
      },
      async requestStockScanner(input: { scanCode?: string }) {
        calls.push(`requestStockScanner:${input.scanCode}`);

        const symbol =
          input.scanCode === "TOP_PERC_LOSE"
            ? "TSLA"
            : input.scanCode === "MOST_ACTIVE"
              ? "NVDA"
              : input.scanCode === "HOT_BY_VOLUME"
                ? "AMD"
                : "AAPL";
        const distance =
          input.scanCode === "TOP_PERC_LOSE"
            ? "-4.1%"
            : input.scanCode === "MOST_ACTIVE"
              ? "0"
              : "5.2%";

        return {
          reqId: 1,
          scanCode: input.scanCode || "TOP_PERC_GAIN",
          instrument: "STK",
          locationCode: "STK.US.MAJOR",
          rows: [
            {
              rank: 0,
              conid: 10,
              symbol,
              secType: "STK",
              lastTradeDateOrContractMonth: "",
              strike: null,
              right: "",
              exchange: "SMART",
              currency: "USD",
              localSymbol: symbol,
              marketName: "NASDAQ.NMS",
              tradingClass: "NMS",
              distance,
              benchmark: "",
              projection: "",
              legsStr: "",
            },
          ],
        };
      },
      async requestMarketDataSnapshot(input: { symbol: string }) {
        calls.push(`requestMarketDataSnapshot:${input.symbol}`);

        const prices: Record<string, number> = {
          AAPL: 300,
          AMD: 190,
          NVDA: 180,
          TSLA: 250,
          SPY: 510,
          QQQ: 450,
          IWM: 215,
          DIA: 430,
        };
        const last = prices[input.symbol] ?? 100;
        return buildSnapshot(input.symbol, last, last - 0.1, last + 0.1, last - 5, 2_000_000);
      },
      async requestStockHistoricalBars(input: { symbol: string }) {
        calls.push(`requestStockHistoricalBars:${input.symbol}`);
        return {
          reqId: 1,
          contract: {
            symbol: input.symbol,
            exchange: "SMART",
            primaryExchange: "NASDAQ",
            currency: "USD",
          },
          endDateTime: "",
          durationStr: "6 M",
          barSizeSetting: "1 day",
          whatToShow: "TRADES",
          useRTH: true,
          bars: Array.from({ length: 25 }, (_, index) => ({
            time: `202602${String(index + 1).padStart(2, "0")} 16:00:00`,
            open: 100 + index,
            high: 101 + index,
            low: 99 + index,
            close: 100.5 + index,
            volume: "1000000",
            wap: "100.5",
            barCount: 10,
          })),
          startDateTime: "20260201 16:00:00",
          endDateTimeReturned: "20260225 16:00:00",
        };
      },
    };

    const result = await buildStockTradeCandidates(gateway as never, {
      scannerPreset: "liquid_leaders",
      includeLivePnl: false,
      includeIntradayBars: false,
      rankLimit: 4,
      marketDataType: 3,
    });

    expect(calls).toContain("requestAccountPnLSnapshot");
    expect(calls.filter((call) => call.startsWith("requestStockScanner:"))).toHaveLength(4);
    expect(result.accountLivePnl?.dailyPnL).toBe(1250);
    expect(result.market.focusSymbols[0]).toBe("AMD");
    expect(result.universe.finalSymbols).toContain("AAPL");
    expect(result.universe.finalSymbols).toContain("AMD");
    expect(result.candidates[0]?.symbol).toBe("AAPL");
    expect(result.candidates[0]?.action).toBe("trim");
    expect(result.candidates.some((candidate) => candidate.symbol === "AMD")).toBe(true);
  });

  test("does not promote symbols without analysis into watch-long actions", async () => {
    const gateway = {
      async requestAccountSummary() {
        return {
          reqId: 1,
          group: "All",
          tags: "NetLiquidation,TotalCashValue",
          rows: [
            { account: "DU123", tag: "NetLiquidation", value: "100000", currency: "USD" },
            { account: "DU123", tag: "TotalCashValue", value: "10000", currency: "USD" },
          ],
          byAccount: {
            DU123: {
              NetLiquidation: {
                value: "100000",
                currency: "USD",
              },
            },
          },
        };
      },
      async requestPositions() {
        return { rows: [] };
      },
      async requestOpenStockOrders() {
        return { orders: [] };
      },
      async requestHeldStockSnapshots() {
        return {
          items: [],
          totals: {
            requested: 0,
            completed: 0,
            failed: 0,
          },
        };
      },
      async requestAccountPnLSnapshot() {
        return {
          reqId: 99,
          account: "DU123",
          modelCode: "",
          dailyPnL: 10,
          unrealizedPnL: 25,
          realizedPnL: 5,
          receivedAt: "2026-03-04T00:00:00.000Z",
        };
      },
      async requestStockScanner(input: { scanCode?: string }) {
        return {
          reqId: 1,
          scanCode: input.scanCode || "TOP_PERC_GAIN",
          instrument: "STK",
          locationCode: "STK.US.MAJOR",
          rows: [
            {
              rank: 0,
              conid: 10,
              symbol: "XYZ",
              secType: "STK",
              lastTradeDateOrContractMonth: "",
              strike: null,
              right: "",
              exchange: "SMART",
              currency: "USD",
              localSymbol: "XYZ",
              marketName: "NASDAQ.SCM",
              tradingClass: "SCM",
              distance: "3.1%",
              benchmark: "",
              projection: "",
              legsStr: "",
            },
          ],
        };
      },
      async requestMarketDataSnapshot(input: { symbol: string }) {
        return buildSnapshot(input.symbol, 10, 9.9, 10.1, 9.7, 100_000);
      },
      async requestStockHistoricalBars() {
        throw new Error("historical data unavailable");
      },
    };

    const result = await buildStockTradeCandidates(gateway as never, {
      scannerPreset: "intraday_momentum",
      includeHeldPositions: false,
      includeLivePnl: false,
      includeIntradayBars: false,
      rankLimit: 3,
      marketDataType: 3,
    });

    expect(result.candidates[0]?.symbol).toBe("XYZ");
    expect(result.candidates[0]?.score).toBeNull();
    expect(result.candidates[0]?.action).toBe("avoid");
    expect(
      result.candidates[0]?.warnings.some((warning) =>
        warning.startsWith("daily_bars_unavailable:"),
      ),
    ).toBe(true);
  });
});

function buildSnapshot(
  symbol: string,
  last: number,
  bid: number,
  ask: number,
  close: number,
  volume: number,
) {
  return {
    reqId: 1,
    contract: {
      symbol,
      secType: "STK",
      exchange: "SMART",
      primaryExchange: "NASDAQ",
      currency: "USD",
    },
    fields: {
      delayedLast: last,
      tick_66: bid,
      tick_67: ask,
      tick_75: close,
      tick_74: volume,
      marketDataType: 3,
    },
    rawTicks: {},
    warnings: [],
    completed: true,
    timedOut: false,
  };
}
