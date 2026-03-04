import type {
  StockOpenOrder,
  StockOpenOrderContract,
  SocketBuffer,
  StockOrderCancelRequestOptions,
  StockOrderPlaceRequest,
  StockOrderRequest,
  StockOrderPreviewState,
  StockOrderStatus,
} from "./types.ts";

const textEncoder = new TextEncoder();
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

export type ParsedOpenOrderPreviewProto = {
  orderId: number;
  preview: StockOrderPreviewState;
};

export type ParsedOpenOrderProto = StockOpenOrder;

export type ParsedOrderStatusProto = StockOrderStatus;

export function buildPlaceOrderWhatIfProtoPayload(input: {
  orderId: number;
  clientId: number;
  request: StockOrderRequest;
}): SocketBuffer {
  return buildPlaceOrderProtoPayload({
    orderId: input.orderId,
    clientId: input.clientId,
    request: input.request,
    whatIf: true,
  });
}

export function buildPlaceOrderSubmitProtoPayload(input: {
  orderId: number;
  clientId: number;
  request: StockOrderPlaceRequest;
}): SocketBuffer {
  return buildPlaceOrderProtoPayload({
    orderId: input.orderId,
    clientId: input.clientId,
    request: input.request,
    whatIf: false,
  });
}

export function buildCancelOrderProtoPayload(
  input: StockOrderCancelRequestOptions,
): SocketBuffer {
  const orderCancelPayload = encodeMessage([
    encodeStringField(1, input.manualOrderCancelTime?.trim() || ""),
  ]);

  return encodeMessage([
    encodeInt32Field(1, input.orderId),
    encodeMessageField(2, orderCancelPayload),
  ]);
}

export function parseOrderStatusProto(payload: SocketBuffer): ParsedOrderStatusProto {
  let offset = 0;
  const status: ParsedOrderStatusProto = {
    orderId: 0,
    status: null,
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

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    switch (fieldNumber) {
      case 1: {
        const fieldData = readIntField(payload, offset, wireType);
        offset = fieldData.nextOffset;
        status.orderId = fieldData.value ?? 0;
        continue;
      }
      case 2:
        ({ nextOffset: offset, value: status.status } = readStringField(payload, offset, wireType));
        continue;
      case 3:
        ({ nextOffset: offset, value: status.filled } = readStringField(payload, offset, wireType));
        continue;
      case 4:
        ({ nextOffset: offset, value: status.remaining } = readStringField(payload, offset, wireType));
        continue;
      case 5:
        ({ nextOffset: offset, value: status.avgFillPrice } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 6:
        ({ nextOffset: offset, value: status.permId } = readIntField(payload, offset, wireType));
        continue;
      case 7:
        ({ nextOffset: offset, value: status.parentId } = readIntField(payload, offset, wireType));
        continue;
      case 8:
        ({ nextOffset: offset, value: status.lastFillPrice } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 9:
        ({ nextOffset: offset, value: status.clientId } = readIntField(payload, offset, wireType));
        continue;
      case 10:
        ({ nextOffset: offset, value: status.whyHeld } = readStringField(payload, offset, wireType));
        continue;
      case 11:
        ({ nextOffset: offset, value: status.mktCapPrice } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      default:
        break;
    }

    offset = skipField(payload, offset, wireType);
  }

  return status;
}

export function parseOpenOrderProto(payload: SocketBuffer): ParsedOpenOrderProto {
  let offset = 0;
  let orderId = 0;
  let contract = createEmptyOpenOrderContract();
  let order = createEmptyOpenOrderDescriptor();
  let preview = createEmptyPreviewState();

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    if (fieldNumber === 1 && wireType === WIRE_TYPE_VARINT) {
      const valueData = readVarint(payload, offset);
      orderId = Number(valueData.value);
      offset = valueData.nextOffset;
      continue;
    }

    if (fieldNumber === 2 && wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const messageData = readLengthDelimited(payload, offset);
      contract = parseContractProto(messageData.value);
      offset = messageData.nextOffset;
      continue;
    }

    if (fieldNumber === 3 && wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const messageData = readLengthDelimited(payload, offset);
      order = parseOrderProto(messageData.value);
      offset = messageData.nextOffset;
      continue;
    }

    if (fieldNumber === 4 && wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const messageData = readLengthDelimited(payload, offset);
      preview = parseOrderStateProto(messageData.value);
      offset = messageData.nextOffset;
      continue;
    }

    offset = skipField(payload, offset, wireType);
  }

  return {
    orderId,
    contract,
    order,
    orderState: preview,
  };
}

function buildPlaceOrderProtoPayload(input: {
  orderId: number;
  clientId: number;
  request: StockOrderRequest;
  whatIf: boolean;
}): SocketBuffer {
  const normalizedContractPayload = encodeMessage([
    encodeInt32Field(1, 0),
    encodeStringField(2, input.request.symbol),
    encodeStringField(3, "STK"),
    encodeStringField(8, input.request.exchange),
    encodeStringField(9, input.request.primaryExchange),
    encodeStringField(10, input.request.currency),
  ]);
  const orderPayload = encodeMessage([
    encodeInt32Field(1, input.clientId),
    encodeInt32Field(2, input.orderId),
    encodeInt64Field(3, 0n),
    encodeInt32Field(4, 0),
    encodeStringField(5, input.request.action),
    encodeStringField(6, input.request.quantity),
    encodeInt32Field(7, 0),
    encodeStringField(8, input.request.orderType),
    encodeDoubleField(9, input.request.limitPrice),
    encodeStringField(11, input.request.tif),
    encodeStringField(12, input.request.account),
    encodeBoolField(19, input.request.outsideRth),
    encodeInt32Field(30, 0),
    encodeInt32Field(31, 0),
    encodePresentBoolField(39, false),
    encodeInt32Field(43, 0),
    encodeInt32Field(46, 0),
    encodePresentBoolField(65, input.whatIf),
    encodePresentBoolField(66, true),
    encodeInt32Field(69, 0),
    encodeInt32Field(70, 0),
    encodeInt32Field(88, 0),
    encodeInt32Field(98, 0),
    encodeInt32Field(116, 0),
    encodeInt64Field(121, 0n),
  ]);

  return encodeMessage([
    encodeInt32Field(1, input.orderId),
    encodeMessageField(2, normalizedContractPayload),
    encodeMessageField(3, orderPayload),
  ]);
}

export function parseOpenOrderPreviewProto(payload: SocketBuffer): ParsedOpenOrderPreviewProto {
  const parsed = parseOpenOrderProto(payload);

  return {
    orderId: parsed.orderId,
    preview: parsed.orderState,
  };
}

function parseContractProto(payload: SocketBuffer): StockOpenOrderContract {
  let offset = 0;
  const contract = createEmptyOpenOrderContract();

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    switch (fieldNumber) {
      case 1:
        ({ nextOffset: offset, value: contract.conid } = readIntField(payload, offset, wireType));
        continue;
      case 2:
        ({ nextOffset: offset, value: contract.symbol } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.symbol,
        ));
        continue;
      case 3:
        ({ nextOffset: offset, value: contract.secType } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.secType,
        ));
        continue;
      case 8:
        ({ nextOffset: offset, value: contract.exchange } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.exchange,
        ));
        continue;
      case 9:
        ({ nextOffset: offset, value: contract.primaryExchange } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.primaryExchange,
        ));
        continue;
      case 10:
        ({ nextOffset: offset, value: contract.currency } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.currency,
        ));
        continue;
      case 11:
        ({ nextOffset: offset, value: contract.localSymbol } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.localSymbol,
        ));
        continue;
      case 12:
        ({ nextOffset: offset, value: contract.tradingClass } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          contract.tradingClass,
        ));
        continue;
      default:
        break;
    }

    offset = skipField(payload, offset, wireType);
  }

  return contract;
}

function parseOrderProto(payload: SocketBuffer): StockOpenOrder["order"] {
  let offset = 0;
  const order = createEmptyOpenOrderDescriptor();

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    switch (fieldNumber) {
      case 5:
        ({ nextOffset: offset, value: order.action } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          order.action,
        ));
        continue;
      case 6:
        ({ nextOffset: offset, value: order.quantity } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          order.quantity,
        ));
        continue;
      case 8:
        ({ nextOffset: offset, value: order.orderType } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          order.orderType,
        ));
        continue;
      case 9:
        ({ nextOffset: offset, value: order.limitPrice } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 11:
        ({ nextOffset: offset, value: order.tif } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          order.tif,
        ));
        continue;
      case 12:
        ({ nextOffset: offset, value: order.account } = readNonEmptyStringField(
          payload,
          offset,
          wireType,
          order.account,
        ));
        continue;
      case 19:
        ({ nextOffset: offset, value: order.outsideRth } = readBoolField(
          payload,
          offset,
          wireType,
        ));
        continue;
      default:
        break;
    }

    offset = skipField(payload, offset, wireType);
  }

  return order;
}

function parseOrderStateProto(payload: SocketBuffer): StockOrderPreviewState {
  let offset = 0;
  const preview = createEmptyPreviewState();

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const fieldNumber = Number(keyData.value >> 3n);
    const wireType = Number(keyData.value & 0x7n);

    switch (fieldNumber) {
      case 1:
        if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
          const fieldData = readLengthDelimited(payload, offset);
          preview.status = decodeString(fieldData.value);
          offset = fieldData.nextOffset;
          continue;
        }
        break;
      case 2:
        ({ nextOffset: offset, value: preview.initMarginBefore } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 3:
        ({ nextOffset: offset, value: preview.maintMarginBefore } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 4:
        ({ nextOffset: offset, value: preview.equityWithLoanBefore } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 5:
        ({ nextOffset: offset, value: preview.initMarginChange } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 6:
        ({ nextOffset: offset, value: preview.maintMarginChange } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 7:
        ({ nextOffset: offset, value: preview.equityWithLoanChange } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 8:
        ({ nextOffset: offset, value: preview.initMarginAfter } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 9:
        ({ nextOffset: offset, value: preview.maintMarginAfter } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 10:
        ({ nextOffset: offset, value: preview.equityWithLoanAfter } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 11:
        ({ nextOffset: offset, value: preview.commissionAndFees } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 12:
        ({ nextOffset: offset, value: preview.minCommissionAndFees } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 13:
        ({ nextOffset: offset, value: preview.maxCommissionAndFees } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 14:
        ({ nextOffset: offset, value: preview.commissionAndFeesCurrency } = readStringField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 15:
        ({ nextOffset: offset, value: preview.marginCurrency } = readStringField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 16:
        ({ nextOffset: offset, value: preview.initMarginBeforeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 17:
        ({ nextOffset: offset, value: preview.maintMarginBeforeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 18:
        ({ nextOffset: offset, value: preview.equityWithLoanBeforeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 19:
        ({ nextOffset: offset, value: preview.initMarginChangeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 20:
        ({ nextOffset: offset, value: preview.maintMarginChangeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 21:
        ({ nextOffset: offset, value: preview.equityWithLoanChangeOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 22:
        ({ nextOffset: offset, value: preview.initMarginAfterOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 23:
        ({ nextOffset: offset, value: preview.maintMarginAfterOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 24:
        ({ nextOffset: offset, value: preview.equityWithLoanAfterOutsideRth } = readDoubleField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 25:
        ({ nextOffset: offset, value: preview.suggestedSize } = readStringField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 26:
        ({ nextOffset: offset, value: preview.rejectReason } = readStringField(
          payload,
          offset,
          wireType,
        ));
        continue;
      case 28:
        ({ nextOffset: offset, value: preview.warningText } = readStringField(
          payload,
          offset,
          wireType,
        ));
        continue;
      default:
        break;
    }

    offset = skipField(payload, offset, wireType);
  }

  return preview;
}

function createEmptyPreviewState(): StockOrderPreviewState {
  return {
    status: null,
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
  };
}

function createEmptyOpenOrderContract(): StockOpenOrderContract {
  return {
    conid: null,
    symbol: "",
    secType: "",
    exchange: "",
    primaryExchange: "",
    currency: "",
    localSymbol: "",
    tradingClass: "",
  };
}

function createEmptyOpenOrderDescriptor(): StockOpenOrder["order"] {
  return {
    action: "",
    quantity: "",
    orderType: "",
    limitPrice: null,
    tif: "",
    account: "",
    outsideRth: false,
  };
}

function encodeMessage(parts: ReadonlyArray<Uint8Array | null>): SocketBuffer {
  const filteredParts = parts.filter((part): part is Uint8Array => part !== null);
  const totalLength = filteredParts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of filteredParts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function encodeInt32Field(fieldNumber: number, value: number): Uint8Array | null {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }

  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_VARINT));
  const encodedValue = encodeVarint(BigInt(value));
  return encodeMessage([key, encodedValue]);
}

function encodeStringField(fieldNumber: number, value: string): Uint8Array | null {
  if (!value) {
    return null;
  }

  const encodedString = textEncoder.encode(value);
  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_LENGTH_DELIMITED));
  const length = encodeVarint(BigInt(encodedString.byteLength));
  return encodeMessage([key, length, encodedString]);
}

function encodeInt64Field(fieldNumber: number, value: bigint): Uint8Array | null {
  if (value < 0n) {
    return null;
  }

  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_VARINT));
  const encodedValue = encodeVarint(value);
  return encodeMessage([key, encodedValue]);
}

function encodeBoolField(fieldNumber: number, value: boolean): Uint8Array | null {
  if (!value) {
    return null;
  }

  return encodePresentBoolField(fieldNumber, value);
}

function encodePresentBoolField(fieldNumber: number, value: boolean): Uint8Array {
  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_VARINT));
  const encodedValue = encodeVarint(value ? 1n : 0n);
  return encodeMessage([key, encodedValue]);
}

function encodeDoubleField(fieldNumber: number, value: number | null): Uint8Array | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_FIXED64));
  const encodedValue = new Uint8Array(8);
  new DataView(encodedValue.buffer).setFloat64(0, value, true);
  return encodeMessage([key, encodedValue]);
}

function encodeMessageField(fieldNumber: number, value: SocketBuffer): Uint8Array | null {
  if (value.byteLength === 0) {
    return null;
  }

  const key = encodeVarint(BigInt((fieldNumber << 3) | WIRE_TYPE_LENGTH_DELIMITED));
  const length = encodeVarint(BigInt(value.byteLength));
  return encodeMessage([key, length, value]);
}

function encodeVarint(value: bigint): Uint8Array {
  let remaining = value;
  const bytes: number[] = [];

  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;

    if (remaining > 0n) {
      byte |= 0x80;
    }

    bytes.push(byte);
  } while (remaining > 0n);

  return Uint8Array.from(bytes);
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
  }

  throw new Error("Invalid protobuf varint.");
}

function readLengthDelimited(
  buffer: SocketBuffer,
  startOffset: number,
): {
  value: SocketBuffer;
  nextOffset: number;
} {
  const lengthData = readVarint(buffer, startOffset);
  const length = Number(lengthData.value);
  const valueStart = lengthData.nextOffset;
  const valueEnd = valueStart + length;

  if (valueEnd > buffer.byteLength) {
    throw new Error("Invalid protobuf length-delimited field.");
  }

  return {
    value: buffer.slice(valueStart, valueEnd),
    nextOffset: valueEnd,
  };
}

function readDoubleField(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
): {
  value: number | null;
  nextOffset: number;
} {
  if (wireType !== WIRE_TYPE_FIXED64) {
    return {
      value: null,
      nextOffset: skipField(buffer, startOffset, wireType),
    };
  }

  const endOffset = startOffset + 8;
  if (endOffset > buffer.byteLength) {
    throw new Error("Invalid protobuf fixed64 field.");
  }

  return {
    value: new DataView(
      buffer.buffer,
      buffer.byteOffset + startOffset,
      8,
    ).getFloat64(0, true),
    nextOffset: endOffset,
  };
}

function readIntField(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
): {
  value: number | null;
  nextOffset: number;
} {
  if (wireType !== WIRE_TYPE_VARINT) {
    return {
      value: null,
      nextOffset: skipField(buffer, startOffset, wireType),
    };
  }

  const fieldData = readVarint(buffer, startOffset);
  return {
    value: Number(fieldData.value),
    nextOffset: fieldData.nextOffset,
  };
}

function readStringField(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
): {
  value: string | null;
  nextOffset: number;
} {
  if (wireType !== WIRE_TYPE_LENGTH_DELIMITED) {
    return {
      value: null,
      nextOffset: skipField(buffer, startOffset, wireType),
    };
  }

  const fieldData = readLengthDelimited(buffer, startOffset);
  return {
    value: decodeString(fieldData.value),
    nextOffset: fieldData.nextOffset,
  };
}

function readNonEmptyStringField<TFallback extends string>(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
  fallback: TFallback,
): {
  value: string;
  nextOffset: number;
} {
  const fieldData = readStringField(buffer, startOffset, wireType);
  return {
    value: fieldData.value ?? fallback,
    nextOffset: fieldData.nextOffset,
  };
}

function readBoolField(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
): {
  value: boolean;
  nextOffset: number;
} {
  const fieldData = readIntField(buffer, startOffset, wireType);
  return {
    value: fieldData.value === 1,
    nextOffset: fieldData.nextOffset,
  };
}

function skipField(
  buffer: SocketBuffer,
  startOffset: number,
  wireType: number,
): number {
  if (wireType === WIRE_TYPE_VARINT) {
    return readVarint(buffer, startOffset).nextOffset;
  }

  if (wireType === WIRE_TYPE_FIXED64) {
    const nextOffset = startOffset + 8;
    if (nextOffset > buffer.byteLength) {
      throw new Error("Invalid protobuf fixed64 field.");
    }

    return nextOffset;
  }

  if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    return readLengthDelimited(buffer, startOffset).nextOffset;
  }

  if (wireType === WIRE_TYPE_FIXED32) {
    const nextOffset = startOffset + 4;
    if (nextOffset > buffer.byteLength) {
      throw new Error("Invalid protobuf fixed32 field.");
    }

    return nextOffset;
  }

  throw new Error(`Unsupported protobuf wire type ${wireType}.`);
}

function decodeString(value: SocketBuffer): string {
  return new TextDecoder().decode(value);
}
