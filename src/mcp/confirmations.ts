import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_ARGUMENT_PREVIEW_LENGTH = 1500;
const UNSAFE_AUTO_APPROVE_ENV_VAR = "IBKR_MCP_ALLOW_UNSUPPORTED_ELICITATION";

type ApprovalServer = Pick<McpServer, "server">;

type ToolApprovalRequest = {
  toolName: string;
  description: string;
  args: unknown;
};

type ApprovalForm = {
  approved?: boolean;
};

type ElicitationModes = {
  form: boolean;
  url: boolean;
};

export type ToolApprovalDecision =
  | {
      status: "approved";
    }
  | {
      status: "declined";
    }
  | {
      status: "unavailable";
      reason: string;
      supportedModes: ElicitationModes;
      unsafeAutoApproveEnabled: boolean;
    };

type ApprovalServerWithCapabilities = ApprovalServer["server"] & {
  getClientCapabilities?: () => {
    elicitation?: {
      form?: Record<string, unknown>;
      url?: Record<string, unknown>;
    };
  } | undefined;
};

export function createApprovalDeclinedResult(toolName: string) {
  return {
    status: "cancelled",
    toolName,
    message: "Tool execution was not approved by the user.",
  };
}

export function createApprovalUnavailableResult(
  toolName: string,
  decision: Extract<ToolApprovalDecision, { status: "unavailable" }>,
) {
  return {
    status: "approval_unavailable",
    toolName,
    message: decision.reason,
    clientElicitation: decision.supportedModes,
    fallback: {
      unsafeAutoApproveEnvVar: UNSAFE_AUTO_APPROVE_ENV_VAR,
      unsafeAutoApproveEnabled: decision.unsafeAutoApproveEnabled,
      guidance: [
        "Use an MCP client that supports form elicitation for per-call approval.",
        `Or, for a fully trusted local setup only, set ${UNSAFE_AUTO_APPROVE_ENV_VAR}=1 to auto-approve when elicitation is unavailable.`,
      ],
    },
  };
}

export function buildApprovalMessage({ toolName, description, args }: ToolApprovalRequest): string {
  return [
    `Approve tool "${toolName}"?`,
    description,
    "Arguments:",
    formatArgumentsPreview(args),
  ].join("\n\n");
}

export async function requestToolApproval(
  server: ApprovalServer,
  request: ToolApprovalRequest,
): Promise<ToolApprovalDecision> {
  const supportedModes = getSupportedElicitationModes(server);
  const unsafeAutoApproveEnabled = shouldUnsafeAutoApprove();

  if (!supportedModes.form) {
    if (unsafeAutoApproveEnabled) {
      return {
        status: "approved",
      };
    }

    return {
      status: "unavailable",
      reason:
        "This MCP client does not support form elicitation, so this server cannot safely request per-call approval.",
      supportedModes,
      unsafeAutoApproveEnabled,
    };
  }

  try {
    const result = await server.server.elicitInput({
      mode: "form",
      message: buildApprovalMessage(request),
      requestedSchema: {
        type: "object",
        properties: {
          approved: {
            type: "boolean",
            title: "Approve",
            description: "Enable this tool call to run.",
            default: false,
          },
        },
        required: ["approved"],
      },
    });

    if (result.action !== "accept" || !result.content) {
      return {
        status: "declined",
      };
    }

    return (result.content as ApprovalForm).approved === true
      ? {
          status: "approved",
        }
      : {
          status: "declined",
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isUnsupportedFormElicitationError(message)) {
      if (unsafeAutoApproveEnabled) {
        return {
          status: "approved",
        };
      }

      return {
        status: "unavailable",
        reason:
          "This MCP client rejected form elicitation support, so this server cannot safely request per-call approval.",
        supportedModes,
        unsafeAutoApproveEnabled,
      };
    }

    throw error;
  }
}

function isUnsupportedFormElicitationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("client does not support form elicitation") ||
    (normalized.includes("form") &&
      normalized.includes("elicitation") &&
      (normalized.includes("not support") || normalized.includes("unsupported")))
  );
}

function getSupportedElicitationModes(server: ApprovalServer): ElicitationModes {
  const approvalServer = server.server as ApprovalServerWithCapabilities;
  if (typeof approvalServer.getClientCapabilities !== "function") {
    return {
      form: true,
      url: false,
    };
  }

  const capabilities = approvalServer.getClientCapabilities();
  const elicitation = capabilities?.elicitation;

  if (!elicitation) {
    return {
      form: false,
      url: false,
    };
  }

  const declaredKeys = Object.keys(elicitation);
  const treatEmptyCapabilityAsForm = declaredKeys.length === 0;

  return {
    form: treatEmptyCapabilityAsForm || Boolean(elicitation.form),
    url: Boolean(elicitation.url),
  };
}

function shouldUnsafeAutoApprove(): boolean {
  return Bun.env[UNSAFE_AUTO_APPROVE_ENV_VAR] === "1";
}

function formatArgumentsPreview(args: unknown): string {
  const serialized = serializeArguments(args);
  if (serialized.length <= MAX_ARGUMENT_PREVIEW_LENGTH) {
    return serialized;
  }

  return `${serialized.slice(0, MAX_ARGUMENT_PREVIEW_LENGTH)}\n...`;
}

function serializeArguments(args: unknown): string {
  if (args === undefined) {
    return "{}";
  }

  const serialized = JSON.stringify(args, null, 2);
  return serialized ?? "{}";
}
