import { describe, expect, test } from "bun:test";
import { TwsGatewayClient } from "../../../src/tws/client.ts";
import {
  INCOMING,
  OUTGOING,
  PROTOCOL,
  readBigEndianInt,
  splitNullFields,
  toBigEndianInt,
} from "../../../src/tws/protocol.ts";
import type {
  AccountSummaryResponse,
  CurrentTimeResponse,
  GatewayStatus,
  MarketDataSnapshotRequestOptions,
  ManagedAccountsResponse,
  MarketSnapshot,
  NextValidOrderIdResponse,
  PositionsResponse,
} from "../../../src/tws/types.ts";

describe("tws-gateway-client", () => {
  test("setMarketDataType sends the gateway command and caches the preference", () => {
    const { client, writes } = createConnectedClient();

    expect(client.setMarketDataType(3)).toEqual({
      marketDataType: 3,
      label: "delayed",
    });

    expect(client.getMarketDataType()).toEqual({
      marketDataType: 3,
      label: "delayed",
    });
    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_MARKET_DATA_TYPE);
    expect(splitNullFields(writes[0]!.slice(8))).toEqual(["1", "3"]);
  });

  test("setMarketDataType rejects unsupported values", () => {
    const { client } = createConnectedClient();

    expect(() => client.setMarketDataType(9 as 1)).toThrow(
      "marketDataType must be one of 1 (live), 2 (frozen), 3 (delayed), or 4 (delayed-frozen).",
    );
  });

  test("requestManagedAccounts reuses cached startup accounts", async () => {
    const { client, writes } = createConnectedClient({
      managedAccounts: ["DU123", "DU456"],
    });

    await expect(client.requestManagedAccounts()).resolves.toEqual({
      accounts: ["DU123", "DU456"],
      raw: "DU123,DU456",
    });
    expect(writes).toHaveLength(0);
  });

  test("requestNextValidOrderId reuses the cached startup order id", async () => {
    const { client, writes } = createConnectedClient({
      nextValidOrderId: 77,
    });

    await expect(client.requestNextValidOrderId()).resolves.toEqual({
      orderId: 77,
    });
    expect(writes).toHaveLength(0);
  });

  test("searchStockSymbols filters the symbol sample payload down to stocks", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.searchStockSymbols({
      pattern: "AAPL",
      limit: 5,
      timeoutMs: 5000,
    });
    const reqId = extractFirstFieldAsInt(writes[0]!);

    dispatchMessage(client, INCOMING.SYMBOL_SAMPLES, [
      String(reqId),
      "2",
      "265598",
      "AAPL",
      "STK",
      "NASDAQ",
      "USD",
      "2",
      "OPT",
      "WAR",
      "Apple Inc",
      "",
      "999001",
      "AAPL",
      "OPT",
      "CBOE",
      "USD",
      "1",
      "STK",
      "Apple Option",
      "",
    ]);

    await expect(responsePromise).resolves.toEqual({
      reqId,
      pattern: "AAPL",
      matches: [
        {
          conid: 265598,
          symbol: "AAPL",
          primaryExchange: "NASDAQ",
          currency: "USD",
          description: "Apple Inc",
          issuerId: "",
          derivativeSecTypes: ["OPT", "WAR"],
        },
      ],
    });
  });

  test("requestStockScanner sends a scanner subscription and resolves from scanner data", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestStockScanner({
      scanCode: "TOP_PERC_GAIN",
      numberOfRows: 5,
      timeoutMs: 5000,
    });
    const fields = splitNullFields(writes[0]!.slice(8));
    const reqId = Number(fields[0]);

    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_SCANNER_SUBSCRIPTION);
    expect(fields.slice(0, 5)).toEqual([
      String(reqId),
      "5",
      "STK",
      "STK.US.MAJOR",
      "TOP_PERC_GAIN",
    ]);

    dispatchMessage(client, INCOMING.SCANNER_DATA, [
      "3",
      String(reqId),
      "2",
      "0",
      "1",
      "AAPL",
      "STK",
      "",
      "",
      "",
      "SMART",
      "USD",
      "AAPL",
      "NASDAQ.NMS",
      "NMS",
      "5.2%",
      "",
      "",
      "",
      "1",
      "2",
      "ES",
      "FUT",
      "",
      "",
      "",
      "GLOBEX",
      "USD",
      "ES",
      "GLOBEX",
      "",
      "0",
      "",
      "",
      "",
    ]);

    await expect(responsePromise).resolves.toEqual({
      reqId,
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
          distance: "5.2%",
          benchmark: "",
          projection: "",
          legsStr: "",
        },
      ],
    });
    expect(writes).toHaveLength(2);
    expect(readBigEndianInt(writes[1]!, 4)).toBe(OUTGOING.CANCEL_SCANNER_SUBSCRIPTION);
    expect(splitNullFields(writes[1]!.slice(8))).toEqual(["1", String(reqId)]);
  });

  test("requestStockScanner resolves empty rows when IB reports no scanner items", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestStockScanner({
      scanCode: "TOP_PERC_GAIN",
      timeoutMs: 5000,
    });
    const reqId = extractFirstFieldAsInt(writes[0]!);

    dispatchProtoMessage(
      client,
      INCOMING.ERR_MSG,
      buildErrorMessagePayload({
        id: reqId,
        errorCode: 165,
        errorMessage: "Historical Market Data Service query message:no items retrieved",
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      reqId,
      scanCode: "TOP_PERC_GAIN",
      instrument: "STK",
      locationCode: "STK.US.MAJOR",
      rows: [],
    });
    expect(writes).toHaveLength(2);
    expect(readBigEndianInt(writes[1]!, 4)).toBe(OUTGOING.CANCEL_SCANNER_SUBSCRIPTION);
    expect(splitNullFields(writes[1]!.slice(8))).toEqual(["1", String(reqId)]);
  });

  test("requestGatewaySnapshot reuses a fresh cached current time", async () => {
    const now = Date.now();
    const cachedCurrentTime: CurrentTimeResponse = {
      epochSeconds: 1_704_067_200,
      isoTime: "2024-01-01T00:00:00.000Z",
    };
    const { client, writes } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 101,
      lastCurrentTime: cachedCurrentTime,
      lastCurrentTimeReceivedAt: now,
    });

    await expect(
      client.requestGatewaySnapshot({
        includeAccountSummary: false,
        includePositions: false,
      }),
    ).resolves.toEqual({
      status: {
        connected: true,
        host: null,
        port: null,
        clientId: null,
        serverVersion: 203,
        connectionTime: null,
        managedAccounts: ["DU123"],
        nextValidOrderId: 101,
        marketDataType: null,
      },
      currentTime: cachedCurrentTime,
      managedAccounts: {
        accounts: ["DU123"],
        raw: "DU123",
      },
      nextValidOrderId: {
        orderId: 101,
      },
      warnings: [],
    });
    expect(writes).toHaveLength(0);
  });

  test("requestOpenStockOrders collects stock open orders until openOrderEnd", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestOpenStockOrders(5000);
    await Bun.sleep(0);

    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_OPEN_ORDERS);
    expect(splitNullFields(writes[0]!.slice(8))).toEqual(["1"]);

    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildDetailedOpenOrderPayload({
        orderId: 21,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        primaryExchange: "NASDAQ",
        currency: "USD",
        action: "BUY",
        quantity: "10",
        orderType: "LMT",
        limitPrice: 150.25,
        tif: "DAY",
        account: "DU123",
        outsideRth: false,
        status: "Submitted",
      }),
    );

    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildDetailedOpenOrderPayload({
        orderId: 22,
        symbol: "ES",
        secType: "FUT",
        exchange: "GLOBEX",
        primaryExchange: "",
        currency: "USD",
        action: "BUY",
        quantity: "1",
        orderType: "LMT",
        limitPrice: 5000,
        tif: "DAY",
        account: "DU123",
        outsideRth: false,
        status: "Submitted",
      }),
    );

    dispatchProtoMessage(client, INCOMING.OPEN_ORDER_END, new Uint8Array(0));

    await expect(responsePromise).resolves.toEqual({
      orders: [
        {
          orderId: 21,
          contract: {
            conid: null,
            symbol: "AAPL",
            secType: "STK",
            exchange: "SMART",
            primaryExchange: "NASDAQ",
            currency: "USD",
            localSymbol: "",
            tradingClass: "",
          },
          order: {
            action: "BUY",
            quantity: "10",
            orderType: "LMT",
            limitPrice: 150.25,
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
    });
  });

  test("requestStockHistoricalBars sends a stock-only historical data request and resolves on end", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestStockHistoricalBars({
      symbol: "AAPL",
      durationStr: "1 D",
      barSizeSetting: "1 hour",
      timeoutMs: 5000,
    });

    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_HISTORICAL_DATA);

    const fields = splitNullFields(writes[0]!.slice(8));
    const reqId = Number(fields[0]);
    expect(fields.slice(0, 6)).toEqual([String(reqId), "0", "AAPL", "STK", "", ""]);
    expect(fields[8]).toBe("SMART");
    expect(fields[16]).toBe("1 D");
    expect(fields[18]).toBe("TRADES");

    dispatchMessage(client, INCOMING.HISTORICAL_DATA, [
      String(reqId),
      "2",
      "20260303 15:30:00",
      "100",
      "101",
      "99",
      "100.5",
      "10000",
      "100.25",
      "12",
      "20260303 16:30:00",
      "100.5",
      "102",
      "100",
      "101.5",
      "12000",
      "101.00",
      "10",
    ]);
    dispatchMessage(client, INCOMING.HISTORICAL_DATA_END, [
      String(reqId),
      "20260303 15:30:00",
      "20260303 16:30:00",
    ]);

    await expect(responsePromise).resolves.toEqual({
      reqId,
      contract: {
        symbol: "AAPL",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
      },
      endDateTime: "",
      durationStr: "1 D",
      barSizeSetting: "1 hour",
      whatToShow: "TRADES",
      useRTH: true,
      bars: [
        {
          time: "20260303 15:30:00",
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: "10000",
          wap: "100.25",
          barCount: 12,
        },
        {
          time: "20260303 16:30:00",
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
          volume: "12000",
          wap: "101.00",
          barCount: 10,
        },
      ],
      startDateTime: "20260303 15:30:00",
      endDateTimeReturned: "20260303 16:30:00",
    });
    expect(writes).toHaveLength(2);
    expect(readBigEndianInt(writes[1]!, 4)).toBe(OUTGOING.CANCEL_HISTORICAL_DATA);
    expect(splitNullFields(writes[1]!.slice(8))).toEqual(["1", String(reqId)]);
  });

  test("requestMarketDataSnapshot preserves delayed-data warnings and resolves on timeout", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestMarketDataSnapshot({
      symbol: "NDRA",
      timeoutMs: 20,
    });
    const reqId = Number(splitNullFields(writes[0]!.slice(8))[1]);

    dispatchProtoMessage(
      client,
      INCOMING.ERR_MSG,
      buildErrorMessagePayload({
        id: reqId,
        errorCode: 10167,
        errorMessage: "Requested market data is not subscribed. Displaying delayed market data.",
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      reqId,
      contract: {
        symbol: "NDRA",
        secType: "STK",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
      },
      fields: {},
      rawTicks: {},
      warnings: [
        "IB error 10167for request " +
          reqId +
          ": Requested market data is not subscribed. Displaying delayed market data.",
      ],
      completed: false,
      timedOut: true,
    });
    expect(writes).toHaveLength(2);
    expect(readBigEndianInt(writes[1]!, 4)).toBe(OUTGOING.CANCEL_MKT_DATA);
    expect(splitNullFields(writes[1]!.slice(8))).toEqual(["1", String(reqId)]);
  });

  test("requestMarketDataSnapshot does not overwrite the global market data preference", async () => {
    const { client, writes } = createConnectedClient();
    expect(client.setMarketDataType(3)).toEqual({
      marketDataType: 3,
      label: "delayed",
    });

    const responsePromise = client.requestMarketDataSnapshot({
      symbol: "AAPL",
      marketDataType: 1,
      timeoutMs: 5000,
    });
    const reqMktDataWrite = writes[2]!;
    const reqId = Number(splitNullFields(reqMktDataWrite.slice(8))[1]);

    dispatchMessage(client, INCOMING.MARKET_DATA_TYPE, ["0", String(reqId), "1"]);
    dispatchMessage(client, INCOMING.TICK_SNAPSHOT_END, [String(reqId)]);

    await responsePromise;
    expect(client.getMarketDataType()).toEqual({
      marketDataType: 3,
      label: "delayed",
    });
  });

  test("requestStockMarketSnapshots batches symbols and preserves per-symbol failures", async () => {
    class BatchMarketSnapshotsClient extends TwsGatewayClient {
      override async requestMarketDataSnapshot(
        options: MarketDataSnapshotRequestOptions,
      ): Promise<MarketSnapshot> {
        const symbol = options.symbol.trim().toUpperCase();
        if (symbol === "MSFT") {
          throw new Error("snapshot denied");
        }

        const snapshot = buildTestMarketSnapshot(symbol);
        if (symbol === "NVDA") {
          snapshot.warnings = ["delayed feed in use"];
        }

        return snapshot;
      }
    }

    const client = new BatchMarketSnapshotsClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    await expect(
      client.requestStockMarketSnapshots({
        symbols: ["AAPL", "msft", "AAPL", "NVDA"],
        marketDataType: 3,
        batchConcurrency: 2,
      }),
    ).resolves.toEqual({
      items: [
        {
          symbol: "AAPL",
          snapshot: buildTestMarketSnapshot("AAPL"),
          error: null,
        },
        {
          symbol: "MSFT",
          snapshot: null,
          error: "snapshot denied",
        },
        {
          symbol: "NVDA",
          snapshot: {
            ...buildTestMarketSnapshot("NVDA"),
            warnings: ["delayed feed in use"],
          },
          error: null,
        },
      ],
      totals: {
        requested: 3,
        completed: 2,
        failed: 1,
      },
      warnings: [
        "snapshot_error:MSFT:snapshot denied",
        "snapshot_warning:NVDA:delayed feed in use",
      ],
    });
  });

  test("requestStockPnLSnapshot sends reqPnLSingle and resolves from pnlSingle", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestStockPnLSnapshot({
      account: "DU123",
      conid: 265598,
      timeoutMs: 5000,
    });
    const reqId = extractFirstFieldAsInt(writes[0]!);

    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_PNL_SINGLE);
    expect(splitNullFields(writes[0]!.slice(8))).toEqual([
      String(reqId),
      "DU123",
      "",
      "265598",
    ]);

    dispatchMessage(client, INCOMING.PNL_SINGLE, [
      String(reqId),
      "10",
      "125.5",
      "450.25",
      "0",
      "2000",
    ]);

    const response = await responsePromise;
    expect(response.reqId).toBe(reqId);
    expect(response.account).toBe("DU123");
    expect(response.conid).toBe(265598);
    expect(response.position).toBe("10");
    expect(response.dailyPnL).toBe(125.5);
    expect(response.unrealizedPnL).toBe(450.25);
    expect(response.realizedPnL).toBe(0);
    expect(response.value).toBe(2000);
    expect(typeof response.receivedAt).toBe("string");
    expect(writes).toHaveLength(2);
    expect(readBigEndianInt(writes[1]!, 4)).toBe(OUTGOING.CANCEL_PNL_SINGLE);
    expect(splitNullFields(writes[1]!.slice(8))).toEqual([String(reqId)]);
  });

  test("requestAccountPnLSnapshot keeps an active account subscription and reuses the latest update", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.requestAccountPnLSnapshot({
      account: "DU123",
      timeoutMs: 5000,
    });
    const reqId = extractFirstFieldAsInt(writes[0]!);

    expect(readBigEndianInt(writes[0]!, 4)).toBe(OUTGOING.REQ_PNL);
    expect(splitNullFields(writes[0]!.slice(8))).toEqual([
      String(reqId),
      "DU123",
      "",
    ]);

    dispatchMessage(client, INCOMING.PNL, [
      String(reqId),
      "125.5",
      "450.25",
      "12.5",
    ]);

    const firstResponse = await responsePromise;
    expect(firstResponse.reqId).toBe(reqId);
    expect(firstResponse.account).toBe("DU123");
    expect(firstResponse.dailyPnL).toBe(125.5);
    expect(firstResponse.unrealizedPnL).toBe(450.25);
    expect(firstResponse.realizedPnL).toBe(12.5);

    const secondResponse = await client.requestAccountPnLSnapshot({
      account: "DU123",
      timeoutMs: 5000,
    });

    expect(secondResponse.reqId).toBe(reqId);
    expect(secondResponse.dailyPnL).toBe(125.5);
    expect(writes).toHaveLength(1);
  });

  test("requestHeldStockPnLSnapshots batches held stock positions", async () => {
    class PnLBatchClient extends TwsGatewayClient {
      override async requestPositions(): Promise<PositionsResponse> {
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
                symbol: "ES",
                secType: "FUT",
                lastTradeDateOrContractMonth: "",
                strike: null,
                right: "",
                multiplier: "",
                exchange: "GLOBEX",
                currency: "USD",
                localSymbol: "ES",
                tradingClass: "",
              },
              position: "1",
              averageCost: 5000,
            },
          ],
        };
      }

      override async requestStockPnLSnapshot() {
        return {
          reqId: 1,
          account: "DU123",
          modelCode: "",
          conid: 1,
          position: "10",
          dailyPnL: 25,
          unrealizedPnL: 100,
          realizedPnL: 0,
          value: 2000,
          receivedAt: "2026-03-04T00:00:00.000Z",
        };
      }
    }

    const client = new PnLBatchClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    await expect(client.requestHeldStockPnLSnapshots()).resolves.toEqual({
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
            reqId: 1,
            account: "DU123",
            modelCode: "",
            conid: 1,
            position: "10",
            dailyPnL: 25,
            unrealizedPnL: 100,
            realizedPnL: 0,
            value: 2000,
            receivedAt: "2026-03-04T00:00:00.000Z",
          },
          error: null,
        },
      ],
      totals: {
        requested: 1,
        completed: 1,
        failed: 0,
      },
    });
  });

  test("previewStockOrderWhatIf allocates distinct order IDs for concurrent requests", async () => {
    const { client } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 300,
    });

    const firstPreview = client.previewStockOrderWhatIf({
      symbol: "AAPL",
      action: "BUY",
      quantity: 1,
      orderType: "MKT",
      timeoutMs: 5000,
    });
    const secondPreview = client.previewStockOrderWhatIf({
      symbol: "AAPL",
      action: "BUY",
      quantity: 2,
      orderType: "MKT",
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildOpenOrderPreviewPayload({
        orderId: 300,
        status: "PreSubmitted",
        initMarginChange: 100,
        maintMarginChange: 80,
        commissionAndFees: 1.1,
        commissionAndFeesCurrency: "USD",
        marginCurrency: "USD",
        warningText: "preview-300",
      }),
    );
    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildOpenOrderPreviewPayload({
        orderId: 301,
        status: "PreSubmitted",
        initMarginChange: 200,
        maintMarginChange: 160,
        commissionAndFees: 1.2,
        commissionAndFeesCurrency: "USD",
        marginCurrency: "USD",
        warningText: "preview-301",
      }),
    );

    const [firstResult, secondResult] = await Promise.all([
      firstPreview,
      secondPreview,
    ]);
    const orderIds = [firstResult.orderId, secondResult.orderId].sort((left, right) => left - right);
    expect(orderIds).toEqual([300, 301]);
  });

  test("previewStockOrderWhatIf sends a protobuf placeOrder request and resolves from openOrder", async () => {
    const { client, writes } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 77,
    });
    const state = client as unknown as MutableClientState;
    const responsePromise = client.previewStockOrderWhatIf({
      symbol: "AAPL",
      action: "BUY",
      quantity: 1,
      orderType: "LMT",
      limitPrice: 189.5,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(
      OUTGOING.PLACE_ORDER + PROTOCOL.protoBufMessageOffset,
    );
    expect(state.nextValidOrderId).toBe(78);

    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildOpenOrderPreviewPayload({
        orderId: 77,
        status: "PreSubmitted",
        initMarginChange: 1250.5,
        maintMarginChange: 980.25,
        commissionAndFees: 1.23,
        commissionAndFeesCurrency: "USD",
        marginCurrency: "USD",
        warningText: "This is a preview.",
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      orderId: 77,
      requestedOrder: {
        symbol: "AAPL",
        action: "BUY",
        quantity: "1",
        orderType: "LMT",
        limitPrice: 189.5,
        tif: "DAY",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
        account: "DU123",
        outsideRth: false,
      },
      preview: {
        status: "PreSubmitted",
        initMarginBefore: null,
        maintMarginBefore: null,
        equityWithLoanBefore: null,
        initMarginChange: 1250.5,
        maintMarginChange: 980.25,
        equityWithLoanChange: null,
        initMarginAfter: null,
        maintMarginAfter: null,
        equityWithLoanAfter: null,
        commissionAndFees: 1.23,
        minCommissionAndFees: null,
        maxCommissionAndFees: null,
        commissionAndFeesCurrency: "USD",
        marginCurrency: "USD",
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
        warningText: "This is a preview.",
      },
    });
  });

  test("placeStockOrder sends a live protobuf placeOrder request and resolves from orderStatus", async () => {
    const { client, writes } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 91,
    });
    const state = client as unknown as MutableClientState;
    const responsePromise = client.placeStockOrder({
      symbol: "AAPL",
      action: "BUY",
      quantity: 2,
      orderType: "LMT",
      limitPrice: 150,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(
      OUTGOING.PLACE_ORDER + PROTOCOL.protoBufMessageOffset,
    );
    expect(state.nextValidOrderId).toBe(92);

    dispatchProtoMessage(
      client,
      INCOMING.ORDER_STATUS,
      buildOrderStatusPayload({
        orderId: 91,
        status: "Submitted",
        filled: "0",
        remaining: "2",
        avgFillPrice: 0,
        permId: 12345,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      orderId: 91,
      requestedOrder: {
        symbol: "AAPL",
        action: "BUY",
        quantity: "2",
        orderType: "LMT",
        limitPrice: 150,
        tif: "DAY",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
        account: "DU123",
        outsideRth: false,
      },
      orderState: null,
      orderStatus: {
        orderId: 91,
        status: "Submitted",
        filled: "0",
        remaining: "2",
        avgFillPrice: 0,
        permId: 12345,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      },
    });
  });

  test("placeStockOrder captures both orderStatus and openOrder when they arrive close together", async () => {
    const { client } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 120,
    });
    const responsePromise = client.placeStockOrder({
      symbol: "AAPL",
      action: "BUY",
      quantity: 2,
      orderType: "LMT",
      limitPrice: 150,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    dispatchProtoMessage(
      client,
      INCOMING.ORDER_STATUS,
      buildOrderStatusPayload({
        orderId: 120,
        status: "Submitted",
        filled: "0",
        remaining: "2",
        avgFillPrice: 0,
        permId: 12345,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      }),
    );
    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildDetailedOpenOrderPayload({
        orderId: 120,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        primaryExchange: "NASDAQ",
        currency: "USD",
        action: "BUY",
        quantity: "2",
        orderType: "LMT",
        limitPrice: 150,
        tif: "DAY",
        account: "DU123",
        outsideRth: false,
        status: "Submitted",
      }),
    );

    const response = await responsePromise;
    expect(response.orderStatus?.status).toBe("Submitted");
    expect(response.orderState?.status).toBe("Submitted");
  });

  test("modifyStockOrder reuses the provided orderId and does not consume a new order id", async () => {
    const { client, writes } = createConnectedClient({
      managedAccounts: ["DU123"],
      nextValidOrderId: 91,
    });
    const state = client as unknown as MutableClientState;
    const responsePromise = client.modifyStockOrder({
      orderId: 44,
      symbol: "AAPL",
      action: "SELL",
      quantity: 3,
      orderType: "LMT",
      limitPrice: 200,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(
      OUTGOING.PLACE_ORDER + PROTOCOL.protoBufMessageOffset,
    );
    expect(state.nextValidOrderId).toBe(91);

    dispatchProtoMessage(
      client,
      INCOMING.ORDER_STATUS,
      buildOrderStatusPayload({
        orderId: 44,
        status: "Submitted",
        filled: "0",
        remaining: "3",
        avgFillPrice: 0,
        permId: 222,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      orderId: 44,
      requestedOrder: {
        orderId: 44,
        symbol: "AAPL",
        action: "SELL",
        quantity: "3",
        orderType: "LMT",
        limitPrice: 200,
        tif: "DAY",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
        account: "DU123",
        outsideRth: false,
      },
      orderState: null,
      orderStatus: {
        orderId: 44,
        status: "Submitted",
        filled: "0",
        remaining: "3",
        avgFillPrice: 0,
        permId: 222,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      },
    });
  });

  test("cancelStockOrder sends a protobuf cancelOrder request and resolves from orderStatus", async () => {
    const { client, writes } = createConnectedClient();
    const responsePromise = client.cancelStockOrder({
      orderId: 91,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    expect(writes).toHaveLength(1);
    expect(readBigEndianInt(writes[0]!, 4)).toBe(
      OUTGOING.CANCEL_ORDER + PROTOCOL.protoBufMessageOffset,
    );

    dispatchProtoMessage(
      client,
      INCOMING.ERR_MSG,
      buildErrorMessagePayload({
        id: 91,
        errorCode: 399,
        errorMessage: "Order warning",
      }),
    );

    dispatchProtoMessage(
      client,
      INCOMING.ORDER_STATUS,
      buildOrderStatusPayload({
        orderId: 91,
        status: "Cancelled",
        filled: "0",
        remaining: "2",
        avgFillPrice: 0,
        permId: 12345,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      }),
    );

    await expect(responsePromise).resolves.toEqual({
      orderId: 91,
      acknowledgedStatus: {
        orderId: 91,
        status: "Cancelled",
        filled: "0",
        remaining: "2",
        avgFillPrice: 0,
        permId: 12345,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      },
    });
  });

  test("cancelStockOrder ignores non-terminal openOrder echoes and waits for cancel status", async () => {
    const { client } = createConnectedClient();
    const responsePromise = client.cancelStockOrder({
      orderId: 55,
      timeoutMs: 5000,
    });
    await Bun.sleep(0);

    dispatchProtoMessage(
      client,
      INCOMING.OPEN_ORDER,
      buildDetailedOpenOrderPayload({
        orderId: 55,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        primaryExchange: "NASDAQ",
        currency: "USD",
        action: "SELL",
        quantity: "1",
        orderType: "LMT",
        limitPrice: 210,
        tif: "DAY",
        account: "DU123",
        outsideRth: false,
        status: "Submitted",
      }),
    );

    const earlyState = await Promise.race([
      responsePromise.then(() => "resolved"),
      Bun.sleep(30).then(() => "pending"),
    ]);
    expect(earlyState).toBe("pending");

    dispatchProtoMessage(
      client,
      INCOMING.ORDER_STATUS,
      buildOrderStatusPayload({
        orderId: 55,
        status: "Cancelled",
        filled: "0",
        remaining: "1",
        avgFillPrice: 0,
        permId: 200,
        parentId: 0,
        lastFillPrice: 0,
        clientId: 0,
        whyHeld: "",
        mktCapPrice: 0,
      }),
    );

    const response = await responsePromise;
    expect(response.acknowledgedStatus?.status).toBe("Cancelled");
  });

  test("requestGatewaySnapshot combines the current public request surfaces", async () => {
    const client = new SnapshotClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    const snapshot = await client.requestGatewaySnapshot({
      includePositions: false,
    });

    expect(snapshot.status.marketDataType).toBe(3);
    expect(snapshot.currentTime.isoTime).toBe("2024-01-01T00:00:00.000Z");
    expect(snapshot.managedAccounts.accounts).toEqual(["DU123"]);
    expect(snapshot.nextValidOrderId.orderId).toBe(100);
    expect(snapshot.accountSummary?.rows).toHaveLength(1);
    expect(snapshot.positions).toBeUndefined();
    expect(snapshot.warnings).toEqual([]);
  });

  test("requestGatewaySnapshot includes held stock snapshots when positions are included by default", async () => {
    const client = new SnapshotClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    const snapshot = await client.requestGatewaySnapshot();

    expect(snapshot.positions?.rows).toHaveLength(1);
    expect(snapshot.heldStockSnapshots).toEqual({
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
            averageCost: 200,
          },
          snapshot: buildTestMarketSnapshot("AAPL"),
          error: null,
        },
      ],
      totals: {
        requested: 1,
        completed: 1,
        failed: 0,
      },
    });
    expect(snapshot.warnings).toEqual([]);
  });

  test("requestGatewaySnapshot can include held stock snapshots without returning positions", async () => {
    const client = new SnapshotClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    const snapshot = await client.requestGatewaySnapshot({
      includePositions: false,
      includeHeldStockSnapshots: true,
    });

    expect(snapshot.positions).toBeUndefined();
    expect(snapshot.heldStockSnapshots).toEqual({
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
            averageCost: 200,
          },
          snapshot: buildTestMarketSnapshot("AAPL"),
          error: null,
        },
      ],
      totals: {
        requested: 1,
        completed: 1,
        failed: 0,
      },
    });
    expect(snapshot.warnings).toEqual([]);
  });

  test("requestGatewaySnapshot can include account live pnl", async () => {
    const client = new SnapshotClient();
    const state = client as unknown as MutableClientState;
    state.connected = true;
    state.socket = createSocketSink().socket;

    const snapshot = await client.requestGatewaySnapshot({
      includePositions: false,
      includeAccountLivePnl: true,
    });

    expect(snapshot.accountLivePnl).toEqual({
      reqId: 2,
      account: "DU123",
      modelCode: "",
      dailyPnL: 120,
      unrealizedPnL: 600,
      realizedPnL: 25,
      receivedAt: "2026-03-04T00:00:00.000Z",
    });
    expect(snapshot.warnings).toEqual([]);
  });
});

class SnapshotClient extends TwsGatewayClient {
  override getStatus(): GatewayStatus {
    return {
      connected: true,
      host: "127.0.0.1",
      port: 4002,
      clientId: 0,
      serverVersion: 203,
      connectionTime: "20260304 03:35:48 India Standard Time",
      managedAccounts: ["DU123"],
      nextValidOrderId: 100,
      marketDataType: 3,
    };
  }

  override async requestCurrentTime(): Promise<CurrentTimeResponse> {
    return {
      epochSeconds: 1_704_067_200,
      isoTime: "2024-01-01T00:00:00.000Z",
    };
  }

  override async requestManagedAccounts(): Promise<ManagedAccountsResponse> {
    return {
      accounts: ["DU123"],
      raw: "DU123",
    };
  }

  override async requestNextValidOrderId(): Promise<NextValidOrderIdResponse> {
    return {
      orderId: 100,
    };
  }

  override async requestAccountSummary(): Promise<AccountSummaryResponse> {
    return {
      reqId: 1,
      group: "All",
      tags: "NetLiquidation",
      rows: [
        {
          account: "DU123",
          tag: "NetLiquidation",
          value: "100000",
          currency: "USD",
        },
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
  }

  override async requestPositions(): Promise<PositionsResponse> {
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
          averageCost: 200,
        },
      ],
    };
  }

  override async requestMarketDataSnapshot(): Promise<MarketSnapshot> {
    return buildTestMarketSnapshot("AAPL");
  }

  override async requestAccountPnLSnapshot() {
    return {
      reqId: 2,
      account: "DU123",
      modelCode: "",
      dailyPnL: 120,
      unrealizedPnL: 600,
      realizedPnL: 25,
      receivedAt: "2026-03-04T00:00:00.000Z",
    };
  }
}

type MutableClientState = {
  connected: boolean;
  socket: {
    write: (data: Uint8Array) => void;
    flush: () => void;
    close: () => void;
    end: () => void;
  };
  serverVersion: number | null;
  managedAccounts: string[];
  nextValidOrderId: number | null;
  lastCurrentTime: CurrentTimeResponse | null;
  lastCurrentTimeReceivedAt: number;
};

function createConnectedClient(
  overrides: Partial<
    Pick<
      MutableClientState,
      "managedAccounts" | "nextValidOrderId" | "lastCurrentTime" | "lastCurrentTimeReceivedAt"
    >
  > = {},
) {
  const client = new TwsGatewayClient();
  const { socket, writes } = createSocketSink();
  const state = client as unknown as MutableClientState;

  state.connected = true;
  state.socket = socket;
  state.serverVersion = 203;
  state.managedAccounts = overrides.managedAccounts ?? [];
  state.nextValidOrderId = overrides.nextValidOrderId ?? null;
  state.lastCurrentTime = overrides.lastCurrentTime ?? null;
  state.lastCurrentTimeReceivedAt = overrides.lastCurrentTimeReceivedAt ?? 0;

  return {
    client,
    writes,
  };
}

function createSocketSink() {
  const writes: Uint8Array[] = [];

  return {
    writes,
    socket: {
      write(data: Uint8Array) {
        writes.push(Uint8Array.from(data));
      },
      flush() {},
      close() {},
      end() {},
    },
  };
}

function extractFirstFieldAsInt(message: Uint8Array): number {
  return Number(splitNullFields(message.slice(8))[0]);
}

function dispatchMessage(client: TwsGatewayClient, messageId: number, fields: string[]) {
  const internal = client as unknown as {
    dispatchMessage: (inMessageId: number, inFields: string[]) => void;
  };

  internal.dispatchMessage(messageId, fields);
}

function dispatchProtoMessage(
  client: TwsGatewayClient,
  messageId: number,
  payload: Uint8Array,
) {
  const internal = client as unknown as {
    processModernFrame: (frame: Uint8Array) => void;
  };
  const frame = new Uint8Array(4 + payload.byteLength);

  frame.set(toBigEndianInt(messageId + PROTOCOL.protoBufMessageOffset), 0);
  frame.set(payload, 4);
  internal.processModernFrame(frame);
}

function buildOpenOrderPreviewPayload(input: {
  orderId: number;
  status: string;
  initMarginChange: number;
  maintMarginChange: number;
  commissionAndFees: number;
  commissionAndFeesCurrency: string;
  marginCurrency: string;
  warningText: string;
}): Uint8Array {
  return encodeMessage([
    encodeVarintField(1, input.orderId),
    encodeMessageField(
      4,
      encodeMessage([
        encodeStringField(1, input.status),
        encodeDoubleField(5, input.initMarginChange),
        encodeDoubleField(6, input.maintMarginChange),
        encodeDoubleField(11, input.commissionAndFees),
        encodeStringField(14, input.commissionAndFeesCurrency),
        encodeStringField(15, input.marginCurrency),
        encodeStringField(28, input.warningText),
      ]),
    ),
  ]);
}

function buildDetailedOpenOrderPayload(input: {
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
  action: string;
  quantity: string;
  orderType: string;
  limitPrice: number;
  tif: string;
  account: string;
  outsideRth: boolean;
  status: string;
}): Uint8Array {
  return encodeMessage([
    encodeVarintField(1, input.orderId),
    encodeMessageField(
      2,
      encodeMessage([
        encodeStringField(2, input.symbol),
        encodeStringField(3, input.secType),
        encodeStringField(8, input.exchange),
        encodeStringField(9, input.primaryExchange),
        encodeStringField(10, input.currency),
      ]),
    ),
    encodeMessageField(
      3,
      encodeMessage([
        encodeStringField(5, input.action),
        encodeStringField(6, input.quantity),
        encodeStringField(8, input.orderType),
        encodeDoubleField(9, input.limitPrice),
        encodeStringField(11, input.tif),
        encodeStringField(12, input.account),
        encodeVarintField(19, input.outsideRth ? 1 : 0),
      ]),
    ),
    encodeMessageField(
      4,
      encodeMessage([
        encodeStringField(1, input.status),
      ]),
    ),
  ]);
}

function buildErrorMessagePayload(input: {
  id: number;
  errorCode: number;
  errorMessage: string;
}): Uint8Array {
  return encodeMessage([
    encodeVarintField(1, input.id),
    encodeVarintField(3, input.errorCode),
    encodeStringField(4, input.errorMessage),
  ]);
}

function buildOrderStatusPayload(input: {
  orderId: number;
  status: string;
  filled: string;
  remaining: string;
  avgFillPrice: number;
  permId: number;
  parentId: number;
  lastFillPrice: number;
  clientId: number;
  whyHeld: string;
  mktCapPrice: number;
}): Uint8Array {
  return encodeMessage([
    encodeVarintField(1, input.orderId),
    encodeStringField(2, input.status),
    encodeStringField(3, input.filled),
    encodeStringField(4, input.remaining),
    encodeDoubleField(5, input.avgFillPrice),
    encodeVarintField(6, input.permId),
    encodeVarintField(7, input.parentId),
    encodeDoubleField(8, input.lastFillPrice),
    encodeVarintField(9, input.clientId),
    encodeStringField(10, input.whyHeld),
    encodeDoubleField(11, input.mktCapPrice),
  ]);
}

function buildTestMarketSnapshot(symbol: string): MarketSnapshot {
  return {
    reqId: 1,
    contract: {
      symbol,
      secType: "STK",
      exchange: "SMART",
      primaryExchange: "",
      currency: "USD",
    },
    fields: {
      last: 210.5,
      bid: 210.4,
      ask: 210.6,
      volume: 1_250_000,
    },
    rawTicks: {},
    warnings: [],
    completed: true,
    timedOut: false,
  };
}

function encodeMessage(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  return encodeMessage([
    encodeVarint((fieldNumber << 3) | 0),
    encodeVarint(value),
  ]);
}

function encodeDoubleField(fieldNumber: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);

  return encodeMessage([
    encodeVarint((fieldNumber << 3) | 1),
    bytes,
  ]);
}

function encodeStringField(fieldNumber: number, value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return encodeMessage([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(encoded.byteLength),
    encoded,
  ]);
}

function encodeMessageField(fieldNumber: number, value: Uint8Array): Uint8Array {
  return encodeMessage([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(value.byteLength),
    value,
  ]);
}

function encodeVarint(value: number): Uint8Array {
  let remaining = value;
  const bytes: number[] = [];

  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;

    if (remaining > 0) {
      byte |= 0x80;
    }

    bytes.push(byte);
  } while (remaining > 0);

  return Uint8Array.from(bytes);
}
