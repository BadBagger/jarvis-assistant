import { describeError } from "../shared/errors";
import type {
  ToolAuditRecord,
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissionLevel,
  ToolRunOptions,
  ToolRunResult,
  ToolRunStatus,
} from "./types";
import type { ToolAuditSink } from "./audit";

type AnyToolDefinition = ToolDefinition<unknown, unknown>;

const APPROVAL_REQUIRED: ToolPermissionLevel[] = ["reversible-write", "external-network", "dangerous"];

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function shouldRequireApproval(permissionLevel: ToolPermissionLevel): boolean {
  return APPROVAL_REQUIRED.includes(permissionLevel);
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register<TInput, TResult>(tool: ToolDefinition<TInput, TResult>): this {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool as AnyToolDefinition);
    return this;
  }

  get(toolId: string): AnyToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async run<TInput, TResult>(
    toolId: string,
    input: TInput,
    context: ToolExecutionContext,
    auditSink: ToolAuditSink,
    options: ToolRunOptions = {},
  ): Promise<ToolRunResult<TResult>> {
    const tool = this.tools.get(toolId) as ToolDefinition<TInput, TResult> | undefined;
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    const dryRun = options.dryRun ?? tool.dryRun.defaultDryRun;
    const requestedAt = context.now().toISOString();
    const baseAuditRecord: Omit<ToolAuditRecord, "status"> = {
      id: createId("audit"),
      toolId: tool.id,
      toolTitle: tool.title,
      permissionLevel: tool.permissionLevel,
      actor: context.actor,
      dryRun,
      requestedAt,
      inputSummary: tool.summarizeInput(input),
    };

    if (shouldRequireApproval(tool.permissionLevel)) {
      const approvalRequestId = options.approval?.requestId ?? createId("approval");
      const approvalRequest = tool.buildApprovalRequest(input, context, approvalRequestId);
      const approval = options.approval;
      if (!approval || approval.requestId !== approvalRequest.id) {
        const auditRecord: ToolAuditRecord = {
          ...baseAuditRecord,
          status: "approval-required",
          approvalRequestId: approvalRequest.id,
          completedAt: context.now().toISOString(),
        };
        await auditSink.append(auditRecord);
        return { auditRecord, approvalRequest };
      }
      if (!approval.approved) {
        const auditRecord: ToolAuditRecord = {
          ...baseAuditRecord,
          status: "blocked",
          approvalRequestId: approvalRequest.id,
          completedAt: context.now().toISOString(),
          resultSummary: "User rejected the approval request.",
        };
        await auditSink.append(auditRecord);
        return { auditRecord };
      }
    }

    if (dryRun && !tool.dryRun.supported) {
      const auditRecord: ToolAuditRecord = {
        ...baseAuditRecord,
        status: "blocked",
        completedAt: context.now().toISOString(),
        error: "Dry-run requested, but this tool does not support dry-run previews.",
      };
      await auditSink.append(auditRecord);
      return { auditRecord };
    }

    try {
      const result = await tool.execute(input, context, { dryRun });
      const status: ToolRunStatus = dryRun ? "dry-run" : "completed";
      const auditRecord: ToolAuditRecord = {
        ...baseAuditRecord,
        status,
        completedAt: context.now().toISOString(),
        resultSummary: tool.summarizeResult(result),
      };
      await auditSink.append(auditRecord);
      return { result, auditRecord };
    } catch (error) {
      const auditRecord: ToolAuditRecord = {
        ...baseAuditRecord,
        status: "failed",
        completedAt: context.now().toISOString(),
        error: describeError(error),
      };
      await auditSink.append(auditRecord);
      return { auditRecord };
    }
  }
}

export function createToolExecutionContext(settings: ToolExecutionContext["settings"], actor: ToolExecutionContext["actor"]): ToolExecutionContext {
  return {
    settings,
    actor,
    now: () => new Date(),
  };
}
