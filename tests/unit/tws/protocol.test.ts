import { describe, expect, test } from "bun:test";
import {
  applyTickValue,
  createDeferred,
  encodeApiMessage,
  parseProtobufErrorMessage,
  readBigEndianInt,
  splitNullFields,
} from "../../../src/tws/protocol.ts";

describe("protocol", () => {
  test("createDeferred settles only once", async () => {
    const deferred = createDeferred<number>();

    deferred.resolve(7);
    deferred.resolve(9);
    deferred.reject(new Error("ignored"));

    expect(await deferred.promise).toBe(7);
    expect(deferred.settled).toBe(true);
  });

  test("encodeApiMessage writes a raw message id when requested", () => {
    const message = encodeApiMessage(59, [1, 3], true);

    expect(readBigEndianInt(message, 0)).toBe(message.byteLength - 4);
    expect(readBigEndianInt(message, 4)).toBe(59);
    expect(splitNullFields(message.slice(8))).toEqual(["1", "3"]);
  });

  test("splitNullFields removes the trailing delimiter", () => {
    const payload = new TextEncoder().encode("foo\0bar\0");
    expect(splitNullFields(payload)).toEqual(["foo", "bar"]);
  });

  test("applyTickValue stores both mapped and raw values", () => {
    const fields: Record<string, string | number | null> = {};
    const rawTicks: Record<string, string | number | null> = {};

    applyTickValue(fields, rawTicks, 1, 101.25);

    expect(fields.bid).toBe(101.25);
    expect(rawTicks["1"]).toBe(101.25);
  });

  test("parseProtobufErrorMessage decodes the modern error payload", () => {
    const payload = Uint8Array.from([
      ...encodeVarintField(1, 42n),
      ...encodeVarintField(2, 1_706_000_000n),
      ...encodeVarintField(3, 321n),
      ...encodeStringField(4, "No market data permissions"),
      ...encodeStringField(5, "{\"status\":\"rejected\"}"),
    ]);

    expect(parseProtobufErrorMessage(payload)).toEqual({
      id: 42,
      errorCode: 321,
      errorMessage: "No market data permissions",
      errorTime: 1_706_000_000,
      advancedOrderRejectJson: "{\"status\":\"rejected\"}",
    });
  });
});

function encodeVarintField(fieldNumber: number, value: bigint): number[] {
  return [...encodeVarint(BigInt(fieldNumber << 3)), ...encodeVarint(value)];
}

function encodeStringField(fieldNumber: number, value: string): number[] {
  const encoded = new TextEncoder().encode(value);
  return [
    ...encodeVarint(BigInt((fieldNumber << 3) | 2)),
    ...encodeVarint(BigInt(encoded.byteLength)),
    ...encoded,
  ];
}

function encodeVarint(value: bigint): number[] {
  let remaining = value;
  const bytes: number[] = [];

  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }

  bytes.push(Number(remaining));
  return bytes;
}
