import { ToolRegistry } from "./registry";
import { listOutputFolderTool, readLocalAppHealthTool } from "./localTools";

export type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolAuditRecord,
  ToolDefinition,
  ToolDryRunMetadata,
  ToolExecutionContext,
  ToolInputField,
  ToolPermissionLevel,
  ToolRunOptions,
  ToolRunResult,
  ToolRunStatus,
} from "./types";
export type { ListOutputFolderResult, LocalAppHealthResult, DirectoryEntry } from "./localTools";
export { createToolExecutionContext, ToolRegistry } from "./registry";
export { toolAuditSink, InMemoryToolAuditSink, type ToolAuditSink } from "./audit";
export { listOutputFolderTool, readLocalAppHealthTool } from "./localTools";

export const jarvisToolRegistry = new ToolRegistry().register(listOutputFolderTool).register(readLocalAppHealthTool);
