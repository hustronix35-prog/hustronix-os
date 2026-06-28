import { definition as getCurrentTimeDef, handler as getCurrentTimeHandler } from "./get-current-time.js";
import { definition as rememberFactDef, handler as rememberFactHandler } from "./remember-fact.js";
import { definition as recallMemoryDef, handler as recallMemoryHandler } from "./recall-memory.js";
import { definition as webSearchDef, handler as webSearchHandler } from "./web-search.js";
import {
  updateDomainStateDefinition,
  updateDomainStateHandler,
} from "./update-domain-state.js";

/** Shared web search tool for sub-agents (no email / browser / Telegram / Slack). */
const webSearchTool = { ...webSearchDef, handler: webSearchHandler };
const updateDomainStateTool = {
  ...updateDomainStateDefinition,
  handler: updateDomainStateHandler,
};

export const growthTools = [webSearchTool];

export const opsTools = [webSearchTool];

export const researchTools = [webSearchTool, updateDomainStateTool];

export const marketingTools = [webSearchTool, updateDomainStateTool];

export const memoryTools = [
  { ...rememberFactDef, handler: rememberFactHandler },
  { ...recallMemoryDef, handler: recallMemoryHandler },
  { ...getCurrentTimeDef, handler: getCurrentTimeHandler },
];

export const tools = [...memoryTools, webSearchTool];
