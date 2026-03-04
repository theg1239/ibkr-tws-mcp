import {
  applyTickValue,
  appendBytes,
  createDeferred,
  DEFAULT_ACCOUNT_SUMMARY_TAGS,
  DEFAULT_GATEWAY_CONFIG,
  deadlineError,
  encodeApiMessage,
  encodeProtoApiMessage,
  INCOMING,
  joinAccountsList,
  MARKET_DATA_TYPE_LABELS,
  OUTGOING,
  parseDecimalField,
  parseFloatField,
  parseIntField,
  parseProtobufErrorMessage,
  PRICE_TICK_TO_SIZE_TICK,
  PROTOCOL,
  readBigEndianInt,
  splitNullFields,
  toBigEndianInt,
} from "./protocol.ts";
import {
  buildCancelOrderProtoPayload,
  buildPlaceOrderSubmitProtoPayload,
  buildPlaceOrderWhatIfProtoPayload,
  parseOrderStatusProto,
  parseOpenOrderProto,
} from "./order-preview-protobuf.ts";
import type {
  AccountPnLSnapshot,
  AccountPnLSnapshotRequestOptions,
  ActiveAccountPnLSubscription,
  AccountSummaryRequestOptions,
  AccountSummaryResponse,
  BunSocket,
  CurrentTimeResponse,
  Deferred,
  GatewayConnectOptions,
  GatewaySnapshotRequestOptions,
  GatewaySnapshotResponse,
  GatewayStatus,
  HeldStockPnLSnapshotsRequestOptions,
  HeldStockPnLSnapshotsResponse,
  HeldStockSnapshotsRequestOptions,
  HeldStockSnapshotsResponse,
  MarketDataType,
  MarketDataTypeResponse,
  ManagedAccountsResponse,
  MarketDataSnapshotRequestOptions,
  MarketSnapshot,
  StockMarketSnapshotsRequestOptions,
  StockMarketSnapshotsResponse,
  NextValidOrderIdResponse,
  OpenStockOrdersResponse,
  ParsedErrorMessage,
  PendingAccountSummary,
  PendingOpenStockOrders,
  PendingMarketData,
  PendingStockPnLSnapshot,
  PendingStockOrderCancel,
  PendingStockOrderPlacement,
  PendingPositions,
  PendingStockOrderPreview,
  PendingStockHistoricalBars,
  PendingStockScanner,
  PendingStockSymbolSearch,
  PositionsRequestOptions,
  PositionsResponse,
  ProtocolField,
  SharedRequest,
  SocketBuffer,
  PositionRow,
  StockHistoricalBar,
  StockHistoricalBarsRequestOptions,
  StockHistoricalBarsResponse,
  StockOrderCancelRequestOptions,
  StockOrderCancellationResponse,
  StockOrderModificationResponse,
  StockOrderModifyRequest,
  StockOrderModifyRequestOptions,
  StockOrderPlaceRequestOptions,
  StockOrderPlacementResponse,
  StockOrderPreviewRequestOptions,
  StockOrderPreviewResponse,
  StockOrderRequest,
  StockOrderRequestOptions,
  StockOpenOrder,
  StockPnLSnapshot,
  StockPnLSnapshotRequestOptions,
  StockOrderStatus,
  StockScannerRequestOptions,
  StockScannerResponse,
  StockScannerRow,
  StockSymbolMatch,
  StockSymbolSearchRequestOptions,
  StockSymbolSearchResponse,
  Timer,
  TickValue,
} from "./types.ts";

const handshakeEncoder = new TextEncoder();

export class TwsGatewayClient {
  private socket: BunSocket | null = null;
  private buffer: SocketBuffer = new Uint8Array(0);
  private ready: Deferred<GatewayStatus> | null = null;
  private connected = false;
  private host: string | null = null;
  private port: number | null = null;
  private clientId: number | null = null;
  private serverVersion: number | null = null;
  private connectionTime: string | null = null;
  private connectReadyAfter = 0;
  private connectReadyTimer: Timer | null = null;
  private connectBootstrapTimeoutId: Timer | null = null;
  private lastCurrentTime: CurrentTimeResponse | null = null;
  private lastCurrentTimeReceivedAt = 0;
  private nextValidOrderId: number | null = null;
  private managedAccounts: string[] = [];
  private marketDataType: MarketDataType | null = null;
  private reqIdCounter = 1_000_000;
  private accountPnLSubscriptions = new Map<string, ActiveAccountPnLSubscription>();
  private accountPnLReqIdToKey = new Map<number, string>();
  private orderIdLock: Promise<void> = Promise.resolve();

  private currentTimeRequest: SharedRequest<CurrentTimeResponse> | null = null;
  private managedAccountsRequest: SharedRequest<ManagedAccountsResponse> | null = null;
  private nextOrderIdRequest: SharedRequest<NextValidOrderIdResponse> | null = null;
  private positionsRequest: PendingPositions | null = null;
  private openStockOrdersRequest: PendingOpenStockOrders | null = null;
  private accountSummaryRequests = new Map<number, PendingAccountSummary>();
  private marketDataRequests = new Map<number, PendingMarketData>();
  private stockPnLSnapshotRequests = new Map<number, PendingStockPnLSnapshot>();
  private stockSymbolSearchRequests = new Map<number, PendingStockSymbolSearch>();
  private stockScannerRequests = new Map<number, PendingStockScanner>();
  private stockHistoricalBarsRequests = new Map<number, PendingStockHistoricalBars>();
  private stockOrderPreviewRequests = new Map<number, PendingStockOrderPreview>();
  private stockOrderPlacementRequests = new Map<number, PendingStockOrderPlacement>();
  private stockOrderCancelRequests = new Map<number, PendingStockOrderCancel>();

  async connect(options: GatewayConnectOptions = {}): Promise<GatewayStatus> {
    const host = options.host?.trim() || DEFAULT_GATEWAY_CONFIG.host;
    const port = options.port ?? DEFAULT_GATEWAY_CONFIG.port;
    const clientId = options.clientId ?? DEFAULT_GATEWAY_CONFIG.clientId;

    if (this.connected && this.host === host && this.port === port && this.clientId === clientId) {
      return this.getStatus();
    }

    if (this.socket) {
      this.disconnect();
    }

    this.resetSessionState();
    this.host = host;
    this.port = port;
    this.clientId = clientId;
    this.ready = createDeferred();

    try {
      await Bun.connect({
        hostname: host,
        port,
        socket: {
          binaryType: "uint8array",
          open: (socket) => {
            this.socket = socket;
            this.sendHandshake();
          },
          data: (_socket, chunk) => {
            this.handleData(chunk);
          },
          error: (_socket, error) => {
            if (this.isSessionClosed()) {
              return;
            }
            this.handleSocketFailure(error);
          },
          close: () => {
            if (this.isSessionClosed()) {
              return;
            }
            this.handleSocketFailure(new Error("Socket closed."));
          },
          end: () => {
            if (this.isSessionClosed()) {
              return;
            }
            this.handleSocketFailure(new Error("Socket ended by remote host."));
          },
          connectError: (_socket, error) => {
            if (this.isSessionClosed()) {
              return;
            }
            this.handleSocketFailure(error);
          },
        },
      });
    } catch (error) {
      this.handleSocketFailure(error);
    }

    if (!this.ready) {
      throw new Error("Connection failed before initialization.");
    }

    return await this.ready.promise;
  }

  disconnect(): GatewayStatus {
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // Ignore shutdown races.
      }
    }

    this.handleSocketFailure(new Error("Disconnected."));
    return this.getStatus();
  }

  getStatus(): GatewayStatus {
    return {
      connected: this.connected,
      host: this.host,
      port: this.port,
      clientId: this.clientId,
      serverVersion: this.serverVersion,
      connectionTime: this.connectionTime,
      managedAccounts: [...this.managedAccounts],
      nextValidOrderId: this.nextValidOrderId,
      marketDataType: this.marketDataType,
    };
  }

  getMarketDataType(): MarketDataTypeResponse {
    return this.describeMarketDataType();
  }

  setMarketDataType(marketDataType: MarketDataType): MarketDataTypeResponse {
    this.ensureConnected();
    this.applyMarketDataTypePreference(this.normalizeMarketDataType(marketDataType));
    return this.describeMarketDataType();
  }

  async requestAccountPnLSnapshot(
    options: AccountPnLSnapshotRequestOptions,
  ): Promise<AccountPnLSnapshot> {
    this.ensureConnected();

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerPnl) {
      throw new Error("The connected gateway version does not support reqPnL.");
    }

    const account = options.account.trim();
    if (!account) {
      throw new Error("account is required.");
    }

    const modelCode = options.modelCode?.trim() || "";
    const subscriptionKey = this.toAccountPnLSubscriptionKey(account, modelCode);
    const existing = this.accountPnLSubscriptions.get(subscriptionKey);

    if (
      existing &&
      existing.latest !== null &&
      Date.now() - existing.lastUpdatedAt <= PROTOCOL.accountPnlCacheMs
    ) {
      return existing.latest;
    }

    if (existing && existing.latest !== null) {
      // Keep serving the active subscription snapshot instead of waiting for a fresh
      // event every call. The subscription stays open and will update in the background.
      return existing.latest;
    }

    if (existing) {
      return await this.waitForAccountPnLUpdate(existing, options.timeoutMs ?? 8000);
    }

    const reqId = this.nextReqId();
    const subscription: ActiveAccountPnLSubscription = {
      reqId,
      account,
      modelCode,
      latest: null,
      lastUpdatedAt: 0,
      waiters: [],
    };
    this.accountPnLSubscriptions.set(subscriptionKey, subscription);
    this.accountPnLReqIdToKey.set(reqId, subscriptionKey);
    this.sendMessage(OUTGOING.REQ_PNL, [reqId, account, modelCode]);

    return await this.waitForAccountPnLUpdate(subscription, options.timeoutMs ?? 8000);
  }

  async requestManagedAccounts(timeoutMs = 8000): Promise<ManagedAccountsResponse> {
    this.ensureConnected();

    if (this.managedAccounts.length > 0) {
      return {
        accounts: [...this.managedAccounts],
        raw: this.managedAccounts.join(","),
      };
    }

    if (this.managedAccountsRequest) {
      return await this.managedAccountsRequest.deferred.promise;
    }

    const deferred = createDeferred<ManagedAccountsResponse>();
    const timeoutId = setTimeout(() => {
      this.managedAccountsRequest = null;
      deferred.reject(deadlineError("Managed accounts request", timeoutMs));
    }, timeoutMs);

    this.managedAccountsRequest = { deferred, timeoutId };
    this.sendMessage(OUTGOING.REQ_MANAGED_ACCTS, [1]);
    return await deferred.promise;
  }

  async requestCurrentTime(timeoutMs = 8000): Promise<CurrentTimeResponse> {
    this.ensureConnected();

    if (this.currentTimeRequest) {
      return await this.currentTimeRequest.deferred.promise;
    }

    const deferred = createDeferred<CurrentTimeResponse>();
    const timeoutId = setTimeout(() => {
      this.currentTimeRequest = null;
      deferred.reject(deadlineError("Current time request", timeoutMs));
    }, timeoutMs);

    this.currentTimeRequest = { deferred, timeoutId };
    this.sendMessage(OUTGOING.REQ_CURRENT_TIME, [1]);
    return await deferred.promise;
  }

  async requestNextValidOrderId(timeoutMs = 8000): Promise<NextValidOrderIdResponse> {
    this.ensureConnected();

    if (this.nextValidOrderId !== null) {
      return { orderId: this.nextValidOrderId };
    }

    if (this.nextOrderIdRequest) {
      return await this.nextOrderIdRequest.deferred.promise;
    }

    const deferred = createDeferred<NextValidOrderIdResponse>();
    const timeoutId = setTimeout(() => {
      this.nextOrderIdRequest = null;
      deferred.reject(deadlineError("Next valid order ID request", timeoutMs));
    }, timeoutMs);

    this.nextOrderIdRequest = { deferred, timeoutId };
    this.sendMessage(OUTGOING.REQ_IDS, [1, 1]);
    return await deferred.promise;
  }

  async requestAccountSummary(
    options: AccountSummaryRequestOptions = {},
  ): Promise<AccountSummaryResponse> {
    this.ensureConnected();

    const timeoutMs = options.timeoutMs ?? 10000;
    const reqId = this.nextReqId();
    const group = options.group?.trim() || "All";
    const tags = options.tags?.trim() || DEFAULT_ACCOUNT_SUMMARY_TAGS;
    const deferred = createDeferred<AccountSummaryResponse>();

    const timeoutId = setTimeout(() => {
      this.accountSummaryRequests.delete(reqId);
      this.trySendMessage(OUTGOING.CANCEL_ACCOUNT_SUMMARY, [1, reqId]);
      deferred.reject(deadlineError(`Account summary request ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.accountSummaryRequests.set(reqId, {
      deferred,
      rows: [],
      group,
      tags,
      timeoutId,
    });

    this.sendMessage(OUTGOING.REQ_ACCOUNT_SUMMARY, [1, reqId, group, tags]);
    return await deferred.promise;
  }

  async requestPositions(
    options: PositionsRequestOptions = {},
  ): Promise<PositionsResponse> {
    this.ensureConnected();

    if (this.positionsRequest) {
      return await this.positionsRequest.deferred.promise;
    }

    const timeoutMs = options.timeoutMs ?? 10000;
    const deferred = createDeferred<PositionsResponse>();

    const timeoutId = setTimeout(() => {
      this.positionsRequest = null;
      this.trySendMessage(OUTGOING.CANCEL_POSITIONS, [1]);
      deferred.reject(deadlineError("Positions request", timeoutMs));
    }, timeoutMs);

    this.positionsRequest = {
      deferred,
      rows: [],
      timeoutId,
    };

    this.sendMessage(OUTGOING.REQ_POSITIONS, [1]);
    return await deferred.promise;
  }

  async requestOpenStockOrders(timeoutMs = 8000): Promise<OpenStockOrdersResponse> {
    this.ensureConnected();

    if (this.openStockOrdersRequest) {
      return await this.openStockOrdersRequest.deferred.promise;
    }

    const deferred = createDeferred<OpenStockOrdersResponse>();
    const timeoutId = setTimeout(() => {
      this.openStockOrdersRequest = null;
      deferred.reject(deadlineError("Open stock orders request", timeoutMs));
    }, timeoutMs);

    this.openStockOrdersRequest = {
      deferred,
      orders: [],
      timeoutId,
    };

    this.sendMessage(OUTGOING.REQ_OPEN_ORDERS, [1]);
    return await deferred.promise;
  }

  async requestHeldStockSnapshots(
    options: HeldStockSnapshotsRequestOptions = {},
  ): Promise<HeldStockSnapshotsResponse> {
    this.ensureConnected();

    const positions = options.positions ?? (await this.requestPositions({
      timeoutMs: options.timeoutMs,
    }));
    const heldStockPositions = positions.rows.filter((row) => this.isHeldStockPosition(row));
    const requested = heldStockPositions.length;

    if (requested === 0) {
      return {
        items: [],
        totals: {
          requested: 0,
          completed: 0,
          failed: 0,
        },
      };
    }

    const items = await this.mapWithConcurrency(heldStockPositions, 4, async (position) => {
      const listingExchange = position.contract.exchange.trim().toUpperCase();
      const primaryExchange =
        listingExchange && listingExchange !== "SMART" ? listingExchange : "";

      try {
        const snapshot = await this.requestMarketDataSnapshot({
          symbol: position.contract.symbol,
          secType: "STK",
          exchange: "SMART",
          primaryExchange,
          currency: position.contract.currency || "USD",
          marketDataType:
            options.marketDataType ?? this.marketDataType ?? 3,
          timeoutMs: options.timeoutMs,
        });

        return {
          position,
          snapshot,
          error: null,
        };
      } catch (error) {
        return {
          position,
          snapshot: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const completed = items.filter((item) => item.snapshot !== null).length;

    return {
      items,
      totals: {
        requested,
        completed,
        failed: requested - completed,
      },
    };
  }

  async requestStockPnLSnapshot(
    options: StockPnLSnapshotRequestOptions,
  ): Promise<StockPnLSnapshot> {
    this.ensureConnected();

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerPnl) {
      throw new Error("The connected gateway version does not support reqPnLSingle.");
    }

    const account = options.account.trim();
    if (!account) {
      throw new Error("account is required.");
    }

    if (!Number.isInteger(options.conid) || options.conid <= 0) {
      throw new Error("conid must be a positive integer.");
    }

    const reqId = this.nextReqId();
    const timeoutMs = options.timeoutMs ?? 8000;
    const deferred = createDeferred<StockPnLSnapshot>();
    const modelCode = options.modelCode?.trim() || "";
    const timeoutId = setTimeout(() => {
      this.stockPnLSnapshotRequests.delete(reqId);
      this.trySendMessage(OUTGOING.CANCEL_PNL_SINGLE, [reqId]);
      deferred.reject(deadlineError(`Stock PnL snapshot ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.stockPnLSnapshotRequests.set(reqId, {
      deferred,
      account,
      modelCode,
      conid: options.conid,
      timeoutId,
    });

    this.sendMessage(OUTGOING.REQ_PNL_SINGLE, [
      reqId,
      account,
      modelCode,
      options.conid,
    ]);

    return await deferred.promise;
  }

  async requestHeldStockPnLSnapshots(
    options: HeldStockPnLSnapshotsRequestOptions = {},
  ): Promise<HeldStockPnLSnapshotsResponse> {
    this.ensureConnected();

    const positions = options.positions ?? (await this.requestPositions({
      timeoutMs: options.timeoutMs,
    }));
    const heldStockPositions = positions.rows.filter((row) => this.isHeldStockPosition(row));
    const requested = heldStockPositions.length;

    if (requested === 0) {
      return {
        items: [],
        totals: {
          requested: 0,
          completed: 0,
          failed: 0,
        },
      };
    }

    const items = await this.mapWithConcurrency(heldStockPositions, 4, async (position) => {
      try {
        const pnl = await this.requestStockPnLSnapshot({
          account: position.account,
          conid: position.contract.conid,
          modelCode: options.modelCode,
          timeoutMs: options.timeoutMs,
        });

        return {
          position,
          pnl,
          error: null,
        };
      } catch (error) {
        return {
          position,
          pnl: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const completed = items.filter((item) => item.pnl !== null).length;

    return {
      items,
      totals: {
        requested,
        completed,
        failed: requested - completed,
      },
    };
  }

  async requestStockScanner(
    options: StockScannerRequestOptions,
  ): Promise<StockScannerResponse> {
    this.ensureConnected();

    const scanCode = options.scanCode.trim().toUpperCase();
    if (!scanCode) {
      throw new Error("scanCode is required.");
    }

    const timeoutMs = options.timeoutMs ?? 8000;
    const reqId = this.nextReqId();
    const deferred = createDeferred<StockScannerResponse>();
    const instrument = options.instrument?.trim().toUpperCase() || "STK";
    const locationCode = options.locationCode?.trim().toUpperCase() || "STK.US.MAJOR";
    const numberOfRows = options.numberOfRows ?? 10;
    const timeoutId = setTimeout(() => {
      this.stockScannerRequests.delete(reqId);
      this.trySendMessage(OUTGOING.CANCEL_SCANNER_SUBSCRIPTION, [1, reqId]);
      deferred.reject(deadlineError(`Stock scanner ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.stockScannerRequests.set(reqId, {
      deferred,
      scanCode,
      instrument,
      locationCode,
      timeoutId,
    });

    const fields: ProtocolField[] = [];

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerScannerGenericOpts) {
      fields.push(4);
    }

    fields.push(
      reqId,
      numberOfRows,
      instrument,
      locationCode,
      scanCode,
      options.abovePrice,
      options.belowPrice,
      options.aboveVolume,
      options.marketCapAbove,
      options.marketCapBelow,
      "",
      "",
      "",
      "",
      "",
      "",
      null,
      null,
      false,
      null,
      "",
      options.stockTypeFilter?.trim().toUpperCase() || "",
    );

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerScannerGenericOpts) {
      fields.push("");
    }

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerLinking) {
      fields.push("");
    }

    this.sendMessage(OUTGOING.REQ_SCANNER_SUBSCRIPTION, fields);
    return await deferred.promise;
  }

  private async waitForAccountPnLUpdate(
    subscription: ActiveAccountPnLSubscription,
    timeoutMs: number,
  ): Promise<AccountPnLSnapshot> {
    const deferred = createDeferred<AccountPnLSnapshot>();
    const timeoutId = setTimeout(() => {
      this.removeAccountPnLWaiter(subscription.reqId, deferred);
      deferred.reject(deadlineError(`Account PnL snapshot ${subscription.reqId}`, timeoutMs));
    }, timeoutMs);

    subscription.waiters.push({
      deferred,
      timeoutId,
    });

    return await deferred.promise;
  }

  async requestMarketDataSnapshot(
    options: MarketDataSnapshotRequestOptions,
  ): Promise<MarketSnapshot> {
    this.ensureConnected();

    const timeoutMs = options.timeoutMs ?? 6000;
    const reqId = this.nextReqId();
    const snapshot: MarketSnapshot = {
      reqId,
      contract: {
        symbol: options.symbol.trim().toUpperCase(),
        secType: (options.secType?.trim() || "STK").toUpperCase(),
        exchange: options.exchange?.trim() || "SMART",
        primaryExchange: options.primaryExchange?.trim() || "",
        currency: options.currency?.trim() || "USD",
      },
      fields: {},
      rawTicks: {},
      warnings: [],
      completed: false,
      timedOut: false,
    };

    const deferred = createDeferred<MarketSnapshot>();
    const timeoutId = setTimeout(() => {
      const pending = this.marketDataRequests.get(reqId);
      if (!pending) {
        return;
      }

      this.marketDataRequests.delete(reqId);
      pending.snapshot.timedOut = true;
      this.trySendMessage(OUTGOING.CANCEL_MKT_DATA, [1, reqId]);

      if (
        Object.keys(pending.snapshot.fields).length > 0 ||
        pending.snapshot.warnings.length > 0
      ) {
        pending.deferred.resolve(pending.snapshot);
        return;
      }

      pending.deferred.reject(deadlineError(`Market data snapshot ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.marketDataRequests.set(reqId, {
      deferred,
      snapshot,
      timeoutId,
    });

    const requestedMarketDataType = options.marketDataType;
    if (requestedMarketDataType !== undefined) {
      this.requestMarketDataType(
        this.normalizeMarketDataType(requestedMarketDataType),
      );
    } else if (this.marketDataType) {
      this.requestMarketDataType(this.marketDataType);
    }

    this.sendMessage(OUTGOING.REQ_MKT_DATA, [
      11,
      reqId,
      0,
      snapshot.contract.symbol,
      snapshot.contract.secType,
      "",
      "",
      "",
      "",
      snapshot.contract.exchange,
      snapshot.contract.primaryExchange,
      snapshot.contract.currency,
      "",
      "",
      false,
      options.genericTickList?.trim() || "",
      true,
      options.regulatorySnapshot ?? false,
      "",
    ]);

    return await deferred.promise;
  }

  async requestStockMarketSnapshots(
    options: StockMarketSnapshotsRequestOptions,
  ): Promise<StockMarketSnapshotsResponse> {
    this.ensureConnected();

    const symbols = this.normalizeSnapshotSymbols(options.symbols);
    if (symbols.length === 0) {
      throw new Error("At least one symbol is required.");
    }

    const batchConcurrency = this.normalizeBatchConcurrency(options.batchConcurrency);
    const items = await this.mapWithConcurrency(symbols, batchConcurrency, async (symbol) => {
      try {
        const snapshot = await this.requestMarketDataSnapshot({
          symbol,
          secType: options.secType,
          exchange: options.exchange,
          primaryExchange: options.primaryExchange,
          currency: options.currency,
          marketDataType: options.marketDataType,
          genericTickList: options.genericTickList,
          regulatorySnapshot: options.regulatorySnapshot,
          timeoutMs: options.timeoutMs,
        });

        return {
          symbol,
          snapshot,
          error: null,
        };
      } catch (error) {
        return {
          symbol,
          snapshot: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const completed = items.filter((item) => item.snapshot !== null).length;
    const warnings = items.flatMap((item) => [
      ...(item.error ? [`snapshot_error:${item.symbol}:${item.error}`] : []),
      ...(item.snapshot?.warnings.map(
        (warning) => `snapshot_warning:${item.symbol}:${warning}`,
      ) ?? []),
    ]);

    return {
      items,
      totals: {
        requested: symbols.length,
        completed,
        failed: symbols.length - completed,
      },
      warnings,
    };
  }

  async searchStockSymbols(
    options: StockSymbolSearchRequestOptions,
  ): Promise<StockSymbolSearchResponse> {
    this.ensureConnected();

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerReqMatchingSymbols) {
      throw new Error("The connected gateway version does not support stock symbol search.");
    }

    const pattern = options.pattern.trim();
    if (!pattern) {
      throw new Error("pattern is required.");
    }

    const timeoutMs = options.timeoutMs ?? 8000;
    const reqId = this.nextReqId();
    const deferred = createDeferred<StockSymbolSearchResponse>();
    const timeoutId = setTimeout(() => {
      this.stockSymbolSearchRequests.delete(reqId);
      deferred.reject(deadlineError(`Stock symbol search ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.stockSymbolSearchRequests.set(reqId, {
      deferred,
      pattern,
      limit: options.limit ?? 10,
      timeoutId,
    });

    this.sendMessage(OUTGOING.REQ_MATCHING_SYMBOLS, [reqId, pattern]);
    return await deferred.promise;
  }

  async requestStockHistoricalBars(
    options: StockHistoricalBarsRequestOptions,
  ): Promise<StockHistoricalBarsResponse> {
    this.ensureConnected();

    const symbol = options.symbol.trim().toUpperCase();
    if (!symbol) {
      throw new Error("symbol is required.");
    }

    const timeoutMs = options.timeoutMs ?? 15000;
    const reqId = this.nextReqId();
    const response: StockHistoricalBarsResponse = {
      reqId,
      contract: {
        symbol,
        exchange: options.exchange?.trim() || "SMART",
        primaryExchange: options.primaryExchange?.trim() || "",
        currency: options.currency?.trim() || "USD",
      },
      endDateTime: options.endDateTime?.trim() || "",
      durationStr: options.durationStr?.trim() || "2 D",
      barSizeSetting: options.barSizeSetting?.trim() || "1 hour",
      whatToShow: options.whatToShow?.trim() || "TRADES",
      useRTH: options.useRTH ?? true,
      bars: [],
      startDateTime: null,
      endDateTimeReturned: null,
    };
    const deferred = createDeferred<StockHistoricalBarsResponse>();
    const timeoutId = setTimeout(() => {
      this.stockHistoricalBarsRequests.delete(reqId);
      this.trySendMessage(OUTGOING.CANCEL_HISTORICAL_DATA, [1, reqId]);
      deferred.reject(deadlineError(`Stock historical bars request ${reqId}`, timeoutMs));
    }, timeoutMs);

    this.stockHistoricalBarsRequests.set(reqId, {
      deferred,
      response,
      timeoutId,
    });

    const fields: ProtocolField[] = [];

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerSyntRealtimeBars) {
      fields.push(6);
    }

    fields.push(reqId);

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerTradingClass) {
      fields.push(0);
    }

    fields.push(
      response.contract.symbol,
      "STK",
      "",
      "",
      "",
      "",
      response.contract.exchange,
      response.contract.primaryExchange,
      response.contract.currency,
      "",
    );

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerTradingClass) {
      fields.push("");
    }

    if ((this.serverVersion ?? 0) >= 31) {
      fields.push(false);
    }

    if ((this.serverVersion ?? 0) >= 20) {
      fields.push(response.endDateTime, response.barSizeSetting);
    }

    fields.push(response.durationStr, response.useRTH ? 1 : 0, response.whatToShow);

    if ((this.serverVersion ?? 0) > 16) {
      fields.push(1);
    }

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerSyntRealtimeBars) {
      fields.push(false);
    }

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerLinking) {
      fields.push("");
    }

    this.sendMessage(OUTGOING.REQ_HISTORICAL_DATA, fields);
    return await deferred.promise;
  }

  async requestGatewaySnapshot(
    options: GatewaySnapshotRequestOptions = {},
  ): Promise<GatewaySnapshotResponse> {
    this.ensureConnected();

    const includeAccountSummary = options.includeAccountSummary ?? true;
    const includePositions = options.includePositions ?? true;
    const includeOpenOrders = options.includeOpenOrders ?? false;
    const includeHeldStockSnapshots = options.includeHeldStockSnapshots ?? includePositions;
    const includeAccountLivePnl = options.includeAccountLivePnl ?? false;
    const needPositions = includePositions || includeHeldStockSnapshots;
    const currentTime =
      this.getCachedCurrentTime(PROTOCOL.snapshotCurrentTimeCacheMs) ??
      (await this.requestCurrentTime());
    const warnings: string[] = [];

    const [managedAccounts, nextValidOrderId, accountSummary, positions, openOrders] = await Promise.all([
      this.requestManagedAccounts(),
      this.requestNextValidOrderId(),
      includeAccountSummary
        ? this.requestAccountSummary({
            timeoutMs: options.accountSummaryTimeoutMs,
          })
        : Promise.resolve(undefined),
      needPositions
        ? this.requestPositions({
            timeoutMs: options.positionsTimeoutMs,
          })
        : Promise.resolve(undefined),
      includeOpenOrders
        ? this.requestOpenStockOrders(options.openOrdersTimeoutMs)
        : Promise.resolve(undefined),
    ]);

    const heldStockSnapshots =
      includeHeldStockSnapshots && positions
        ? await this.requestHeldStockSnapshots({
            positions,
            timeoutMs: options.heldStockSnapshotsTimeoutMs,
            marketDataType: options.heldStockSnapshotsMarketDataType,
          })
        : undefined;
    let accountLivePnl: AccountPnLSnapshot | undefined;

    if (includeAccountLivePnl) {
      const account =
        options.accountLivePnlAccount?.trim() ||
        managedAccounts.accounts[0]?.trim() ||
        "";

      if (!account) {
        warnings.push("account_live_pnl_unavailable:No managed account was available.");
      } else {
        try {
          accountLivePnl = await this.requestAccountPnLSnapshot({
            account,
            modelCode: options.accountLivePnlModelCode,
            timeoutMs: options.accountLivePnlTimeoutMs,
          });
        } catch (error) {
          warnings.push(
            `account_live_pnl_unavailable:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return {
      status: this.getStatus(),
      currentTime,
      managedAccounts,
      nextValidOrderId,
      ...(accountSummary ? { accountSummary } : {}),
      ...(includePositions && positions ? { positions } : {}),
      ...(openOrders ? { openOrders } : {}),
      ...(heldStockSnapshots ? { heldStockSnapshots } : {}),
      ...(accountLivePnl ? { accountLivePnl } : {}),
      warnings,
    };
  }

  async previewStockOrderWhatIf(
    options: StockOrderPreviewRequestOptions,
  ): Promise<StockOrderPreviewResponse> {
    this.ensureConnected();
    this.ensureProtoBufOrderSupport("what-if order previews");

    const request = await this.normalizeStockOrderRequest(options);
    const orderId = await this.consumeOrderId();
    const timeoutMs = options.timeoutMs ?? 10000;
    const deferred = createDeferred<StockOrderPreviewResponse>();
    this.assertOrderLifecycleSlotAvailable(orderId, "preview");
    const timeoutId = setTimeout(() => {
      this.stockOrderPreviewRequests.delete(orderId);
      deferred.reject(deadlineError(`Stock order preview ${orderId}`, timeoutMs));
    }, timeoutMs);

    this.stockOrderPreviewRequests.set(orderId, {
      deferred,
      request,
      timeoutId,
    });

    this.sendProtoMessage(
      OUTGOING.PLACE_ORDER,
      buildPlaceOrderWhatIfProtoPayload({
        orderId,
        clientId: this.clientId ?? DEFAULT_GATEWAY_CONFIG.clientId,
        request,
      }),
    );

    return await deferred.promise;
  }

  async placeStockOrder(
    options: StockOrderPlaceRequestOptions,
  ): Promise<StockOrderPlacementResponse> {
    this.ensureConnected();
    this.ensureProtoBufOrderSupport("stock order placement");

    const request = await this.normalizeStockOrderRequest(options);
    const orderId = await this.consumeOrderId();
    return await this.submitLiveStockOrder({
      orderId,
      request,
      timeoutMs: options.timeoutMs,
      actionLabel: "placement",
    });
  }

  async modifyStockOrder(
    options: StockOrderModifyRequestOptions,
  ): Promise<StockOrderModificationResponse> {
    this.ensureConnected();
    this.ensureProtoBufOrderSupport("stock order modification");

    if (!Number.isInteger(options.orderId) || options.orderId <= 0) {
      throw new Error("orderId must be a positive integer.");
    }

    const request = await this.normalizeStockOrderRequest(options);
    const response = await this.submitLiveStockOrder({
      orderId: options.orderId,
      request,
      timeoutMs: options.timeoutMs,
      actionLabel: "modification",
    });

    const requestedOrder: StockOrderModifyRequest = {
      orderId: response.orderId,
      ...response.requestedOrder,
    };

    return {
      orderId: response.orderId,
      requestedOrder,
      orderState: response.orderState,
      orderStatus: response.orderStatus,
    };
  }

  async cancelStockOrder(
    options: StockOrderCancelRequestOptions,
  ): Promise<StockOrderCancellationResponse> {
    this.ensureConnected();
    this.ensureProtoBufOrderSupport("stock order cancellation");

    if (!Number.isInteger(options.orderId) || options.orderId <= 0) {
      throw new Error("orderId must be a positive integer.");
    }

    const timeoutMs = options.timeoutMs ?? 10000;
    const deferred = createDeferred<StockOrderCancellationResponse>();
    const timeoutId = setTimeout(() => {
      this.stockOrderCancelRequests.delete(options.orderId);
      deferred.reject(deadlineError(`Stock order cancellation ${options.orderId}`, timeoutMs));
    }, timeoutMs);

    this.stockOrderCancelRequests.set(options.orderId, {
      deferred,
      timeoutId,
    });

    this.sendProtoMessage(OUTGOING.CANCEL_ORDER, buildCancelOrderProtoPayload(options));
    return await deferred.promise;
  }

  private ensureConnected() {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected to IB Gateway/TWS. Call connect_gateway first.");
    }
  }

  private ensureProtoBufOrderSupport(action: string) {
    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerProtoBufPlaceOrder) {
      throw new Error(
        `The connected gateway version (${this.serverVersion ?? 0}) does not support protobuf placeOrder/cancelOrder. This implementation requires serverVersion ${PROTOCOL.minServerVerProtoBufPlaceOrder} for ${action}.`,
      );
    }
  }

  private async submitLiveStockOrder(input: {
    orderId: number;
    request: StockOrderRequest;
    timeoutMs: number | undefined;
    actionLabel: "placement" | "modification";
  }): Promise<StockOrderPlacementResponse> {
    this.assertOrderLifecycleSlotAvailable(input.orderId, input.actionLabel);

    const timeoutMs = input.timeoutMs ?? 10000;
    const deferred = createDeferred<StockOrderPlacementResponse>();
    const timeoutId = setTimeout(() => {
      this.stockOrderPlacementRequests.delete(input.orderId);
      deferred.reject(deadlineError(`Stock order ${input.actionLabel} ${input.orderId}`, timeoutMs));
    }, timeoutMs);

    this.stockOrderPlacementRequests.set(input.orderId, {
      deferred,
      request: input.request,
      timeoutId,
      settleTimeoutId: null,
      orderState: null,
      orderStatus: null,
    });

    this.sendProtoMessage(
      OUTGOING.PLACE_ORDER,
      buildPlaceOrderSubmitProtoPayload({
        orderId: input.orderId,
        clientId: this.clientId ?? DEFAULT_GATEWAY_CONFIG.clientId,
        request: input.request,
      }),
    );

    return await deferred.promise;
  }

  private assertOrderLifecycleSlotAvailable(
    orderId: number,
    actionLabel: "preview" | "placement" | "modification",
  ) {
    if (this.stockOrderPreviewRequests.has(orderId)) {
      throw new Error(`A stock order preview for orderId ${orderId} is already in progress.`);
    }

    if (this.stockOrderPlacementRequests.has(orderId)) {
      throw new Error(`A stock order ${actionLabel} for orderId ${orderId} is already in progress.`);
    }

    if (this.stockOrderCancelRequests.has(orderId)) {
      throw new Error(`A stock order cancellation for orderId ${orderId} is already in progress.`);
    }
  }

  private sendHandshake() {
    if (!this.socket) {
      throw new Error("Socket is not open.");
    }

    const prefix = handshakeEncoder.encode("API\0");
    const body = handshakeEncoder.encode(
      `v${PROTOCOL.minClientVersion}..${PROTOCOL.maxClientVersion}`,
    );
    const packet = new Uint8Array(prefix.byteLength + 4 + body.byteLength);
    packet.set(prefix, 0);
    packet.set(toBigEndianInt(body.byteLength), prefix.byteLength);
    packet.set(body, prefix.byteLength + 4);
    this.socket.write(packet);
    this.socket.flush();
  }

  private sendStartApi() {
    const fields: ProtocolField[] = [2, this.clientId ?? DEFAULT_GATEWAY_CONFIG.clientId];

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerOptionalCapabilities) {
      fields.push("");
    }

    this.sendMessage(OUTGOING.START_API, fields);
  }

  private sendMessage(messageId: number, fields: ReadonlyArray<ProtocolField>) {
    if (!this.socket) {
      throw new Error("Socket is not open.");
    }

    const message = encodeApiMessage(
      messageId,
      fields,
      (this.serverVersion ?? 0) >= PROTOCOL.minServerVerProtoBuf,
    );
    this.socket.write(message);
    this.socket.flush();
  }

  private sendProtoMessage(messageId: number, payload: SocketBuffer) {
    if (!this.socket) {
      throw new Error("Socket is not open.");
    }

    const message = encodeProtoApiMessage(messageId, payload);
    this.socket.write(message);
    this.socket.flush();
  }

  private trySendMessage(messageId: number, fields: ReadonlyArray<ProtocolField>) {
    try {
      this.sendMessage(messageId, fields);
    } catch {
      // Ignore late writes during teardown.
    }
  }

  private handleData(chunk: SocketBuffer) {
    this.buffer = appendBytes(this.buffer, Uint8Array.from(chunk));
    this.processFrames();
  }

  private processFrames() {
    while (this.buffer.byteLength >= 4) {
      const frameLength = readBigEndianInt(this.buffer, 0);

      if (frameLength < 0) {
        this.handleSocketFailure(new Error(`Invalid frame length: ${frameLength}`));
        return;
      }

      if (this.buffer.byteLength < frameLength + 4) {
        return;
      }

      const frame = this.buffer.slice(4, 4 + frameLength);
      this.buffer = this.buffer.slice(4 + frameLength);

      try {
        this.processFrame(frame);
      } catch (error) {
        this.handleSocketFailure(error);
        return;
      }
    }
  }

  private processFrame(frame: SocketBuffer) {
    if (!this.connected) {
      this.processHandshakeFrame(frame);
      return;
    }

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerProtoBuf) {
      this.processModernFrame(frame);
      return;
    }

    const fields = splitNullFields(frame);
    const messageId = parseIntField(fields.shift(), 0);
    this.dispatchMessage(messageId, fields);
  }

  private processHandshakeFrame(frame: SocketBuffer) {
    const fields = splitNullFields(frame);
    const serverVersion = parseIntField(fields[0], 0);

    if (!serverVersion) {
      throw new Error("Gateway handshake did not return a server version.");
    }

    this.serverVersion = serverVersion;
    this.connectionTime = fields[1] || null;
    this.connected = true;
    this.sendStartApi();
    this.scheduleReadyResolution();
  }

  private processModernFrame(frame: SocketBuffer) {
    const rawMessageId = readBigEndianInt(frame, 0);
    const isProtoBuf = rawMessageId > PROTOCOL.protoBufMessageOffset;

    if (isProtoBuf) {
      const messageId = rawMessageId - PROTOCOL.protoBufMessageOffset;
      if (messageId === INCOMING.ERR_MSG) {
        this.applyErrorMessage(parseProtobufErrorMessage(frame.slice(4)));
        return;
      }

      if (messageId === INCOMING.OPEN_ORDER) {
        this.handleOpenOrderProto(frame.slice(4));
        return;
      }

      if (messageId === INCOMING.ORDER_STATUS) {
        this.handleOrderStatusProto(frame.slice(4));
        return;
      }

      if (messageId === INCOMING.OPEN_ORDER_END) {
        this.handleOpenOrderEnd();
        return;
      }

      return;
    }

    this.dispatchMessage(rawMessageId, splitNullFields(frame.slice(4)));
  }

  private dispatchMessage(messageId: number, fields: string[]) {
    switch (messageId) {
      case INCOMING.NEXT_VALID_ID:
        this.handleNextValidId(fields);
        return;
      case INCOMING.MANAGED_ACCTS:
        this.handleManagedAccounts(fields);
        return;
      case INCOMING.CURRENT_TIME:
        this.handleCurrentTime(fields);
        return;
      case INCOMING.OPEN_ORDER:
        return;
      case INCOMING.OPEN_ORDER_END:
        this.handleOpenOrderEnd();
        return;
      case INCOMING.HISTORICAL_DATA:
        this.handleHistoricalData(fields);
        return;
      case INCOMING.SCANNER_DATA:
        this.handleScannerData(fields);
        return;
      case INCOMING.MARKET_DATA_TYPE:
        this.handleMarketDataType(fields);
        return;
      case INCOMING.ACCOUNT_SUMMARY:
        this.handleAccountSummary(fields);
        return;
      case INCOMING.ACCOUNT_SUMMARY_END:
        this.handleAccountSummaryEnd(fields);
        return;
      case INCOMING.SYMBOL_SAMPLES:
        this.handleStockSymbolSamples(fields);
        return;
      case INCOMING.POSITION:
        this.handlePosition(fields);
        return;
      case INCOMING.POSITION_END:
        this.handlePositionEnd();
        return;
      case INCOMING.TICK_PRICE:
        this.handleTickPrice(fields);
        return;
      case INCOMING.TICK_SIZE:
        this.handleTickSize(fields);
        return;
      case INCOMING.TICK_SNAPSHOT_END:
        this.handleTickSnapshotEnd(fields);
        return;
      case INCOMING.HISTORICAL_DATA_END:
        this.handleHistoricalDataEnd(fields);
        return;
      case INCOMING.PNL:
        this.handleAccountPnL(fields);
        return;
      case INCOMING.PNL_SINGLE:
        this.handlePnLSingle(fields);
        return;
      case INCOMING.ERR_MSG:
        this.handleLegacyErrorMessage(fields);
        return;
      default:
        return;
    }
  }

  private handleNextValidId(fields: string[]) {
    const orderId = parseIntField(fields[1], parseIntField(fields[0], 0));
    if (!orderId) {
      return;
    }

    this.nextValidOrderId = orderId;
    this.tryResolveReady();

    if (this.nextOrderIdRequest) {
      clearTimeout(this.nextOrderIdRequest.timeoutId);
      this.nextOrderIdRequest.deferred.resolve({ orderId });
      this.nextOrderIdRequest = null;
    }
  }

  private handleManagedAccounts(fields: string[]) {
    const raw = fields[1] ?? fields[0] ?? "";
    this.managedAccounts = joinAccountsList(raw);
    this.tryResolveReady();

    if (this.managedAccountsRequest) {
      clearTimeout(this.managedAccountsRequest.timeoutId);
      this.managedAccountsRequest.deferred.resolve({
        accounts: [...this.managedAccounts],
        raw,
      });
      this.managedAccountsRequest = null;
    }
  }

  private handleCurrentTime(fields: string[]) {
    const epochSeconds = parseIntField(fields[1], parseIntField(fields[0], 0));
    if (!epochSeconds || !this.currentTimeRequest) {
      return;
    }

    const response = {
      epochSeconds,
      isoTime: new Date(epochSeconds * 1000).toISOString(),
    };
    this.lastCurrentTime = response;
    this.lastCurrentTimeReceivedAt = Date.now();

    clearTimeout(this.currentTimeRequest.timeoutId);
    this.currentTimeRequest.deferred.resolve(response);
    this.currentTimeRequest = null;
  }

  private handleMarketDataType(fields: string[]) {
    const reqId = parseIntField(fields[1], parseIntField(fields[0], 0));
    const marketDataType = parseIntField(fields[2], parseIntField(fields[1], 0));
    const pending = this.marketDataRequests.get(reqId);

    if (!pending) {
      return;
    }

    this.applyTick(pending.snapshot, -58, marketDataType);
    pending.snapshot.fields.marketDataType = marketDataType;
  }

  private handleAccountSummary(fields: string[]) {
    const reqId = parseIntField(fields[1], parseIntField(fields[0], 0));
    const pending = this.accountSummaryRequests.get(reqId);

    if (!pending) {
      return;
    }

    const baseIndex = fields[1] ? 2 : 1;
    pending.rows.push({
      account: fields[baseIndex] || "",
      tag: fields[baseIndex + 1] || "",
      value: fields[baseIndex + 2] || "",
      currency: fields[baseIndex + 3] || "",
    });
  }

  private handleAccountSummaryEnd(fields: string[]) {
    const reqId = parseIntField(fields[1], parseIntField(fields[0], 0));
    const pending = this.accountSummaryRequests.get(reqId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.accountSummaryRequests.delete(reqId);
    this.trySendMessage(OUTGOING.CANCEL_ACCOUNT_SUMMARY, [1, reqId]);

    const byAccount: AccountSummaryResponse["byAccount"] = {};
    for (const row of pending.rows) {
      const account = (byAccount[row.account] ??= {});
      account[row.tag] = {
        value: row.value,
        currency: row.currency,
      };
    }

    pending.deferred.resolve({
      reqId,
      group: pending.group,
      tags: pending.tags,
      rows: pending.rows,
      byAccount,
    });
  }

  private handleStockSymbolSamples(fields: string[]) {
    let index = 0;
    const reqId = parseIntField(fields[index++], 0);
    const pending = this.stockSymbolSearchRequests.get(reqId);

    if (!pending) {
      return;
    }

    const count = parseIntField(fields[index++], 0);
    const matches: StockSymbolMatch[] = [];

    for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
      const conid = parseIntField(fields[index++], 0);
      const symbol = fields[index++] || "";
      const secType = (fields[index++] || "").toUpperCase();
      const primaryExchange = fields[index++] || "";
      const currency = fields[index++] || "";
      const derivativeTypeCount = parseIntField(fields[index++], 0);
      const derivativeSecTypes: string[] = [];

      for (let derivativeIndex = 0; derivativeIndex < derivativeTypeCount; derivativeIndex += 1) {
        derivativeSecTypes.push(fields[index++] || "");
      }

      let description = "";
      let issuerId = "";
      if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerBondIssuerId) {
        description = fields[index++] || "";
        issuerId = fields[index++] || "";
      }

      if (secType !== "STK") {
        continue;
      }

      matches.push({
        conid,
        symbol,
        primaryExchange,
        currency,
        description,
        issuerId,
        derivativeSecTypes,
      });
    }

    clearTimeout(pending.timeoutId);
    this.stockSymbolSearchRequests.delete(reqId);
    pending.deferred.resolve({
      reqId,
      pattern: pending.pattern,
      matches: matches.slice(0, Math.max(pending.limit, 0)),
    });
  }

  private handleHistoricalData(fields: string[]) {
    let index = 0;
    let version = Number.MAX_SAFE_INTEGER;

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerSyntRealtimeBars) {
      version = parseIntField(fields[index++], 0);
    }

    const reqId = parseIntField(fields[index++], 0);
    const pending = this.stockHistoricalBarsRequests.get(reqId);

    if (!pending) {
      return;
    }

    if (version >= 2 && (this.serverVersion ?? 0) < PROTOCOL.minServerVerHistoricalDataEnd) {
      pending.response.startDateTime = fields[index++] || null;
      pending.response.endDateTimeReturned = fields[index++] || null;
    }

    const itemCount = parseIntField(fields[index++], 0);

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const bar: StockHistoricalBar = {
        time: fields[index++] || "",
        open: parseFloatField(fields[index++]),
        high: parseFloatField(fields[index++]),
        low: parseFloatField(fields[index++]),
        close: parseFloatField(fields[index++]),
        volume: parseDecimalField(fields[index++]),
        wap: parseDecimalField(fields[index++]),
        barCount: null,
      };

      if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerSyntRealtimeBars) {
        index += 1;
      }

      if (version >= 3) {
        bar.barCount = parseIntField(fields[index++], 0) || null;
      }

      pending.response.bars.push(bar);
    }

    if ((this.serverVersion ?? 0) < PROTOCOL.minServerVerHistoricalDataEnd) {
      this.resolveHistoricalBars(reqId, pending);
    }
  }

  private handleHistoricalDataEnd(fields: string[]) {
    const reqId = parseIntField(fields[0], 0);
    const pending = this.stockHistoricalBarsRequests.get(reqId);

    if (!pending) {
      return;
    }

    pending.response.startDateTime = fields[1] || null;
    pending.response.endDateTimeReturned = fields[2] || null;
    this.resolveHistoricalBars(reqId, pending);
  }

  private handleScannerData(fields: string[]) {
    let index = 0;
    index += 1;

    const reqId = parseIntField(fields[index++], 0);
    const pending = this.stockScannerRequests.get(reqId);

    if (!pending) {
      return;
    }

    const rowCount = parseIntField(fields[index++], 0);
    const rows: StockScannerRow[] = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row: StockScannerRow = {
        rank: parseIntField(fields[index++], 0),
        conid: parseIntField(fields[index++], 0),
        symbol: fields[index++] || "",
        secType: fields[index++] || "",
        lastTradeDateOrContractMonth: fields[index++] || "",
        strike: parseFloatField(fields[index++]),
        right: fields[index++] || "",
        exchange: fields[index++] || "",
        currency: fields[index++] || "",
        localSymbol: fields[index++] || "",
        marketName: fields[index++] || "",
        tradingClass: fields[index++] || "",
        distance: fields[index++] || "",
        benchmark: fields[index++] || "",
        projection: fields[index++] || "",
        legsStr: fields[index++] || "",
      };

      if (row.secType.toUpperCase() !== "STK") {
        continue;
      }

      rows.push(row);
    }

    clearTimeout(pending.timeoutId);
    this.stockScannerRequests.delete(reqId);
    this.trySendMessage(OUTGOING.CANCEL_SCANNER_SUBSCRIPTION, [1, reqId]);
    pending.deferred.resolve({
      reqId,
      scanCode: pending.scanCode,
      instrument: pending.instrument,
      locationCode: pending.locationCode,
      rows,
    });
  }

  private handleAccountPnL(fields: string[]) {
    let index = 0;
    const reqId = parseIntField(fields[index++], 0);
    const subscriptionKey = this.accountPnLReqIdToKey.get(reqId);

    if (!subscriptionKey) {
      return;
    }

    const subscription = this.accountPnLSubscriptions.get(subscriptionKey);
    if (!subscription) {
      this.accountPnLReqIdToKey.delete(reqId);
      return;
    }

    const dailyPnL = this.normalizeUnsetFloat(parseFloatField(fields[index++]));
    const unrealizedPnL =
      (this.serverVersion ?? 0) >= PROTOCOL.minServerVerUnrealizedPnl
        ? this.normalizeUnsetFloat(parseFloatField(fields[index++]))
        : null;
    const realizedPnL =
      (this.serverVersion ?? 0) >= PROTOCOL.minServerVerRealizedPnl
        ? this.normalizeUnsetFloat(parseFloatField(fields[index++]))
        : null;

    const snapshot: AccountPnLSnapshot = {
      reqId,
      account: subscription.account,
      modelCode: subscription.modelCode,
      dailyPnL,
      unrealizedPnL,
      realizedPnL,
      receivedAt: new Date().toISOString(),
    };

    subscription.latest = snapshot;
    subscription.lastUpdatedAt = Date.now();
    this.resolveAccountPnLWaiters(subscription, snapshot);
  }

  private handlePnLSingle(fields: string[]) {
    let index = 0;
    const reqId = parseIntField(fields[index++], 0);
    const pending = this.stockPnLSnapshotRequests.get(reqId);

    if (!pending) {
      return;
    }

    const position = parseDecimalField(fields[index++]);
    const dailyPnL = this.normalizeUnsetFloat(parseFloatField(fields[index++]));
    const unrealizedPnL =
      (this.serverVersion ?? 0) >= PROTOCOL.minServerVerUnrealizedPnl
        ? this.normalizeUnsetFloat(parseFloatField(fields[index++]))
        : null;
    const realizedPnL =
      (this.serverVersion ?? 0) >= PROTOCOL.minServerVerRealizedPnl
        ? this.normalizeUnsetFloat(parseFloatField(fields[index++]))
        : null;
    const value = this.normalizeUnsetFloat(parseFloatField(fields[index++]));

    clearTimeout(pending.timeoutId);
    this.stockPnLSnapshotRequests.delete(reqId);
    this.trySendMessage(OUTGOING.CANCEL_PNL_SINGLE, [reqId]);
    pending.deferred.resolve({
      reqId,
      account: pending.account,
      modelCode: pending.modelCode,
      conid: pending.conid,
      position,
      dailyPnL,
      unrealizedPnL,
      realizedPnL,
      value,
      receivedAt: new Date().toISOString(),
    });
  }

  private handlePosition(fields: string[]) {
    if (!this.positionsRequest) {
      return;
    }

    const version = parseIntField(fields[0], 0);
    const hasTradingClass = version >= 2;
    const hasAverageCost = version >= 3;

    let index = 1;
    const account = fields[index++] || "";

    this.positionsRequest.rows.push({
      account,
      contract: {
        conid: parseIntField(fields[index++], 0),
        symbol: fields[index++] || "",
        secType: fields[index++] || "",
        lastTradeDateOrContractMonth: fields[index++] || "",
        strike: parseFloatField(fields[index++]),
        right: fields[index++] || "",
        multiplier: fields[index++] || "",
        exchange: fields[index++] || "",
        currency: fields[index++] || "",
        localSymbol: fields[index++] || "",
        tradingClass: hasTradingClass ? fields[index++] || "" : "",
      },
      position: parseDecimalField(fields[index++]),
      averageCost: hasAverageCost ? parseFloatField(fields[index++]) : null,
    });
  }

  private handlePositionEnd() {
    if (!this.positionsRequest) {
      return;
    }

    clearTimeout(this.positionsRequest.timeoutId);
    this.trySendMessage(OUTGOING.CANCEL_POSITIONS, [1]);

    const pending = this.positionsRequest;
    this.positionsRequest = null;
    pending.deferred.resolve({ rows: pending.rows });
  }

  private handleTickPrice(fields: string[]) {
    const version = parseIntField(fields[0], 0);
    const tickerId = parseIntField(fields[1], 0);
    const tickType = parseIntField(fields[2], -1);
    const pending = this.marketDataRequests.get(tickerId);

    if (!pending) {
      return;
    }

    this.applyTick(pending.snapshot, tickType, parseFloatField(fields[3]));

    if (version >= 2) {
      const derivedSizeTick = PRICE_TICK_TO_SIZE_TICK.get(tickType);
      if (derivedSizeTick !== undefined) {
        this.applyTick(pending.snapshot, derivedSizeTick, parseDecimalField(fields[4]));
      }
    }
  }

  private handleTickSize(fields: string[]) {
    const tickerId = parseIntField(fields[1], parseIntField(fields[0], 0));
    const tickType = parseIntField(fields[2], parseIntField(fields[1], -1));
    const pending = this.marketDataRequests.get(tickerId);

    if (!pending) {
      return;
    }

    this.applyTick(pending.snapshot, tickType, parseDecimalField(fields[3] ?? fields[2]));
  }

  private handleTickSnapshotEnd(fields: string[]) {
    const tickerId = parseIntField(fields[1], parseIntField(fields[0], 0));
    const pending = this.marketDataRequests.get(tickerId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.marketDataRequests.delete(tickerId);
    pending.snapshot.completed = true;
    this.trySendMessage(OUTGOING.CANCEL_MKT_DATA, [1, tickerId]);
    pending.deferred.resolve(pending.snapshot);
  }

  private handleLegacyErrorMessage(fields: string[]) {
    let parsed: ParsedErrorMessage;

    if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerErrorTime) {
      parsed = {
        id: parseIntField(fields[0], 0),
        errorCode: parseIntField(fields[1], 0),
        errorMessage: fields[2] || "",
        errorTime: null,
        advancedOrderRejectJson: null,
      };

      if ((this.serverVersion ?? 0) >= PROTOCOL.minServerVerAdvancedOrderReject) {
        parsed.advancedOrderRejectJson = fields[3] || null;
        parsed.errorTime = parseIntField(fields[4], 0) || null;
      } else {
        parsed.errorTime = parseIntField(fields[3], 0) || null;
      }
    } else {
      parsed = {
        id: parseIntField(fields[1], parseIntField(fields[0], 0)),
        errorCode: parseIntField(fields[2], parseIntField(fields[1], 0)),
        errorMessage: fields[3] || fields[2] || "",
        errorTime: null,
        advancedOrderRejectJson: null,
      };
    }

    this.applyErrorMessage(parsed);
  }

  private applyErrorMessage({
    id,
    errorCode,
    errorMessage,
    errorTime,
    advancedOrderRejectJson,
  }: ParsedErrorMessage) {
    const message = [
      `IB error ${errorCode}`,
      id ? `for request ${id}` : null,
      errorMessage ? `: ${errorMessage}` : null,
      errorTime ? ` @ ${this.formatIbErrorTime(errorTime)}` : null,
      advancedOrderRejectJson ? ` | ${advancedOrderRejectJson}` : null,
    ]
      .filter(Boolean)
      .join("");

    const accountSummary = this.accountSummaryRequests.get(id);
    if (accountSummary) {
      clearTimeout(accountSummary.timeoutId);
      this.accountSummaryRequests.delete(id);
      accountSummary.deferred.reject(new Error(message));
      return;
    }

    const marketData = this.marketDataRequests.get(id);
    if (marketData) {
      if (this.isNonFatalMarketDataMessage(errorCode)) {
        marketData.snapshot.warnings.push(message);
        return;
      }

      clearTimeout(marketData.timeoutId);
      this.marketDataRequests.delete(id);
      marketData.deferred.reject(new Error(message));
      return;
    }

    if (this.isNonFatalIbMessage(errorCode)) {
      return;
    }

    const stockPnLSnapshot = this.stockPnLSnapshotRequests.get(id);
    if (stockPnLSnapshot) {
      clearTimeout(stockPnLSnapshot.timeoutId);
      this.stockPnLSnapshotRequests.delete(id);
      stockPnLSnapshot.deferred.reject(new Error(message));
      return;
    }

    const accountPnLKey = this.accountPnLReqIdToKey.get(id);
    if (accountPnLKey) {
      const subscription = this.accountPnLSubscriptions.get(accountPnLKey);
      if (subscription) {
        this.rejectAccountPnLWaiters(subscription, new Error(message));
        this.trySendMessage(OUTGOING.CANCEL_PNL, [subscription.reqId]);
      }

      this.accountPnLReqIdToKey.delete(id);
      this.accountPnLSubscriptions.delete(accountPnLKey);
      return;
    }

    const stockSymbolSearch = this.stockSymbolSearchRequests.get(id);
    if (stockSymbolSearch) {
      clearTimeout(stockSymbolSearch.timeoutId);
      this.stockSymbolSearchRequests.delete(id);
      stockSymbolSearch.deferred.reject(new Error(message));
      return;
    }

    const stockScanner = this.stockScannerRequests.get(id);
    if (stockScanner) {
      clearTimeout(stockScanner.timeoutId);
      this.stockScannerRequests.delete(id);

      if (errorCode === 165) {
        this.trySendMessage(OUTGOING.CANCEL_SCANNER_SUBSCRIPTION, [1, id]);
        stockScanner.deferred.resolve({
          reqId: id,
          scanCode: stockScanner.scanCode,
          instrument: stockScanner.instrument,
          locationCode: stockScanner.locationCode,
          rows: [],
        });
        return;
      }

      stockScanner.deferred.reject(new Error(message));
      return;
    }

    const stockHistoricalBars = this.stockHistoricalBarsRequests.get(id);
    if (stockHistoricalBars) {
      clearTimeout(stockHistoricalBars.timeoutId);
      this.stockHistoricalBarsRequests.delete(id);
      stockHistoricalBars.deferred.reject(new Error(message));
      return;
    }

    const stockOrderPreview = this.stockOrderPreviewRequests.get(id);
    if (stockOrderPreview) {
      clearTimeout(stockOrderPreview.timeoutId);
      this.stockOrderPreviewRequests.delete(id);
      stockOrderPreview.deferred.reject(new Error(message));
      return;
    }

    const stockOrderPlacement = this.stockOrderPlacementRequests.get(id);
    if (stockOrderPlacement) {
      clearTimeout(stockOrderPlacement.timeoutId);
      if (stockOrderPlacement.settleTimeoutId) {
        clearTimeout(stockOrderPlacement.settleTimeoutId);
      }
      this.stockOrderPlacementRequests.delete(id);
      stockOrderPlacement.deferred.reject(new Error(message));
      return;
    }

    const stockOrderCancel = this.stockOrderCancelRequests.get(id);
    if (stockOrderCancel) {
      clearTimeout(stockOrderCancel.timeoutId);
      this.stockOrderCancelRequests.delete(id);
      stockOrderCancel.deferred.reject(new Error(message));
    }
  }

  private handleOpenOrderProto(payload: SocketBuffer) {
    const parsed = parseOpenOrderProto(payload);
    const pendingPreview = this.stockOrderPreviewRequests.get(parsed.orderId);

    if (pendingPreview) {
      clearTimeout(pendingPreview.timeoutId);
      this.stockOrderPreviewRequests.delete(parsed.orderId);
      pendingPreview.deferred.resolve({
        orderId: parsed.orderId,
        requestedOrder: pendingPreview.request,
        preview: parsed.orderState,
      });
      return;
    }

    const pendingPlacement = this.stockOrderPlacementRequests.get(parsed.orderId);
    if (pendingPlacement) {
      pendingPlacement.orderState = parsed.orderState;
      this.maybeResolveStockOrderPlacement(parsed.orderId, pendingPlacement);
      return;
    }

    if (this.openStockOrdersRequest && this.isStockOpenOrder(parsed)) {
      this.openStockOrdersRequest.orders.push(parsed);
    }

    const pendingCancel = this.stockOrderCancelRequests.get(parsed.orderId);
    if (!pendingCancel) {
      return;
    }

    if (!this.isCancelTerminalStatus(parsed.orderState.status)) {
      return;
    }

    clearTimeout(pendingCancel.timeoutId);
    this.stockOrderCancelRequests.delete(parsed.orderId);
    pendingCancel.deferred.resolve({
      orderId: parsed.orderId,
      acknowledgedStatus: this.createOrderStatusFromState(parsed.orderId, parsed.orderState),
    });
  }

  private handleOpenOrderEnd() {
    if (!this.openStockOrdersRequest) {
      return;
    }

    clearTimeout(this.openStockOrdersRequest.timeoutId);
    const pending = this.openStockOrdersRequest;
    this.openStockOrdersRequest = null;
    pending.deferred.resolve({
      orders: pending.orders,
    });
  }

  private handleOrderStatusProto(payload: SocketBuffer) {
    const parsed = parseOrderStatusProto(payload);
    const pendingPlacement = this.stockOrderPlacementRequests.get(parsed.orderId);

    if (pendingPlacement) {
      pendingPlacement.orderStatus = parsed;
      this.maybeResolveStockOrderPlacement(parsed.orderId, pendingPlacement);
      return;
    }

    const pendingCancel = this.stockOrderCancelRequests.get(parsed.orderId);
    if (!pendingCancel) {
      return;
    }

    clearTimeout(pendingCancel.timeoutId);
    this.stockOrderCancelRequests.delete(parsed.orderId);
    pendingCancel.deferred.resolve({
      orderId: parsed.orderId,
      acknowledgedStatus: parsed,
    });
  }

  private resolveStockOrderPlacement(
    orderId: number,
    pending: PendingStockOrderPlacement,
  ) {
    clearTimeout(pending.timeoutId);
    if (pending.settleTimeoutId) {
      clearTimeout(pending.settleTimeoutId);
      pending.settleTimeoutId = null;
    }
    this.stockOrderPlacementRequests.delete(orderId);
    pending.deferred.resolve({
      orderId,
      requestedOrder: pending.request,
      orderState: pending.orderState,
      orderStatus: pending.orderStatus,
    });
  }

  private maybeResolveStockOrderPlacement(
    orderId: number,
    pending: PendingStockOrderPlacement,
  ) {
    if (pending.orderState && pending.orderStatus) {
      this.resolveStockOrderPlacement(orderId, pending);
      return;
    }

    if (pending.settleTimeoutId) {
      return;
    }

    pending.settleTimeoutId = setTimeout(() => {
      pending.settleTimeoutId = null;
      const current = this.stockOrderPlacementRequests.get(orderId);
      if (!current) {
        return;
      }

      this.resolveStockOrderPlacement(orderId, current);
    }, PROTOCOL.orderPlacementSettleWindowMs);
  }

  private createOrderStatusFromState(
    orderId: number,
    orderState: StockOrderPreviewResponse["preview"],
  ): StockOrderStatus {
    return {
      orderId,
      status: orderState.status,
      filled: null,
      remaining: null,
      avgFillPrice: null,
      permId: null,
      parentId: null,
      lastFillPrice: null,
      clientId: null,
      whyHeld: null,
      mktCapPrice: null,
    };
  }

  private isCancelTerminalStatus(status: string | null): boolean {
    if (!status) {
      return false;
    }

    const normalized = status.trim().toUpperCase();
    return (
      normalized === "CANCELLED" ||
      normalized === "APICANCELLED" ||
      normalized === "INACTIVE"
    );
  }

  private isStockOpenOrder(order: StockOpenOrder): boolean {
    return order.contract.secType.toUpperCase() === "STK";
  }

  private isHeldStockPosition(position: PositionRow): boolean {
    if (position.contract.secType.toUpperCase() !== "STK") {
      return false;
    }

    if (!position.position) {
      return false;
    }

    const quantity = Number.parseFloat(position.position);
    return Number.isFinite(quantity) && quantity !== 0;
  }

  private normalizeSnapshotSymbols(symbols: string[]): string[] {
    const uniqueSymbols = new Set<string>();

    for (const rawSymbol of symbols) {
      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) {
        continue;
      }

      uniqueSymbols.add(symbol);
    }

    return Array.from(uniqueSymbols);
  }

  private normalizeBatchConcurrency(value: number | undefined): number {
    const requested = value ?? 4;
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new Error("batchConcurrency must be a positive integer.");
    }

    return Math.min(requested, 10);
  }

  private async mapWithConcurrency<TInput, TOutput>(
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

  private applyTick(snapshot: MarketSnapshot, tickType: number, value: TickValue) {
    applyTickValue(snapshot.fields, snapshot.rawTicks, tickType, value);
  }

  private nextReqId(): number {
    this.reqIdCounter += 1;
    return this.reqIdCounter;
  }

  private handleSocketFailure(reason: unknown) {
    const error =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : "Socket failure.");

    const wasConnected = this.connected || Boolean(this.socket);
    this.connected = false;
    this.buffer = new Uint8Array(0);

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close races.
      }
      this.socket = null;
    }

    if (this.ready) {
      this.clearReadyResolutionTimers();
      this.ready.reject(error);
      this.ready = null;
    }

    this.rejectPending(error);

    if (!wasConnected) {
      this.resetSessionState();
      return;
    }

    this.serverVersion = null;
    this.connectionTime = null;
    this.lastCurrentTime = null;
    this.lastCurrentTimeReceivedAt = 0;
    this.marketDataType = null;
  }

  private rejectPending(error: Error) {
    if (this.currentTimeRequest) {
      clearTimeout(this.currentTimeRequest.timeoutId);
      this.currentTimeRequest.deferred.reject(error);
      this.currentTimeRequest = null;
    }

    if (this.managedAccountsRequest) {
      clearTimeout(this.managedAccountsRequest.timeoutId);
      this.managedAccountsRequest.deferred.reject(error);
      this.managedAccountsRequest = null;
    }

    if (this.nextOrderIdRequest) {
      clearTimeout(this.nextOrderIdRequest.timeoutId);
      this.nextOrderIdRequest.deferred.reject(error);
      this.nextOrderIdRequest = null;
    }

    if (this.positionsRequest) {
      clearTimeout(this.positionsRequest.timeoutId);
      this.positionsRequest.deferred.reject(error);
      this.positionsRequest = null;
    }

    if (this.openStockOrdersRequest) {
      clearTimeout(this.openStockOrdersRequest.timeoutId);
      this.openStockOrdersRequest.deferred.reject(error);
      this.openStockOrdersRequest = null;
    }

    for (const [reqId, pending] of this.accountSummaryRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.accountSummaryRequests.delete(reqId);
    }

    for (const [reqId, pending] of this.marketDataRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.marketDataRequests.delete(reqId);
    }

    for (const [reqId, pending] of this.stockPnLSnapshotRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockPnLSnapshotRequests.delete(reqId);
    }

    this.clearAccountPnLSubscriptions(error);

    for (const [reqId, pending] of this.stockSymbolSearchRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockSymbolSearchRequests.delete(reqId);
    }

    for (const [reqId, pending] of this.stockScannerRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockScannerRequests.delete(reqId);
    }

    for (const [reqId, pending] of this.stockHistoricalBarsRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockHistoricalBarsRequests.delete(reqId);
    }

    for (const [orderId, pending] of this.stockOrderPreviewRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockOrderPreviewRequests.delete(orderId);
    }

    for (const [orderId, pending] of this.stockOrderPlacementRequests) {
      clearTimeout(pending.timeoutId);
      if (pending.settleTimeoutId) {
        clearTimeout(pending.settleTimeoutId);
      }
      pending.deferred.reject(error);
      this.stockOrderPlacementRequests.delete(orderId);
    }

    for (const [orderId, pending] of this.stockOrderCancelRequests) {
      clearTimeout(pending.timeoutId);
      pending.deferred.reject(error);
      this.stockOrderCancelRequests.delete(orderId);
    }
  }

  private resetSessionState() {
    this.clearReadyResolutionTimers();
    this.connected = false;
    this.socket = null;
    this.buffer = new Uint8Array(0);
    this.serverVersion = null;
    this.connectionTime = null;
    this.connectReadyAfter = 0;
    this.lastCurrentTime = null;
    this.lastCurrentTimeReceivedAt = 0;
    this.nextValidOrderId = null;
    this.managedAccounts = [];
    this.marketDataType = null;
    this.clearAccountPnLSubscriptions();
  }

  private scheduleReadyResolution() {
    if (!this.ready) {
      return;
    }

    this.clearReadyResolutionTimers();
    this.connectReadyAfter = Date.now() + PROTOCOL.connectStartupGraceMs;
    this.connectReadyTimer = setTimeout(() => {
      this.connectReadyTimer = null;
      this.tryResolveReady();
    }, PROTOCOL.connectStartupGraceMs);
    this.connectBootstrapTimeoutId = setTimeout(() => {
      this.connectBootstrapTimeoutId = null;
      this.resolveReady();
    }, PROTOCOL.connectBootstrapTimeoutMs);
  }

  private tryResolveReady() {
    if (!this.ready) {
      return;
    }

    if (Date.now() < this.connectReadyAfter) {
      return;
    }

    if (!this.hasStartupState()) {
      return;
    }

    this.resolveReady();
  }

  private resolveReady() {
    if (!this.ready) {
      return;
    }

    const pendingReady = this.ready;
    this.ready = null;
    this.clearReadyResolutionTimers();
    pendingReady.resolve(this.getStatus());
  }

  private hasStartupState(): boolean {
    return this.nextValidOrderId !== null && this.managedAccounts.length > 0;
  }

  private clearReadyResolutionTimers() {
    if (this.connectReadyTimer) {
      clearTimeout(this.connectReadyTimer);
      this.connectReadyTimer = null;
    }

    if (this.connectBootstrapTimeoutId) {
      clearTimeout(this.connectBootstrapTimeoutId);
      this.connectBootstrapTimeoutId = null;
    }
  }

  private getCachedCurrentTime(maxAgeMs: number): CurrentTimeResponse | null {
    if (!this.lastCurrentTime) {
      return null;
    }

    if (Date.now() - this.lastCurrentTimeReceivedAt > maxAgeMs) {
      return null;
    }

    return this.lastCurrentTime;
  }

  private toAccountPnLSubscriptionKey(account: string, modelCode: string): string {
    return `${account.trim().toUpperCase()}::${modelCode.trim().toUpperCase()}`;
  }

  private resolveAccountPnLWaiters(
    subscription: ActiveAccountPnLSubscription,
    snapshot: AccountPnLSnapshot,
  ) {
    const waiters = [...subscription.waiters];
    subscription.waiters = [];

    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.deferred.resolve(snapshot);
    }
  }

  private rejectAccountPnLWaiters(
    subscription: ActiveAccountPnLSubscription,
    error: Error,
  ) {
    const waiters = [...subscription.waiters];
    subscription.waiters = [];

    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.deferred.reject(error);
    }
  }

  private removeAccountPnLWaiter(
    reqId: number,
    deferred: Deferred<AccountPnLSnapshot>,
  ) {
    const subscriptionKey = this.accountPnLReqIdToKey.get(reqId);
    if (!subscriptionKey) {
      return;
    }

    const subscription = this.accountPnLSubscriptions.get(subscriptionKey);
    if (!subscription) {
      this.accountPnLReqIdToKey.delete(reqId);
      return;
    }

    subscription.waiters = subscription.waiters.filter(
      (waiter) => waiter.deferred !== deferred,
    );
  }

  private clearAccountPnLSubscriptions(error?: Error) {
    for (const [key, subscription] of this.accountPnLSubscriptions) {
      if (error) {
        this.rejectAccountPnLWaiters(subscription, error);
      } else {
        this.trySendMessage(OUTGOING.CANCEL_PNL, [subscription.reqId]);
      }

      this.accountPnLReqIdToKey.delete(subscription.reqId);
      this.accountPnLSubscriptions.delete(key);
    }
  }

  private formatIbErrorTime(errorTime: number): string {
    const milliseconds =
      errorTime >= 1_000_000_000_000 ? errorTime : errorTime * 1000;
    return new Date(milliseconds).toISOString();
  }

  private normalizeUnsetFloat(value: number | null): number | null {
    if (value === null) {
      return null;
    }

    return Math.abs(value) > 1e307 ? null : value;
  }

  private isNonFatalIbMessage(errorCode: number): boolean {
    return errorCode === 399;
  }

  private isNonFatalMarketDataMessage(errorCode: number): boolean {
    return errorCode === 10089 || errorCode === 10167;
  }

  private resolveHistoricalBars(
    reqId: number,
    pending: PendingStockHistoricalBars,
  ) {
    clearTimeout(pending.timeoutId);
    this.stockHistoricalBarsRequests.delete(reqId);
    this.trySendMessage(OUTGOING.CANCEL_HISTORICAL_DATA, [1, reqId]);
    pending.deferred.resolve(pending.response);
  }

  private isSessionClosed(): boolean {
    return !this.connected && this.socket === null;
  }

  private normalizeMarketDataType(value: number): MarketDataType {
    if (!this.isMarketDataType(value)) {
      throw new Error("marketDataType must be one of 1 (live), 2 (frozen), 3 (delayed), or 4 (delayed-frozen).");
    }

    return value;
  }

  private isMarketDataType(value: number): value is MarketDataType {
    return value === 1 || value === 2 || value === 3 || value === 4;
  }

  private applyMarketDataTypePreference(marketDataType: MarketDataType) {
    this.marketDataType = marketDataType;
    this.requestMarketDataType(marketDataType);
  }

  private requestMarketDataType(marketDataType: MarketDataType) {
    this.sendMessage(OUTGOING.REQ_MARKET_DATA_TYPE, [1, marketDataType]);
  }

  private describeMarketDataType(): MarketDataTypeResponse {
    if (!this.marketDataType) {
      return {
        marketDataType: null,
        label: "unset",
      };
    }

    return {
      marketDataType: this.marketDataType,
      label: MARKET_DATA_TYPE_LABELS[this.marketDataType] as MarketDataTypeResponse["label"],
    };
  }

  private async consumeOrderId(): Promise<number> {
    return await this.withOrderIdLock(async () => {
      const nextValidOrderId = await this.requestNextValidOrderId();
      this.nextValidOrderId = nextValidOrderId.orderId + 1;
      return nextValidOrderId.orderId;
    });
  }

  private async withOrderIdLock<T>(task: () => Promise<T>): Promise<T> {
    let releaseNextLock: () => void = () => {};
    const currentLock = this.orderIdLock;
    this.orderIdLock = new Promise<void>((resolve) => {
      releaseNextLock = () => {
        resolve();
      };
    });
    await currentLock;

    try {
      return await task();
    } finally {
      releaseNextLock();
    }
  }

  private async normalizeStockOrderRequest(
    options: StockOrderRequestOptions,
  ): Promise<StockOrderRequest> {
    const symbol = options.symbol.trim().toUpperCase();
    if (!symbol) {
      throw new Error("symbol is required.");
    }

    const action = options.action.trim().toUpperCase();
    if (action !== "BUY" && action !== "SELL") {
      throw new Error('action must be either "BUY" or "SELL".');
    }

    if (!Number.isFinite(options.quantity) || options.quantity <= 0) {
      throw new Error("quantity must be a positive number.");
    }

    const orderType = (options.orderType?.trim().toUpperCase() || "MKT");
    if (orderType !== "MKT" && orderType !== "LMT") {
      throw new Error('orderType must be either "MKT" or "LMT".');
    }

    if (orderType === "LMT") {
      if (!Number.isFinite(options.limitPrice) || (options.limitPrice ?? 0) <= 0) {
        throw new Error("limitPrice must be provided as a positive number for LMT orders.");
      }
    } else if (options.limitPrice !== undefined) {
      throw new Error("limitPrice is only supported for LMT order previews.");
    }

    return {
      symbol,
      action,
      quantity: this.formatQuantity(options.quantity),
      orderType,
      limitPrice: orderType === "LMT" ? options.limitPrice ?? null : null,
      tif: options.tif?.trim().toUpperCase() || "DAY",
      exchange: options.exchange?.trim().toUpperCase() || "SMART",
      primaryExchange: options.primaryExchange?.trim().toUpperCase() || "",
      currency: options.currency?.trim().toUpperCase() || "USD",
      account: await this.resolveOrderPreviewAccount(options.account),
      outsideRth: options.outsideRth ?? false,
    };
  }

  private async resolveOrderPreviewAccount(account: string | undefined): Promise<string> {
    const normalizedAccount = account?.trim();
    if (normalizedAccount) {
      return normalizedAccount;
    }

    const managedAccounts = await this.requestManagedAccounts();
    if (managedAccounts.accounts.length === 1) {
      return managedAccounts.accounts[0]!;
    }

    if (managedAccounts.accounts.length === 0) {
      throw new Error("No managed accounts are available for order preview.");
    }

    throw new Error("account is required when multiple managed accounts are available.");
  }

  private formatQuantity(quantity: number): string {
    return String(quantity);
  }
}
