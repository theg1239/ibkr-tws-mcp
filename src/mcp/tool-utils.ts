export function textResult(text: string, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export type ToolTextResult = ReturnType<typeof textResult>;

export function wrapTool<Args>(
  handler: (args: Args) => Promise<unknown> | unknown,
): (args: Args, _extra?: unknown) => Promise<ToolTextResult> {
  return async (args) => {
    try {
      const result = await handler(args);

      if (typeof result === "string") {
        return textResult(result);
      }

      return textResult(toJson(result));
    } catch (error) {
      const message = formatError(error);
      console.error(message);
      return textResult(message, true);
    }
  };
}
