import { describe, expect, test } from "bun:test";
import { buildStockPortfolioOverview } from "../../../src/mcp/portfolio-overview.ts";

describe("portfolio-overview", () => {
  test("builds a stock portfolio planning view from one bundled request flow", async () => {
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
            { account: "DU123", tag: "NetLiquidation", value: "10000", currency: "USD" },
            { account: "DU123", tag: "TotalCashValue", value: "-1000", currency: "USD" },
            { account: "DU123", tag: "BuyingPower", value: "30000", currency: "USD" },
            { account: "DU123", tag: "AvailableFunds", value: "6000", currency: "USD" },
            { account: "DU123", tag: "ExcessLiquidity", value: "6500", currency: "USD" },
            { account: "DU123", tag: "InitMarginReq", value: "2000", currency: "USD" },
            { account: "DU123", tag: "MaintMarginReq", value: "1500", currency: "USD" },
            { account: "DU123", tag: "GrossPositionValue", value: "2500", currency: "USD" },
          ],
          byAccount: {},
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
              position: "10",
              averageCost: 150,
            },
            {
              account: "DU123",
              contract: {
                conid: 2,
                symbol: "MSFT",
                secType: "STK",
                lastTradeDateOrContractMonth: "",
                strike: null,
                right: "",
                multiplier: "",
                exchange: "SMART",
                currency: "USD",
                localSymbol: "MSFT",
                tradingClass: "NMS",
              },
              position: "5",
              averageCost: 100,
            },
          ],
        };
      },
      async requestOpenStockOrders() {
        calls.push("requestOpenStockOrders");
        return {
          orders: [
            {
              orderId: 9,
              contract: {
                conid: 1,
                symbol: "AAPL",
                secType: "STK",
                exchange: "SMART",
                primaryExchange: "NASDAQ",
                currency: "USD",
                localSymbol: "AAPL",
                tradingClass: "NMS",
              },
              order: {
                action: "SELL",
                quantity: "2",
                orderType: "LMT",
                limitPrice: 205,
                tif: "DAY",
                account: "DU123",
                outsideRth: false,
              },
              orderState: {
                status: "Submitted",
                initMarginBefore: null,
                maintMarginBefore: null,
                equityWithLoanBefore: null,
                initMarginChange: null,
                maintMarginChange: null,
                equityWithLoanChange: null,
                initMarginAfter: null,
                maintMarginAfter: null,
                equityWithLoanAfter: null,
                commissionAndFees: null,
                minCommissionAndFees: null,
                maxCommissionAndFees: null,
                commissionAndFeesCurrency: null,
                marginCurrency: null,
                initMarginBeforeOutsideRth: null,
                maintMarginBeforeOutsideRth: null,
                equityWithLoanBeforeOutsideRth: null,
                initMarginChangeOutsideRth: null,
                maintMarginChangeOutsideRth: null,
                equityWithLoanChangeOutsideRth: null,
                initMarginAfterOutsideRth: null,
                maintMarginAfterOutsideRth: null,
                equityWithLoanAfterOutsideRth: null,
                suggestedSize: null,
                rejectReason: null,
                warningText: null,
              },
            },
          ],
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
                position: "10",
                averageCost: 150,
              },
              snapshot: {
                reqId: 1,
                contract: {
                  symbol: "AAPL",
                  secType: "STK",
                  exchange: "SMART",
                  primaryExchange: "NASDAQ",
                  currency: "USD",
                },
                fields: {
                  delayedLast: 200,
                  tick_66: 199.5,
                  tick_67: 200.5,
                  marketDataType: 3,
                },
                rawTicks: {},
                warnings: ["IB error 10167for request 1: Displaying delayed market data."],
                completed: true,
                timedOut: false,
              },
              error: null,
            },
            {
              position: {
                account: "DU123",
                contract: {
                  conid: 2,
                  symbol: "MSFT",
                  secType: "STK",
                  lastTradeDateOrContractMonth: "",
                  strike: null,
                  right: "",
                  multiplier: "",
                  exchange: "SMART",
                  currency: "USD",
                  localSymbol: "MSFT",
                  tradingClass: "NMS",
                },
                position: "5",
                averageCost: 100,
              },
              snapshot: null,
              error: "Market data snapshot 1001 timed out after 6000ms.",
            },
          ],
          totals: {
            requested: 2,
            completed: 1,
            failed: 1,
          },
        };
      },
      async requestHeldStockPnLSnapshots() {
        calls.push("requestHeldStockPnLSnapshots");
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
                position: "10",
                averageCost: 150,
              },
              pnl: {
                reqId: 11,
                account: "DU123",
                modelCode: "",
                conid: 1,
                position: "10",
                dailyPnL: 35,
                unrealizedPnL: 500,
                realizedPnL: 0,
                value: 2000,
                receivedAt: "2026-03-04T00:00:00.000Z",
              },
              error: null,
            },
            {
              position: {
                account: "DU123",
                contract: {
                  conid: 2,
                  symbol: "MSFT",
                  secType: "STK",
                  lastTradeDateOrContractMonth: "",
                  strike: null,
                  right: "",
                  multiplier: "",
                  exchange: "SMART",
                  currency: "USD",
                  localSymbol: "MSFT",
                  tradingClass: "NMS",
                },
                position: "5",
                averageCost: 100,
              },
              pnl: null,
              error: "Stock PnL snapshot 12 timed out after 6000ms.",
            },
          ],
          totals: {
            requested: 2,
            completed: 1,
            failed: 1,
          },
        };
      },
      async requestAccountPnLSnapshot() {
        calls.push("requestAccountPnLSnapshot");
        return {
          reqId: 20,
          account: "DU123",
          modelCode: "",
          dailyPnL: 90,
          unrealizedPnL: 650,
          realizedPnL: 25,
          receivedAt: "2026-03-04T00:00:00.000Z",
        };
      },
    };

    const overview = await buildStockPortfolioOverview(gateway as never, {
      includeOpenOrders: true,
      includeLivePnl: true,
      includeAccountLivePnl: true,
      marketDataType: 3,
      rankLimit: 3,
    });

    expect(calls).toEqual([
      "requestAccountSummary",
      "requestPositions",
      "requestOpenStockOrders",
      "requestHeldStockSnapshots",
      "requestHeldStockPnLSnapshots",
      "requestAccountPnLSnapshot",
    ]);
    expect(overview.requested.marketDataType).toBe(3);
    expect(overview.requested.includeLivePnl).toBe(true);
    expect(overview.requested.includeAccountLivePnl).toBe(true);
    expect(overview.accountLivePnl?.dailyPnL).toBe(90);
    expect(overview.summary.stockPositionCount).toBe(2);
    expect(overview.summary.quotedPositionCount).toBe(1);
    expect(overview.summary.positionsMissingQuotes).toBe(1);
    expect(overview.summary.marginDebit).toBe(true);
    expect(overview.summary.livePnlPositionCount).toBe(1);
    expect(overview.summary.totalDailyPnl).toBe(35);
    expect(overview.summary.totalUnrealizedPnl).toBe(500);
    expect(overview.holdings[0]?.symbol).toBe("AAPL");
    expect(overview.holdings[0]?.dailyPnl).toBe(35);
    expect(overview.holdings[0]?.livePnlValue).toBe(2000);
    expect(overview.holdings[0]?.unrealizedPnl).toBe(500);
    expect(overview.holdings[0]?.weightPercentOfNetLiq).toBe(20);
    expect(overview.holdings[0]?.openOrderCount).toBe(1);
    expect(overview.rankings.largestByWeight[0]?.symbol).toBe("AAPL");
    expect(overview.rankings.biggestLosers[0]?.symbol).toBe("AAPL");
    expect(overview.rankings.biggestWinners[0]?.symbol).toBe("AAPL");
    expect(overview.alerts).toContain("margin_debit_present");
    expect(overview.alerts).toContain("positions_missing_quotes:1");
    expect(overview.alerts).toContain("medium_concentration:AAPL:20%");
    expect(
      overview.warnings.some((warning) =>
        warning.startsWith("snapshot_error:MSFT:Market data snapshot 1001 timed out"),
      ),
    ).toBe(true);
    expect(
      overview.warnings.some((warning) =>
        warning.startsWith("live_pnl_error:MSFT:Stock PnL snapshot 12 timed out"),
      ),
    ).toBe(true);
  });

  test("can skip the open order request when it is not needed", async () => {
    const calls: string[] = [];
    const gateway = {
      async requestAccountSummary() {
        calls.push("requestAccountSummary");
        return {
          reqId: 1,
          group: "All",
          tags: "NetLiquidation",
          rows: [
            { account: "DU123", tag: "NetLiquidation", value: "5000", currency: "USD" },
          ],
          byAccount: {},
        };
      },
      async requestPositions() {
        calls.push("requestPositions");
        return {
          rows: [],
        };
      },
      async requestHeldStockSnapshots() {
        calls.push("requestHeldStockSnapshots");
        return {
          items: [],
          totals: {
            requested: 0,
            completed: 0,
            failed: 0,
          },
        };
      },
      async requestOpenStockOrders() {
        calls.push("requestOpenStockOrders");
        return {
          orders: [],
        };
      },
    };

    const overview = await buildStockPortfolioOverview(gateway as never, {
      includeOpenOrders: false,
    });

    expect(calls).toEqual([
      "requestAccountSummary",
      "requestPositions",
      "requestHeldStockSnapshots",
    ]);
    expect(overview.summary.totalOpenStockOrders).toBe(0);
    expect(overview.holdings).toEqual([]);
  });
});
