import type { Settings } from "../shared/types";

export type ToolPermissionLevel = "read-only" | "reversible-write" | "external-network" | "dangerous";

export type ToolRunStatus = "completed" | "dry-run" | "approval-required" | "blocked" | "failed";

export interface ToolDryRunMetadata {
  supported: boolean;
  defaultDryRun: boolean;
  previewKind: "none" | "text" | "diff" | "file-list" | "network-request";
  notes?: string;
}

export interface ToolInputField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  description?: string;
  options?: string[];
}

export interface ToolApprovalRequest {
  id: string;
  toolId: string;
  permissionLevel: ToolPermissionLevel;
  title: string;
  description: string;
  requestedAt: string;
  inputSummary: string;
  proposedAction: string;
  riskSummary: string;
  dryRunAvailable: boolean;
  dryRunDefault: boolean;
  approveLabel: string;
  rejectLabel: string;
}

export interface ToolAuditRecord {
  id: string;
  toolId: string;
  toolTitle: string;
  permissionLevel: ToolPermissionLevel;
  status: ToolRunStatus;
  actor: "assistant" | "user";
  dryRun: boolean;
  requestedAt: string;
  completedAt?: string;
  inputSummary: string;
  resultSummary?: string;
  error?: string;
  approvalRequestId?: string;
}

export interface ToolExecutionContext {
  settings: Settings;
  actor: "assistant" | "user";
  now: () => Date;
}

export interface ToolRunOptions {
  dryRun?: boolean;
  approval?: ToolApprovalDecision;
}

export interface ToolApprovalDecision {
  requestId: string;
  approved: boolean;
  decidedAt: string;
  decidedBy: "user";
}

export interface ToolDefinition<TInput, TResult> {
  id: string;
  title: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  dryRun: ToolDryRunMetadata;
  inputFields: ToolInputField[];
  summarizeInput: (input: TInput) => string;
  summarizeResult: (result: TResult) => string;
  buildApprovalRequest: (input: TInput, context: ToolExecutionContext, requestId: string) => ToolApprovalRequest;
  execute: (input: TInput, context: ToolExecutionContext, options: Required<Pick<ToolRunOptions, "dryRun">>) => Promise<TResult>;
}

export interface ToolRunResult<TResult> {
  result?: TResult;
  auditRecord: ToolAuditRecord;
  approvalRequest?: ToolApprovalRequest;
}
