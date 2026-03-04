import { expect, test } from "bun:test";
import { buildStockMarketScenario } from "../../src/mcp/market-scenario.ts";
import { buildStockPortfolioOverview } from "../../src/mcp/portfolio-overview.ts";
import { buildStockTradeCandidates } from "../../src/mcp/trade-candidates.ts";
import {
  buildStockStudies,
  buildStockStudy,
} from "../../src/mcp/stock-study.ts";
import { TwsGatewayClient } from "../../src/tws/client.ts";

const runLiveTests = Bun.env.IBKR_RUN_LIVE_TESTS === "1";
const liveTest = runLiveTests ? test : test.skip;
const liveClientId = Number.parseInt(Bun.env.IB_TEST_CLIENT_ID || "", 10) || 97;

liveTest(
  "connects to the live IB Gateway instance and exercises the supported surface",
  async () => {
    const gateway = new TwsGatewayClient();

    try {
      const status = await gateway.connect({
        clientId: liveClientId,
      });
      expect(status.connected).toBe(true);
      expect(status.serverVersion).toBeGreaterThan(0);

      expect(gateway.getMarketDataType()).toEqual({
        marketDataType: null,
        label: "unset",
      });
      expect(gateway.setMarketDataType(3)).toEqual({
        marketDataType: 3,
        label: "delayed",
      });

      const stockMatches = await gateway.searchStockSymbols({
        pattern: "AAPL",
        limit: 10,
        timeoutMs: 8000,
      });
      expect(stockMatches.matches.length).toBeGreaterThan(0);
      expect(stockMatches.matches.some((match) => match.symbol === "AAPL")).toBe(true);

      const currentTime = await gateway.requestCurrentTime();
      expect(currentTime.epochSeconds).toBeGreaterThan(0);

      const managedAccounts = await gateway.requestManagedAccounts();
      expect(managedAccounts.accounts.length).toBeGreaterThan(0);

      const nextValidOrderId = await gateway.requestNextValidOrderId();
      expect(nextValidOrderId.orderId).toBeGreaterThan(0);

      const accountSummary = await gateway.requestAccountSummary({
        timeoutMs: 8000,
      });
      expect(accountSummary.rows.length).toBeGreaterThan(0);

      const positions = await gateway.requestPositions({
        timeoutMs: 8000,
      });
      expect(Array.isArray(positions.rows)).toBe(true);

      try {
        const historicalBars = await gateway.requestStockHistoricalBars({
          symbol: "AAPL",
          durationStr: "1 D",
          barSizeSetting: "1 hour",
          whatToShow: "TRADES",
          useRTH: true,
          timeoutMs: 10000,
        });
        expect(historicalBars.bars.length).toBeGreaterThan(0);
      } catch (error) {
        if (!(error instanceof Error) || !isAcceptableHistoricalDataRestriction(error)) {
          throw error;
        }

        expect(error.message).toContain("IB error 162");
      }

      const snapshot = await gateway.requestGatewaySnapshot({
        includeAccountSummary: false,
        includePositions: false,
        includeOpenOrders: true,
        includeHeldStockSnapshots: true,
        includeAccountLivePnl: true,
      });
      expect(snapshot.status.connected).toBe(true);
      expect(snapshot.currentTime.epochSeconds).toBeGreaterThan(0);
      expect(snapshot.managedAccounts.accounts.length).toBeGreaterThan(0);
      expect(snapshot.nextValidOrderId.orderId).toBeGreaterThan(0);
      expect(snapshot.accountSummary).toBeUndefined();
      expect(snapshot.positions).toBeUndefined();
      expect(Array.isArray(snapshot.openOrders?.orders)).toBe(true);
      expect(snapshot.heldStockSnapshots).toBeDefined();
      expect(snapshot.heldStockSnapshots?.totals.requested).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(snapshot.heldStockSnapshots?.items)).toBe(true);
      expect(Array.isArray(snapshot.warnings)).toBe(true);

      const portfolioOverview = await buildStockPortfolioOverview(gateway, {
        includeOpenOrders: true,
        includeLivePnl: true,
        includeAccountLivePnl: true,
        marketDataType: 3,
        rankLimit: 5,
        livePnlTimeoutMs: 5000,
        accountLivePnlTimeoutMs: 5000,
      });
      expect(portfolioOverview.summary.stockPositionCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(portfolioOverview.holdings)).toBe(true);
      expect(Array.isArray(portfolioOverview.rankings.largestByWeight)).toBe(true);
      expect(portfolioOverview.summary.livePnlPositionCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(portfolioOverview.warnings)).toBe(true);

      const marketScenario = await buildStockMarketScenario(gateway, {
        rowsPerScan: 3,
        marketDataType: 3,
        benchmarkSymbols: ["SPY", "QQQ"],
        snapshotTimeoutMs: 6000,
        timeoutMs: 8000,
      });
      expect(Array.isArray(marketScenario.benchmarks)).toBe(true);
      expect(Array.isArray(marketScenario.movers.topGainers)).toBe(true);
      expect(Array.isArray(marketScenario.movers.topLosers)).toBe(true);
      expect(Array.isArray(marketScenario.movers.mostActive)).toBe(true);

      const tradeCandidates = await buildStockTradeCandidates(gateway, {
        symbols: ["AAPL", "MSFT"],
        includeHeldPositions: false,
        includeLivePnl: false,
        scannerPreset: "liquid_leaders",
        includeIntradayBars: false,
        scanRows: 2,
        scenarioRowsPerScan: 2,
        rankLimit: 5,
        marketDataType: 3,
        snapshotTimeoutMs: 6000,
        timeoutMs: 8000,
      });
      expect(Array.isArray(tradeCandidates.candidates)).toBe(true);
      expect(Array.isArray(tradeCandidates.warnings)).toBe(true);
      expect(tradeCandidates.universe.finalSymbols.length).toBeGreaterThan(0);

      try {
        const stockStudy = await buildStockStudy(gateway, {
          symbol: "AAPL",
          includeIntradayBars: false,
          durationStr: "3 M",
          barSizeSetting: "1 day",
          timeoutMs: 10000,
        });
        expect(stockStudy.symbol).toBe("AAPL");
        expect(
          stockStudy.dailyBars !== null ||
            stockStudy.snapshot !== null ||
            stockStudy.positionContext !== null,
        ).toBe(true);
      } catch (error) {
        if (!(error instanceof Error) || !isAcceptableStudyRestriction(error)) {
          throw error;
        }

        expect(error.message).toContain("Unable to build stock study");
      }

      try {
        const batchStudy = await buildStockStudies(gateway, {
          symbols: ["AAPL", "MSFT", "NVDA"],
          includeIntradayBars: false,
          durationStr: "3 M",
          barSizeSetting: "1 day",
          timeoutMs: 10000,
          rankLimit: 3,
        });
        expect(batchStudy.requestedSymbols).toEqual(["AAPL", "MSFT", "NVDA"]);
        expect(batchStudy.studies.length).toBeGreaterThan(0);
        expect(batchStudy.studies.length + batchStudy.failures.length).toBe(3);
        expect(batchStudy.totals.requested).toBe(3);
        expect(batchStudy.totals.completed).toBeGreaterThan(0);
      } catch (error) {
        if (!(error instanceof Error) || !isAcceptableStudyRestriction(error)) {
          throw error;
        }

        expect(error.message).toContain("Unable to build stock studies");
      }

      if ((status.serverVersion ?? 0) >= 203) {
        const previewAccount = managedAccounts.accounts[0];
        if (!previewAccount) {
          throw new Error("Expected at least one managed account for order preview.");
        }

        const preview = await gateway.previewStockOrderWhatIf({
          symbol: "AAPL",
          action: "BUY",
          quantity: 1,
          orderType: "MKT",
          account: previewAccount,
          timeoutMs: 10000,
        });
        expect(preview.orderId).toBeGreaterThan(0);
        expect(preview.requestedOrder.symbol).toBe("AAPL");
        expect(preview.requestedOrder.account).toBe(previewAccount);
      }
    } finally {
      gateway.disconnect();
    }
  },
  90000,
);

function isAcceptableHistoricalDataRestriction(error: Error): boolean {
  return (
    error.message.includes("IB error 162") &&
    error.message.includes("Trading TWS session is connected from a different IP address")
  );
}

function isAcceptableStudyRestriction(error: Error): boolean {
  return (
    error.message.includes("Unable to build stock study because historical bars, snapshot data, and position context all failed.") ||
    error.message.includes("Unable to build stock studies because every requested symbol failed.")
  );
}
