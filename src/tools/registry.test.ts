import { describe, expect, it, vi } from "vitest";
import { InMemoryToolAuditSink } from "./audit";
import { ToolRegistry } from "./registry";
import type { Settings } from "../shared/types";
import type { ToolDefinition, ToolExecutionContext, ToolPermissionLevel } from "./types";

interface MockInput {
  target: string;
}

interface MockResult {
  message: string;
}

const settings: Settings = {
  version: 1,
  ollamaBaseUrl: "http://localhost:11434",
  chatModel: "llama3.1",
  visionModel: "llava",
  imageGenBaseUrl: "http://127.0.0.1:7860",
  outputDir: "C:/Jarvis/Output",
};

function testContext(): ToolExecutionContext {
  return {
    settings,
    actor: "assistant",
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  };
}

function mockTool(permissionLevel: ToolPermissionLevel, execute = vi.fn().mockResolvedValue({ message: "executed" })): ToolDefinition<MockInput, MockResult> {
  return {
    id: `mock.${permissionLevel}`,
    title: `Mock ${permissionLevel}`,
    description: "Mock tool for registry tests.",
    permissionLevel,
    dryRun: {
      supported: true,
      defaultDryRun: permissionLevel !== "read-only",
      previewKind: "text",
    },
    inputFields: [
      {
        name: "target",
        label: "Target",
        type: "string",
        required: true,
      },
    ],
    summarizeInput: (input) => `target=${input.target}`,
    summarizeResult: (result) => result.message,
    buildApprovalRequest: (input, context, requestId) => ({
      id: requestId,
      toolId: `mock.${permissionLevel}`,
      permissionLevel,
      title: `Approve mock ${permissionLevel}`,
      description: "Approval request for registry tests.",
      requestedAt: context.now().toISOString(),
      inputSummary: `target=${input.target}`,
      proposedAction: `Act on ${input.target}`,
      riskSummary: "Test-only risk summary.",
      dryRunAvailable: true,
      dryRunDefault: permissionLevel !== "read-only",
      approveLabel: "Approve",
      rejectLabel: "Reject",
    }),
    execute,
  };
}

describe("ToolRegistry permission gating and audit logs", () => {
  it("runs read-only tools without approval and writes a completed audit record", async () => {
    const execute = vi.fn().mockResolvedValue({ message: "executed" });
    const registry = new ToolRegistry().register(mockTool("read-only", execute));
    const auditSink = new InMemoryToolAuditSink();

    const run = await registry.run<MockInput, MockResult>("mock.read-only", { target: "health" }, testContext(), auditSink);

    expect(execute).toHaveBeenCalledOnce();
    expect(run.result).toEqual({ message: "executed" });
    expect(run.approvalRequest).toBeUndefined();
    expect(run.auditRecord).toMatchObject({
      toolId: "mock.read-only",
      permissionLevel: "read-only",
      status: "completed",
      dryRun: false,
      inputSummary: "target=health",
      resultSummary: "executed",
    });
    await expect(auditSink.list()).resolves.toEqual([run.auditRecord]);
  });

  it.each<ToolPermissionLevel>(["reversible-write", "external-network", "dangerous"])(
    "requires approval before running %s tools",
    async (permissionLevel) => {
      const execute = vi.fn();
      const registry = new ToolRegistry().register(mockTool(permissionLevel, execute));
      const auditSink = new InMemoryToolAuditSink();

      const run = await registry.run<MockInput, MockResult>(`mock.${permissionLevel}`, { target: "output" }, testContext(), auditSink);

      expect(execute).not.toHaveBeenCalled();
      expect(run.result).toBeUndefined();
      expect(run.approvalRequest).toMatchObject({
        toolId: `mock.${permissionLevel}`,
        permissionLevel,
        inputSummary: "target=output",
        proposedAction: "Act on output",
        dryRunAvailable: true,
        dryRunDefault: true,
      });
      expect(run.auditRecord).toMatchObject({
        toolId: `mock.${permissionLevel}`,
        permissionLevel,
        status: "approval-required",
        dryRun: true,
        approvalRequestId: run.approvalRequest?.id,
      });
      await expect(auditSink.list()).resolves.toEqual([run.auditRecord]);
    },
  );

  it("blocks rejected approvals and records the decision in the audit log", async () => {
    const execute = vi.fn();
    const registry = new ToolRegistry().register(mockTool("reversible-write", execute));
    const auditSink = new InMemoryToolAuditSink();
    const firstRun = await registry.run<MockInput, MockResult>("mock.reversible-write", { target: "file.txt" }, testContext(), auditSink);

    const rejectedRun = await registry.run<MockInput, MockResult>("mock.reversible-write", { target: "file.txt" }, testContext(), auditSink, {
      approval: {
        requestId: firstRun.approvalRequest!.id,
        approved: false,
        decidedAt: "2026-07-23T12:01:00.000Z",
        decidedBy: "user",
      },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(rejectedRun.auditRecord).toMatchObject({
      status: "blocked",
      approvalRequestId: firstRun.approvalRequest!.id,
      resultSummary: "User rejected the approval request.",
    });
    await expect(auditSink.list()).resolves.toEqual([rejectedRun.auditRecord, firstRun.auditRecord]);
  });

  it("runs approved gated tools and keeps approval metadata in the audit log", async () => {
    const execute = vi.fn().mockResolvedValue({ message: "executed" });
    const registry = new ToolRegistry().register(mockTool("external-network", execute));
    const auditSink = new InMemoryToolAuditSink();
    const firstRun = await registry.run<MockInput, MockResult>("mock.external-network", { target: "webhook" }, testContext(), auditSink);

    const approvedRun = await registry.run<MockInput, MockResult>("mock.external-network", { target: "webhook" }, testContext(), auditSink, {
      dryRun: false,
      approval: {
        requestId: firstRun.approvalRequest!.id,
        approved: true,
        decidedAt: "2026-07-23T12:01:00.000Z",
        decidedBy: "user",
      },
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(approvedRun.result).toEqual({ message: "executed" });
    expect(approvedRun.auditRecord).toMatchObject({
      status: "completed",
      dryRun: false,
      approvalRequestId: firstRun.approvalRequest!.id,
      resultSummary: "executed",
    });
  });

  it("records failed executions without throwing away the audit record", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("tool failed"));
    const registry = new ToolRegistry().register(mockTool("read-only", execute));
    const auditSink = new InMemoryToolAuditSink();

    const run = await registry.run<MockInput, MockResult>("mock.read-only", { target: "health" }, testContext(), auditSink);

    expect(run.result).toBeUndefined();
    expect(run.auditRecord).toMatchObject({
      status: "failed",
      error: "tool failed",
    });
    await expect(auditSink.list()).resolves.toEqual([run.auditRecord]);
  });
});
