import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config as appConfig } from "./config.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

// Global state map tracking initialized server clients
export const mcpClients = new Map<string, Client>();
export const mcpTransports = new Map<string, StdioClientTransport>();

/**
 * Reads mcp_config.json and spins up the child processes via StdioClientTransport.
 */
export async function initMcpServers() {
  const configPath = path.join(appConfig.paths.repoRoot, "mcp_config.json");
  
  if (!fs.existsSync(configPath)) {
    console.log("ℹ️ No mcp_config.json found. Skipping MCP integration.");
    return;
  }

  const fileContent = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(fileContent) as McpConfig;

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers || {})) {
    console.log(`🔌 Initializing MCP server: [${serverName}]`);
    
    // Create the Standard I/O transport mapping parent <-> child process
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: (serverConfig.env ? { ...process.env, ...serverConfig.env } : process.env) as Record<string, string>,
    });

    const client = new Client(
      { name: "Hustronix", version: "1.0.0" },
      { capabilities: { tools: {} } } as any
    );

    try {
      await client.connect(transport);
      mcpClients.set(serverName, client);
      mcpTransports.set(serverName, transport);
      console.log(`✅ Connected to MCP: [${serverName}]`);
    } catch (err) {
      console.error(`❌ Failed to connect MCP: [${serverName}]`, err);
    }
  }
}

/**
 * Shut down all MCP subprocesses cleanly.
 */
export async function shutdownMcpServers() {
  for (const [serverName, transport] of mcpTransports.entries()) {
    console.log(`Shutting down MCP: [${serverName}]`);
    try {
      await transport.close();
    } catch (err) {
      console.error(`Error closing MCP transport [${serverName}]:`, err);
    }
  }
}

/**
 * Convert dynamic MCP tools into the uniform OpenAI Tool definition expected by the LLM.
 */
export async function getMcpToolsAsOpenAIFormat() {
  const openaiTools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    try {
      const toolList = await client.listTools();
      
      for (const t of toolList.tools) {
        // We namespace the tool name so we know which MCP server owns it
        // Format: mcp__<serverName>__<toolName>
        const namespacedName = `mcp__${serverName}__${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        
        openaiTools.push({
          type: "function",
          function: {
            name: namespacedName,
            description: `[MCP: ${serverName}] ${t.description || ""}`,
            parameters: t.inputSchema, // MCP schemas conveniently match JSON Schema 
          }
        });
      }
    } catch (err) {
      console.error(`Warning: Could not list tools for MCP [${serverName}]`, err);
    }
  }
  
  return openaiTools;
}

/**
 * Execute an MCP tool via the SDK by routing the namespaced name.
 */
export async function executeMcpTool(namespacedName: string, args: any): Promise<CallToolResult> {
  // Format is mcp__<serverName>__<originalToolName>
  const match = namespacedName.match(/^mcp__([a-zA-Z0-9_-]+)__(.+)$/);
  if (!match) {
    throw new Error(`Invalid MCP tool name format: ${namespacedName}`);
  }

  const serverName = match[1];
  const toolName = match[2];

  const client = mcpClients.get(serverName);
  if (!client) {
    throw new Error(`MCP server [${serverName}] not found or not connected.`);
  }

  return await client.callTool({
    name: toolName,
    arguments: args,
  }) as any;
}
