import { describe, expect, test } from "bun:test";
import { wrapTool } from "../../../src/mcp/tool-utils.ts";

describe("tool-utils", () => {
  test("wrapTool returns plain text for string payloads", async () => {
    const handler = wrapTool(async () => "ok");
    const result = await handler(undefined);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "ok",
        },
      ],
    });
  });

  test("wrapTool serializes object payloads as formatted json", async () => {
    const handler = wrapTool(async () => ({
      status: "connected",
      nextValidOrderId: 1,
    }));
    const result = await handler(undefined);

    expect(result.content[0]?.text).toBe(
      '{\n  "status": "connected",\n  "nextValidOrderId": 1\n}',
    );
  });

  test("wrapTool marks thrown errors as tool errors", async () => {
    const originalConsoleError = console.error;
    let loggedMessage = "";
    console.error = (...args) => {
      loggedMessage = args.join(" ");
    };

    try {
      const handler = wrapTool(async () => {
        throw new Error("boom");
      });
      const result = await handler(undefined);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("boom");
      expect(loggedMessage).toContain("boom");
    } finally {
      console.error = originalConsoleError;
    }
  });
});
