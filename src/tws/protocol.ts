import type {
  Deferred,
  GatewayConfig,
  MarketDataType,
  ParsedErrorMessage,
  ProtocolField,
  SocketBuffer,
  TickValue,
} from "./types.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const PROTOCOL = {
  minClientVersion: 100,
  maxClientVersion: 203,
  minServerVerTradingClass: 68,
  minServerVerLinking: 70,
  minServerVerOptionalCapabilities: 72,
  minServerVerReqMatchingSymbols: 108,
  minServerVerPnl: 127,
  minServerVerUnrealizedPnl: 129,
  minServerVerRealizedPnl: 135,
  minServerVerScannerGenericOpts: 143,
  minServerVerSyntRealtimeBars: 124,
  minServerVerAdvancedOrderReject: 166,
  minServerVerBondIssuerId: 176,
  minServerVerErrorTime: 194,
  minServerVerHistoricalDataEnd: 196,
  minServerVerProtoBuf: 201,
  minServerVerProtoBufPlaceOrder: 203,
  protoBufMessageOffset: 200,
  connectStartupGraceMs: 500,
  connectBootstrapTimeoutMs: 3000,
  snapshotCurrentTimeCacheMs: 5000,
  accountPnlCacheMs: 2000,
  orderPlacementSettleWindowMs: 250,
} as const;

export const OUTGOING = {
  REQ_MKT_DATA: 1,
  CANCEL_MKT_DATA: 2,
  PLACE_ORDER: 3,
  CANCEL_ORDER: 4,
  REQ_OPEN_ORDERS: 5,
  REQ_IDS: 8,
  REQ_HISTORICAL_DATA: 20,
  REQ_SCANNER_SUBSCRIPTION: 22,
  CANCEL_SCANNER_SUBSCRIPTION: 23,
  REQ_SCANNER_PARAMETERS: 24,
  CANCEL_HISTORICAL_DATA: 25,
  REQ_MANAGED_ACCTS: 17,
  REQ_CURRENT_TIME: 49,
  REQ_MARKET_DATA_TYPE: 59,
  REQ_POSITIONS: 61,
  REQ_ACCOUNT_SUMMARY: 62,
  CANCEL_ACCOUNT_SUMMARY: 63,
  CANCEL_POSITIONS: 64,
  START_API: 71,
  REQ_MATCHING_SYMBOLS: 81,
  REQ_PNL: 92,
  CANCEL_PNL: 93,
  REQ_PNL_SINGLE: 94,
  CANCEL_PNL_SINGLE: 95,
} as const;

export const INCOMING = {
  TICK_PRICE: 1,
  TICK_SIZE: 2,
  ORDER_STATUS: 3,
  ERR_MSG: 4,
  OPEN_ORDER: 5,
  NEXT_VALID_ID: 9,
  HISTORICAL_DATA: 17,
  SCANNER_DATA: 20,
  MANAGED_ACCTS: 15,
  CURRENT_TIME: 49,
  OPEN_ORDER_END: 53,
  TICK_SNAPSHOT_END: 57,
  MARKET_DATA_TYPE: 58,
  POSITION: 61,
  POSITION_END: 62,
  ACCOUNT_SUMMARY: 63,
  ACCOUNT_SUMMARY_END: 64,
  SYMBOL_SAMPLES: 79,
  PNL: 94,
  PNL_SINGLE: 95,
  HISTORICAL_DATA_END: 108,
} as const;

export const PRICE_TICK_TO_SIZE_TICK = new Map<number, number>([
  [1, 0],
  [2, 3],
  [4, 5],
  [66, 69],
  [67, 70],
  [68, 71],
]);

export const MARKET_DATA_TYPE_LABELS: Record<MarketDataType, string> = {
  1: "live",
  2: "frozen",
  3: "delayed",
  4: "delayed-frozen",
};

export const TICK_LABELS: Record<number, string> = {
  0: "bidSize",
  1: "bid",
  2: "ask",
  3: "askSize",
  4: "last",
  5: "lastSize",
  6: "high",
  7: "low",
  8: "volume",
  9: "close",
  14: "open",
  68: "delayedLast",
  69: "delayedBidSize",
  70: "delayedAskSize",
  71: "delayedLastSize",
};

export const DEFAULT_ACCOUNT_SUMMARY_TAGS = [
  "NetLiquidation",
  "TotalCashValue",
  "BuyingPower",
  "AvailableFunds",
  "ExcessLiquidity",
  "InitMarginReq",
  "MaintMarginReq",
].join(",");

export const DEFAULT_GATEWAY_CONFIG = {
  host: Bun.env.IB_HOST?.trim() || "127.0.0.1",
  port: Number.parseInt(Bun.env.IB_PORT || "", 10) || 4002,
  clientId: Number.parseInt(Bun.env.IB_CLIENT_ID || "", 10) || 0,
} satisfies GatewayConfig;

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const deferred: Deferred<T> = {
    promise: new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = (value) => {
        if (deferred.settled) {
          return;
        }

        deferred.settled = true;
        resolvePromise(value);
      };

      reject = (reason) => {
        if (deferred.settled) {
          return;
        }

        deferred.settled = true;
        rejectPromise(reason);
      };
    }),
    resolve: () => {},
    reject: () => {},
    settled: false,
  };

  deferred.resolve = resolve;
  deferred.reject = reject;

  return deferred;
}

export function toBigEndianInt(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

export function readBigEndianInt(bytes: SocketBuffer, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0);
}

export function concatBytes(parts: ReadonlyArray<SocketBuffer>): SocketBuffer {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

export function appendBytes(base: SocketBuffer, extra: SocketBuffer): SocketBuffer {
  if (base.byteLength === 0) {
    return Uint8Array.from(extra);
  }

  const result = new Uint8Array(base.byteLength + extra.byteLength);
  result.set(base, 0);
  result.set(extra, base.byteLength);
  return result;
}

export function encodeField(value: ProtocolField): Uint8Array {
  if (value === null || value === undefined) {
    return Uint8Array.of(0);
  }

  const stringValue = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  const encoded = textEncoder.encode(stringValue);
  const result = new Uint8Array(encoded.byteLength + 1);
  result.set(encoded, 0);
  result[result.byteLength - 1] = 0;
  return result;
}

export function encodeApiMessage(
  messageId: number,
  fields: ReadonlyArray<ProtocolField>,
  useRawMessageId: boolean,
): SocketBuffer {
  const prefix = useRawMessageId ? toBigEndianInt(messageId) : encodeField(messageId);
  const payload = concatBytes([prefix, ...fields.map((field) => encodeField(field))]);
  return concatBytes([toBigEndianInt(payload.byteLength), payload]);
}

export function encodeProtoApiMessage(
  messageId: number,
  payload: SocketBuffer,
): SocketBuffer {
  const framedPayload = concatBytes([
    toBigEndianInt(messageId + PROTOCOL.protoBufMessageOffset),
    payload,
  ]);
  return concatBytes([toBigEndianInt(framedPayload.byteLength), framedPayload]);
}

export function splitNullFields(payload: SocketBuffer): string[] {
  const fields = textDecoder.decode(payload).split("\0");

  if (fields[fields.length - 1] === "") {
    fields.pop();
  }

  return fields;
}

export function parseIntField(value: string | undefined, fallback = 0): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseFloatField(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDecimalField(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  return value;
}

export function joinAccountsList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deadlineError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms.`);
}

export function applyTickValue(
  fields: Record<string, TickValue>,
  rawTicks: Record<string, TickValue>,
  tickType: number,
  value: TickValue,
) {
  const label = TICK_LABELS[tickType] || `tick_${tickType}`;
  fields[label] = value;
  rawTicks[String(tickType)] = value;
}

function readVarint(
  buffer: SocketBuffer,
  startOffset: number,
): {
  value: bigint;
  nextOffset: number;
} {
  let offset = startOffset;
  let shift = 0n;
  let value = 0n;

  while (offset < buffer.byteLength) {
    const byte = buffer[offset]!;
    offset += 1;
    value |= BigInt(byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return {
        value,
        nextOffset: offset,
      };
    }

    shift += 7n;

    if (shift > 70n) {
      break;
    }
  }

  throw new Error("Invalid protobuf varint.");
}

export function parseProtobufErrorMessage(payload: SocketBuffer): ParsedErrorMessage {
  let offset = 0;
  let id = 0;
  let errorCode = 0;
  let errorMessage = "";
  let errorTime: number | null = null;
  let advancedOrderRejectJson: string | null = null;

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    if (wireType === 0) {
      const valueData = readVarint(payload, offset);
      offset = valueData.nextOffset;

      if (fieldNumber === 1) {
        id = Number(BigInt.asIntN(32, valueData.value));
      } else if (fieldNumber === 2) {
        errorTime = Number(BigInt.asIntN(64, valueData.value));
      } else if (fieldNumber === 3) {
        errorCode = Number(BigInt.asIntN(32, valueData.value));
      }

      continue;
    }

    if (wireType === 2) {
      const lengthData = readVarint(payload, offset);
      offset = lengthData.nextOffset;
      const length = Number(lengthData.value);
      const text = textDecoder.decode(payload.slice(offset, offset + length));
      offset += length;

      if (fieldNumber === 4) {
        errorMessage = text;
      } else if (fieldNumber === 5) {
        advancedOrderRejectJson = text;
      }

      continue;
    }

    throw new Error(`Unsupported protobuf wire type ${wireType}.`);
  }

  return {
    id,
    errorCode,
    errorMessage,
    errorTime,
    advancedOrderRejectJson,
  };
}
