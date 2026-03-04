export type ProtocolField = string | number | boolean | null | undefined;
export type TickValue = string | number | null;
export type SocketBuffer = Uint8Array<ArrayBufferLike>;
export type Timer = ReturnType<typeof setTimeout>;
export type BunSocket = Awaited<ReturnType<typeof Bun.connect>>;
export type MarketDataType = 1 | 2 | 3 | 4;
export type MarketDataTypeLabel = "live" | "frozen" | "delayed" | "delayed-frozen" | "unset";

export type GatewayConfig = {
  host: string;
  port: number;
  clientId: number;
};

export type GatewayConnectOptions = Partial<GatewayConfig>;

export type SharedRequest<T> = {
  deferred: Deferred<T>;
  timeoutId: Timer;
};

export type SubscriptionWaiter<T> = {
  deferred: Deferred<T>;
  timeoutId: Timer;
};

export type AccountSummaryRow = {
  account: string;
  tag: string;
  value: string;
  currency: string;
};

export type AccountPnLSnapshotRequestOptions = {
  account: string;
  modelCode?: string;
  timeoutMs?: number;
};

export type AccountPnLSnapshot = {
  reqId: number;
  account: string;
  modelCode: string;
  dailyPnL: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  receivedAt: string;
};

export type ActiveAccountPnLSubscription = {
  reqId: number;
  account: string;
  modelCode: string;
  latest: AccountPnLSnapshot | null;
  lastUpdatedAt: number;
  waiters: SubscriptionWaiter<AccountPnLSnapshot>[];
};

export type AccountSummaryResponse = {
  reqId: number;
  group: string;
  tags: string;
  rows: AccountSummaryRow[];
  byAccount: Record<string, Record<string, { value: string; currency: string }>>;
};

export type PositionContract = {
  conid: number;
  symbol: string;
  secType: string;
  lastTradeDateOrContractMonth: string;
  strike: number | null;
  right: string;
  multiplier: string;
  exchange: string;
  currency: string;
  localSymbol: string;
  tradingClass: string;
};

export type PositionRow = {
  account: string;
  contract: PositionContract;
  position: string | null;
  averageCost: number | null;
};

export type PositionsResponse = {
  rows: PositionRow[];
};

export type MarketSnapshotContract = {
  symbol: string;
  secType: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
};

export type MarketSnapshot = {
  reqId: number;
  contract: MarketSnapshotContract;
  fields: Record<string, TickValue>;
  rawTicks: Record<string, TickValue>;
  warnings: string[];
  completed: boolean;
  timedOut: boolean;
};

export type PendingAccountSummary = {
  deferred: Deferred<AccountSummaryResponse>;
  rows: AccountSummaryRow[];
  group: string;
  tags: string;
  timeoutId: Timer;
};

export type PendingPositions = {
  deferred: Deferred<PositionsResponse>;
  rows: PositionRow[];
  timeoutId: Timer;
};

export type PendingMarketData = {
  deferred: Deferred<MarketSnapshot>;
  snapshot: MarketSnapshot;
  timeoutId: Timer;
};

export type StockSymbolMatch = {
  conid: number;
  symbol: string;
  primaryExchange: string;
  currency: string;
  description: string;
  issuerId: string;
  derivativeSecTypes: string[];
};

export type PendingStockSymbolSearch = {
  deferred: Deferred<StockSymbolSearchResponse>;
  pattern: string;
  limit: number;
  timeoutId: Timer;
};

export type StockHistoricalBarsContract = {
  symbol: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
};

export type StockHistoricalBar = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: string | null;
  wap: string | null;
  barCount: number | null;
};

export type StockHistoricalBarsResponse = {
  reqId: number;
  contract: StockHistoricalBarsContract;
  endDateTime: string;
  durationStr: string;
  barSizeSetting: string;
  whatToShow: string;
  useRTH: boolean;
  bars: StockHistoricalBar[];
  startDateTime: string | null;
  endDateTimeReturned: string | null;
};

export type PendingStockHistoricalBars = {
  deferred: Deferred<StockHistoricalBarsResponse>;
  response: StockHistoricalBarsResponse;
  timeoutId: Timer;
};

export type StockOrderAction = "BUY" | "SELL";
export type StockOrderType = "MKT" | "LMT";

export type StockOrderRequestOptions = {
  symbol: string;
  action: StockOrderAction;
  quantity: number;
  orderType?: StockOrderType;
  limitPrice?: number;
  tif?: string;
  exchange?: string;
  primaryExchange?: string;
  currency?: string;
  account?: string;
  outsideRth?: boolean;
  timeoutMs?: number;
};

export type StockOrderRequest = {
  symbol: string;
  action: StockOrderAction;
  quantity: string;
  orderType: StockOrderType;
  limitPrice: number | null;
  tif: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
  account: string;
  outsideRth: boolean;
};

export type StockOrderPreviewRequestOptions = StockOrderRequestOptions;
export type StockOrderPlaceRequestOptions = StockOrderRequestOptions;
export type StockOrderPlaceRequest = StockOrderRequest;
export type StockOrderModifyRequestOptions = StockOrderRequestOptions & {
  orderId: number;
};
export type StockOrderModifyRequest = StockOrderRequest & {
  orderId: number;
};

export type StockOrderPreviewState = {
  status: string | null;
  initMarginBefore: number | null;
  maintMarginBefore: number | null;
  equityWithLoanBefore: number | null;
  initMarginChange: number | null;
  maintMarginChange: number | null;
  equityWithLoanChange: number | null;
  initMarginAfter: number | null;
  maintMarginAfter: number | null;
  equityWithLoanAfter: number | null;
  commissionAndFees: number | null;
  minCommissionAndFees: number | null;
  maxCommissionAndFees: number | null;
  commissionAndFeesCurrency: string | null;
  marginCurrency: string | null;
  initMarginBeforeOutsideRth: number | null;
  maintMarginBeforeOutsideRth: number | null;
  equityWithLoanBeforeOutsideRth: number | null;
  initMarginChangeOutsideRth: number | null;
  maintMarginChangeOutsideRth: number | null;
  equityWithLoanChangeOutsideRth: number | null;
  initMarginAfterOutsideRth: number | null;
  maintMarginAfterOutsideRth: number | null;
  equityWithLoanAfterOutsideRth: number | null;
  suggestedSize: string | null;
  rejectReason: string | null;
  warningText: string | null;
};

export type StockOrderStatus = {
  orderId: number;
  status: string | null;
  filled: string | null;
  remaining: string | null;
  avgFillPrice: number | null;
  permId: number | null;
  parentId: number | null;
  lastFillPrice: number | null;
  clientId: number | null;
  whyHeld: string | null;
  mktCapPrice: number | null;
};

export type StockOpenOrderContract = {
  conid: number | null;
  symbol: string;
  secType: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
  localSymbol: string;
  tradingClass: string;
};

export type StockOpenOrderDescriptor = {
  action: string;
  quantity: string;
  orderType: string;
  limitPrice: number | null;
  tif: string;
  account: string;
  outsideRth: boolean;
};

export type StockOpenOrder = {
  orderId: number;
  contract: StockOpenOrderContract;
  order: StockOpenOrderDescriptor;
  orderState: StockOrderPreviewState;
};

export type HeldStockSnapshotItem = {
  position: PositionRow;
  snapshot: MarketSnapshot | null;
  error: string | null;
};

export type HeldStockSnapshotsRequestOptions = {
  positions?: PositionsResponse;
  timeoutMs?: number;
  marketDataType?: MarketDataType;
};

export type StockPnLSnapshotRequestOptions = {
  account: string;
  conid: number;
  modelCode?: string;
  timeoutMs?: number;
};

export type StockPnLSnapshot = {
  reqId: number;
  account: string;
  modelCode: string;
  conid: number;
  position: string | null;
  dailyPnL: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  value: number | null;
  receivedAt: string;
};

export type HeldStockPnLSnapshotItem = {
  position: PositionRow;
  pnl: StockPnLSnapshot | null;
  error: string | null;
};

export type HeldStockPnLSnapshotsRequestOptions = {
  positions?: PositionsResponse;
  modelCode?: string;
  timeoutMs?: number;
};

export type StockOrderPreviewResponse = {
  orderId: number;
  requestedOrder: StockOrderRequest;
  preview: StockOrderPreviewState;
};

export type PendingStockOrderPreview = {
  deferred: Deferred<StockOrderPreviewResponse>;
  request: StockOrderRequest;
  timeoutId: Timer;
};

export type PendingStockPnLSnapshot = {
  deferred: Deferred<StockPnLSnapshot>;
  account: string;
  modelCode: string;
  conid: number;
  timeoutId: Timer;
};

export type StockOrderPlacementResponse = {
  orderId: number;
  requestedOrder: StockOrderPlaceRequest;
  orderState: StockOrderPreviewState | null;
  orderStatus: StockOrderStatus | null;
};

export type StockOrderModificationResponse = {
  orderId: number;
  requestedOrder: StockOrderModifyRequest;
  orderState: StockOrderPreviewState | null;
  orderStatus: StockOrderStatus | null;
};

export type PendingStockOrderPlacement = {
  deferred: Deferred<StockOrderPlacementResponse>;
  request: StockOrderPlaceRequest;
  timeoutId: Timer;
  settleTimeoutId: Timer | null;
  orderState: StockOrderPreviewState | null;
  orderStatus: StockOrderStatus | null;
};

export type StockOrderCancelRequestOptions = {
  orderId: number;
  manualOrderCancelTime?: string;
  timeoutMs?: number;
};

export type StockOrderCancellationResponse = {
  orderId: number;
  acknowledgedStatus: StockOrderStatus | null;
};

export type PendingStockOrderCancel = {
  deferred: Deferred<StockOrderCancellationResponse>;
  timeoutId: Timer;
};

export type OpenStockOrdersResponse = {
  orders: StockOpenOrder[];
};

export type HeldStockSnapshotsResponse = {
  items: HeldStockSnapshotItem[];
  totals: {
    requested: number;
    completed: number;
    failed: number;
  };
};

export type HeldStockPnLSnapshotsResponse = {
  items: HeldStockPnLSnapshotItem[];
  totals: {
    requested: number;
    completed: number;
    failed: number;
  };
};

export type StockScannerRequestOptions = {
  scanCode: string;
  instrument?: string;
  locationCode?: string;
  numberOfRows?: number;
  abovePrice?: number;
  belowPrice?: number;
  aboveVolume?: number;
  marketCapAbove?: number;
  marketCapBelow?: number;
  stockTypeFilter?: string;
  timeoutMs?: number;
};

export type StockScannerRow = {
  rank: number;
  conid: number;
  symbol: string;
  secType: string;
  lastTradeDateOrContractMonth: string;
  strike: number | null;
  right: string;
  exchange: string;
  currency: string;
  localSymbol: string;
  marketName: string;
  tradingClass: string;
  distance: string;
  benchmark: string;
  projection: string;
  legsStr: string;
};

export type StockScannerResponse = {
  reqId: number;
  scanCode: string;
  instrument: string;
  locationCode: string;
  rows: StockScannerRow[];
};

export type PendingStockScanner = {
  deferred: Deferred<StockScannerResponse>;
  scanCode: string;
  instrument: string;
  locationCode: string;
  timeoutId: Timer;
};

export type PendingOpenStockOrders = {
  deferred: Deferred<OpenStockOrdersResponse>;
  orders: StockOpenOrder[];
  timeoutId: Timer;
};

export type GatewayStatus = {
  connected: boolean;
  host: string | null;
  port: number | null;
  clientId: number | null;
  serverVersion: number | null;
  connectionTime: string | null;
  managedAccounts: string[];
  nextValidOrderId: number | null;
  marketDataType: MarketDataType | null;
};

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
};

export type ParsedErrorMessage = {
  id: number;
  errorCode: number;
  errorMessage: string;
  errorTime: number | null;
  advancedOrderRejectJson: string | null;
};

export type CurrentTimeResponse = {
  epochSeconds: number;
  isoTime: string;
};

export type ManagedAccountsResponse = {
  accounts: string[];
  raw: string;
};

export type NextValidOrderIdResponse = {
  orderId: number;
};

export type MarketDataTypeResponse = {
  marketDataType: MarketDataType | null;
  label: MarketDataTypeLabel;
};

export type StockSymbolSearchRequestOptions = {
  pattern: string;
  timeoutMs?: number;
  limit?: number;
};

export type StockSymbolSearchResponse = {
  reqId: number;
  pattern: string;
  matches: StockSymbolMatch[];
};

export type AccountSummaryRequestOptions = {
  group?: string;
  tags?: string;
  timeoutMs?: number;
};

export type PositionsRequestOptions = {
  timeoutMs?: number;
};

export type MarketDataSnapshotRequestOptions = {
  symbol: string;
  secType?: string;
  exchange?: string;
  primaryExchange?: string;
  currency?: string;
  marketDataType?: MarketDataType;
  genericTickList?: string;
  regulatorySnapshot?: boolean;
  timeoutMs?: number;
};

export type StockMarketSnapshotsRequestOptions = Omit<
  MarketDataSnapshotRequestOptions,
  "symbol"
> & {
  symbols: string[];
  batchConcurrency?: number;
};

export type StockMarketSnapshotItem = {
  symbol: string;
  snapshot: MarketSnapshot | null;
  error: string | null;
};

export type StockMarketSnapshotsResponse = {
  items: StockMarketSnapshotItem[];
  totals: {
    requested: number;
    completed: number;
    failed: number;
  };
  warnings: string[];
};

export type StockHistoricalBarsRequestOptions = {
  symbol: string;
  exchange?: string;
  primaryExchange?: string;
  currency?: string;
  endDateTime?: string;
  durationStr?: string;
  barSizeSetting?: string;
  whatToShow?: string;
  useRTH?: boolean;
  timeoutMs?: number;
};

export type GatewaySnapshotRequestOptions = {
  includeAccountSummary?: boolean;
  includePositions?: boolean;
  includeOpenOrders?: boolean;
  includeHeldStockSnapshots?: boolean;
  includeAccountLivePnl?: boolean;
  accountSummaryTimeoutMs?: number;
  positionsTimeoutMs?: number;
  openOrdersTimeoutMs?: number;
  heldStockSnapshotsTimeoutMs?: number;
  heldStockSnapshotsMarketDataType?: MarketDataType;
  accountLivePnlAccount?: string;
  accountLivePnlModelCode?: string;
  accountLivePnlTimeoutMs?: number;
};

export type GatewaySnapshotResponse = {
  status: GatewayStatus;
  currentTime: CurrentTimeResponse;
  managedAccounts: ManagedAccountsResponse;
  nextValidOrderId: NextValidOrderIdResponse;
  accountSummary?: AccountSummaryResponse;
  positions?: PositionsResponse;
  openOrders?: OpenStockOrdersResponse;
  heldStockSnapshots?: HeldStockSnapshotsResponse;
  accountLivePnl?: AccountPnLSnapshot;
  warnings: string[];
};
