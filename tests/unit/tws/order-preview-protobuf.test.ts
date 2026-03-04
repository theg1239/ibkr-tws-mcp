import { describe, expect, test } from "bun:test";
import {
  buildCancelOrderProtoPayload,
  buildPlaceOrderSubmitProtoPayload,
  buildPlaceOrderWhatIfProtoPayload,
  parseOpenOrderProto,
  parseOrderStatusProto,
  parseOpenOrderPreviewProto,
} from "../../../src/tws/order-preview-protobuf.ts";

describe("order-preview-protobuf", () => {
  test("builds a placeOrder payload with explicit default order controls", () => {
    const payload = buildPlaceOrderWhatIfProtoPayload({
      orderId: 91,
      clientId: 0,
      request: {
        symbol: "AAPL",
        action: "BUY",
        quantity: "1",
        orderType: "MKT",
        limitPrice: null,
        tif: "DAY",
        exchange: "SMART",
        primaryExchange: "",
        currency: "USD",
        account: "DU123456",
        outsideRth: false,
      },
    });

    expect(readVarintField(payload, 1)).toBe(91);
    const contractPayload = readLengthDelimitedField(payload, 2);
    expect(readVarintField(contractPayload, 1)).toBe(0);

    const orderPayload = readLengthDelimitedField(payload, 3);
    expect(readVarintField(orderPayload, 2)).toBe(91);
    expect(readVarintField(orderPayload, 3)).toBe(0);
    expect(readVarintField(orderPayload, 4)).toBe(0);
    expect(readVarintField(orderPayload, 7)).toBe(0);
    expect(readVarintField(orderPayload, 30)).toBe(0);
    expect(readVarintField(orderPayload, 31)).toBe(0);
    expect(readVarintField(orderPayload, 39)).toBe(0);
    expect(readVarintField(orderPayload, 43)).toBe(0);
    expect(readVarintField(orderPayload, 46)).toBe(0);
    expect(readVarintField(orderPayload, 65)).toBe(1);
    expect(readVarintField(orderPayload, 66)).toBe(1);
    expect(readVarintField(orderPayload, 69)).toBe(0);
    expect(readVarintField(orderPayload, 70)).toBe(0);
    expect(readVarintField(orderPayload, 88)).toBe(0);
    expect(readVarintField(orderPayload, 98)).toBe(0);
    expect(readVarintField(orderPayload, 116)).toBe(0);
    expect(readVarintField(orderPayload, 121)).toBe(0);
  });

  test("builds a live placeOrder payload without the what-if flag", () => {
    const payload = buildPlaceOrderSubmitProtoPayload({
      orderId: 92,
      clientId: 4,
      request: {
        symbol: "MSFT",
        action: "SELL",
        quantity: "2",
        orderType: "LMT",
        limitPrice: 420.25,
        tif: "DAY",
        exchange: "SMART",
        primaryExchange: "NASDAQ",
        currency: "USD",
        account: "DU654321",
        outsideRth: true,
      },
    });

    const orderPayload = readLengthDelimitedField(payload, 3);
    expect(readVarintField(orderPayload, 1)).toBe(4);
    expect(readVarintField(orderPayload, 2)).toBe(92);
    expect(readVarintField(orderPayload, 65)).toBe(0);
    expect(readVarintField(orderPayload, 66)).toBe(1);
    expect(readVarintField(orderPayload, 19)).toBe(1);
  });

  test("builds a cancelOrder payload", () => {
    const payload = buildCancelOrderProtoPayload({
      orderId: 101,
      manualOrderCancelTime: "20260304 05:30:00 IST",
    });

    expect(readVarintField(payload, 1)).toBe(101);
    const cancelPayload = readLengthDelimitedField(payload, 2);
    expect(readStringValue(cancelPayload, 1)).toBe("20260304 05:30:00 IST");
  });

  test("parses protobuf order status payloads", () => {
    const payload = encodeMessage([
      encodeVarintField(1, 88),
      encodeStringField(2, "Submitted"),
      encodeStringField(3, "1"),
      encodeStringField(4, "4"),
      encodeDoubleField(5, 201.5),
      encodeVarintField(6, 999),
      encodeVarintField(7, 0),
      encodeDoubleField(8, 201.5),
      encodeVarintField(9, 3),
      encodeStringField(10, "locate"),
      encodeDoubleField(11, 0),
    ]);

    expect(parseOrderStatusProto(payload)).toEqual({
      orderId: 88,
      status: "Submitted",
      filled: "1",
      remaining: "4",
      avgFillPrice: 201.5,
      permId: 999,
      parentId: 0,
      lastFillPrice: 201.5,
      clientId: 3,
      whyHeld: "locate",
      mktCapPrice: 0,
    });
  });

  test("parses a full protobuf open order payload", () => {
    const payload = buildDetailedOpenOrderPayload({
      orderId: 15,
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
      account: "DU123456",
      outsideRth: true,
      status: "Submitted",
    });

    expect(parseOpenOrderProto(payload)).toEqual({
      orderId: 15,
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
        account: "DU123456",
        outsideRth: true,
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
    });
  });

  test("parses open order preview state from a protobuf payload", () => {
    const payload = encodeMessage([
      encodeVarintField(1, 77),
      encodeMessageField(
        4,
        encodeMessage([
          encodeStringField(1, "PreSubmitted"),
          encodeDoubleField(5, 1250.5),
          encodeDoubleField(8, 51250.25),
          encodeDoubleField(11, 1.23),
          encodeStringField(14, "USD"),
          encodeStringField(15, "USD"),
          encodeStringField(26, "Preview only"),
          encodeStringField(28, "This is a preview."),
        ]),
      ),
    ]);

    expect(parseOpenOrderPreviewProto(payload)).toEqual({
      orderId: 77,
      preview: {
        status: "PreSubmitted",
        initMarginBefore: null,
        maintMarginBefore: null,
        equityWithLoanBefore: null,
        initMarginChange: 1250.5,
        maintMarginChange: null,
        equityWithLoanChange: null,
        initMarginAfter: 51250.25,
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
        rejectReason: "Preview only",
        warningText: "This is a preview.",
      },
    });
  });
});

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

function readVarintField(payload: Uint8Array, fieldNumber: number): number | null {
  let offset = 0;

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const currentFieldNumber = keyData.value >>> 3;
    const wireType = keyData.value & 0x7;

    if (wireType === 0) {
      const valueData = readVarint(payload, offset);
      if (currentFieldNumber === fieldNumber) {
        return valueData.value;
      }

      offset = valueData.nextOffset;
      continue;
    }

    offset = skipField(payload, offset, wireType);
  }

  return null;
}

function readLengthDelimitedField(payload: Uint8Array, fieldNumber: number): Uint8Array {
  let offset = 0;

  while (offset < payload.byteLength) {
    const keyData = readVarint(payload, offset);
    offset = keyData.nextOffset;
    const currentFieldNumber = keyData.value >>> 3;
    const wireType = keyData.value & 0x7;

    if (wireType === 2) {
      const lengthData = readVarint(payload, offset);
      const valueStart = lengthData.nextOffset;
      const valueEnd = valueStart + lengthData.value;
      const value = payload.slice(valueStart, valueEnd);

      if (currentFieldNumber === fieldNumber) {
        return value;
      }

      offset = valueEnd;
      continue;
    }

    offset = skipField(payload, offset, wireType);
  }

  throw new Error(`Missing length-delimited field ${fieldNumber}.`);
}

function readStringValue(payload: Uint8Array, fieldNumber: number): string | null {
  const value = readLengthDelimitedField(payload, fieldNumber);
  return new TextDecoder().decode(value);
}

function readVarint(
  payload: Uint8Array,
  startOffset: number,
): { value: number; nextOffset: number } {
  let offset = startOffset;
  let shift = 0;
  let value = 0;

  while (offset < payload.byteLength) {
    const byte = payload[offset]!;
    offset += 1;
    value |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return {
        value,
        nextOffset: offset,
      };
    }

    shift += 7;
  }

  throw new Error("Invalid varint.");
}

function skipField(payload: Uint8Array, startOffset: number, wireType: number): number {
  if (wireType === 0) {
    return readVarint(payload, startOffset).nextOffset;
  }

  if (wireType === 1) {
    return startOffset + 8;
  }

  if (wireType === 2) {
    const lengthData = readVarint(payload, startOffset);
    return lengthData.nextOffset + lengthData.value;
  }

  if (wireType === 5) {
    return startOffset + 4;
  }

  throw new Error(`Unsupported wire type ${wireType}.`);
}
