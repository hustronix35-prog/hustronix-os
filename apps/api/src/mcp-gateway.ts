import type { AuthKind } from "./middleware/auth.js";
import { executeSecuredTool } from "./security/security-gateway.js";
import { executeMcpTool } from "./mcp.js";
import { config } from "./config.js";

const MCP_TOOL_PREFIX = /^mcp__/;

export function isMcpToolName(toolName: string): boolean {
  return MCP_TOOL_PREFIX.test(toolName);
}

/**
 * Route MCP tool calls through UnifiedSecurityBoundary (executeSecuredTool).
 * Default-deny in production when MCP servers are not configured.
 */
export async function executeSecuredMcpTool(params: {
  userId: string;
  authKind?: AuthKind | string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  approvalId?: string;
}): Promise<string> {
  if (config.server.isProduction && !process.env.MCP_ALLOW_PRODUCTION?.trim()) {
    throw new Error("MCP tools are disabled in production (set MCP_ALLOW_PRODUCTION=1 to enable).");
  }

  return executeSecuredTool(
    {
      userId: params.userId,
      authKind: params.authKind,
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      approvalId: params.approvalId,
    },
    async (input: Record<string, unknown>) => {
      const result = await executeMcpTool(params.toolName, input);
      return JSON.stringify(result);
    },
  );
}
