import { invoke } from "@tauri-apps/api/core";
import type { HealthCheckResult } from "../shared/health";
import type { ToolApprovalRequest, ToolDefinition, ToolExecutionContext } from "./types";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes?: number;
  modifiedMs?: number;
}

interface ListOutputFolderInput {
  limit?: number;
}

export interface ListOutputFolderResult {
  outputDir: string;
  entries: DirectoryEntry[];
  truncatedAt: number;
}

export interface LocalAppHealthResult {
  checks: HealthCheckResult[];
  appDataDir: string;
  outputDir: string;
}

function readOnlyApprovalRequest(toolId: string, title: string, context: ToolExecutionContext, requestId: string): ToolApprovalRequest {
  return {
    id: requestId,
    toolId,
    permissionLevel: "read-only",
    title,
    description: "Read-only local tools do not require approval.",
    requestedAt: context.now().toISOString(),
    inputSummary: "No approval required.",
    proposedAction: "Read local application metadata only.",
    riskSummary: "No files, settings, services, or external systems will be changed.",
    dryRunAvailable: true,
    dryRunDefault: false,
    approveLabel: "Allow",
    rejectLabel: "Cancel",
  };
}

export const listOutputFolderTool: ToolDefinition<ListOutputFolderInput, ListOutputFolderResult> = {
  id: "local.listOutputFolder",
  title: "List output folder",
  description: "Lists generated files in the configured Jarvis output folder.",
  permissionLevel: "read-only",
  dryRun: {
    supported: true,
    defaultDryRun: false,
    previewKind: "file-list",
    notes: "Dry-run reports the folder path and item limit without reading the directory.",
  },
  inputFields: [
    {
      name: "limit",
      label: "Limit",
      type: "number",
      required: false,
      description: "Maximum number of folder entries to return, capped by the backend at 500.",
    },
  ],
  summarizeInput: (input) => `Output folder with limit ${input.limit ?? 100}`,
  summarizeResult: (result) => `${result.entries.length} entr${result.entries.length === 1 ? "y" : "ies"} in ${result.outputDir}`,
  buildApprovalRequest: (_input, context, requestId) =>
    readOnlyApprovalRequest("local.listOutputFolder", "List output folder", context, requestId),
  execute: async (input, context, options) => {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    if (options.dryRun) {
      return {
        outputDir: context.settings.outputDir,
        entries: [],
        truncatedAt: limit,
      };
    }

    const entries = await invoke<DirectoryEntry[]>("list_directory", {
      path: context.settings.outputDir,
      limit,
    });
    return {
      outputDir: context.settings.outputDir,
      entries,
      truncatedAt: limit,
    };
  },
};

export const readLocalAppHealthTool: ToolDefinition<Record<string, never>, LocalAppHealthResult> = {
  id: "local.readAppHealth",
  title: "Read app health",
  description: "Reads local Jarvis configuration health without probing external or network services.",
  permissionLevel: "read-only",
  dryRun: {
    supported: true,
    defaultDryRun: false,
    previewKind: "text",
    notes: "Dry-run returns the health checks that would be inspected without calling Tauri.",
  },
  inputFields: [],
  summarizeInput: () => "Local app health snapshot",
  summarizeResult: (result) => `${result.checks.filter((check) => check.ok).length}/${result.checks.length} local checks passing`,
  buildApprovalRequest: (_input, context, requestId) =>
    readOnlyApprovalRequest("local.readAppHealth", "Read app health", context, requestId),
  execute: async (_input, context, options) => {
    const checks: HealthCheckResult[] = [
      {
        id: "ollama",
        label: "Ollama settings",
        ok: context.settings.ollamaBaseUrl.trim().length > 0 && context.settings.chatModel.trim().length > 0,
        message: "Local settings contain an Ollama base URL and chat model.",
      },
      {
        id: "imageGen",
        label: "Image generation settings",
        ok: context.settings.imageGenBaseUrl.trim().length > 0,
        message: "Local settings contain an image generation base URL.",
      },
    ];

    return {
      checks,
      appDataDir: options.dryRun ? "(not read during dry-run)" : await invoke<string>("app_data_dir"),
      outputDir: context.settings.outputDir,
    };
  },
};
