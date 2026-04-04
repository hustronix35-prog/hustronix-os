import { definition as getCurrentTimeDef, handler as getCurrentTimeHandler } from "./get-current-time.js";
import { definition as rememberFactDef, handler as rememberFactHandler } from "./remember-fact.js";
import { definition as recallMemoryDef, handler as recallMemoryHandler } from "./recall-memory.js";
import { definition as webSearchDef, handler as webSearchHandler } from "./web-search.js";
import { definition as fileOpsDef, handler as fileOpsHandler } from "./file-ops.js";
import { definition as browserReadDef, handler as browserReadHandler } from "./browser.js";
import { addNodeDef, addNodeHandler, addEdgeDef, addEdgeHandler, searchGraphDef, searchGraphHandler } from "./graph-ops.js";
import { readInboxDef, readInboxHandler, readMessageDef, readMessageHandler, sendEmailDef, sendEmailHandler, replyEmailDef, replyEmailHandler } from "./email.js";
import { website_audit } from "./website-audit.js";
import { lead_logger } from "./lead-logger.js";
import { getMcpToolsAsOpenAIFormat, executeMcpTool } from "../mcp.js";
import { config } from "../config.js";

interface ToolDef {
  name: string;
  description: string;
  parameters: any;
  handler: (args: any) => Promise<any>;
}

const tools: Record<string, ToolDef> = {
  [rememberFactDef.name]: { ...rememberFactDef, handler: rememberFactHandler },
  [recallMemoryDef.name]: { ...recallMemoryDef, handler: recallMemoryHandler },
  [getCurrentTimeDef.name]: { ...getCurrentTimeDef, handler: getCurrentTimeHandler },
  [webSearchDef.name]: { ...webSearchDef, handler: webSearchHandler },
  [fileOpsDef.name]: { ...fileOpsDef, handler: fileOpsHandler },
  [browserReadDef.name]: { ...browserReadDef, handler: browserReadHandler },
  [addNodeDef.name]: { ...addNodeDef, handler: addNodeHandler },
  [addEdgeDef.name]: { ...addEdgeDef, handler: addEdgeHandler },
  [searchGraphDef.name]: { ...searchGraphDef, handler: searchGraphHandler },
  [website_audit.name]: { ...website_audit, handler: website_audit.execute },
  [lead_logger.name]: { ...lead_logger, handler: lead_logger.execute },
  // Email tools (conditionally registered)
  ...(config.email.enabled ? {
    [readInboxDef.name]: { ...readInboxDef, handler: readInboxHandler },
    [readMessageDef.name]: { ...readMessageDef, handler: readMessageHandler },
    [sendEmailDef.name]: { ...sendEmailDef, handler: sendEmailHandler },
    [replyEmailDef.name]: { ...replyEmailDef, handler: replyEmailHandler },
  } : {}),
};

export async function getOpenAITools() {
  const nativeTools = Object.values(tools).map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }
  }));

  const mcpTools = await getMcpToolsAsOpenAIFormat();
  return [...nativeTools, ...mcpTools];
}

export async function executeTool(name: string, args: string): Promise<string> {
  if (name.startsWith("mcp__")) {
    try {
      const parsedArgs = JSON.parse(args);
      const result = await executeMcpTool(name, parsedArgs);
      if (result.isError) {
        return `MCP Tool Error: ${result.content.map((c: any) => c.text).join('\n')}`;
      }
      return result.content.map((c: any) => c.text).join('\n');
    } catch (err: any) {
      return `❌ MCP Execution Failed: ${err.message}`;
    }
  }

  const tool = tools[name];
  if (!tool) {
    return `Error: Unknown tool "${name}"`;
  }

  try {
    const result = await tool.handler(JSON.parse(args));
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Error executing tool "${name}": ${err.message}`;
  }
}
