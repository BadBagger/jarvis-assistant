import { useEffect, useMemo, useState } from "react";
import { ChatPage } from "../chat/ChatPage";
import { buildModelRegistry } from "../models/registry";
import type { ModelCapability } from "../models/types";
import { memoryRepository } from "../memory/store";
import { taskPlanRepository } from "../planning/store";
import type { Settings, TaskPlan } from "../shared/types";
import {
  createToolExecutionContext,
  jarvisToolRegistry,
  toolAuditSink,
  type DirectoryEntry,
  type ListOutputFolderResult,
  type ToolAuditRecord,
  type ToolPermissionLevel,
} from "../tools";
import type { MemoryRecord } from "../memory/types";

interface AssistantWorkspaceProps {
  settings: Settings;
  onOpenView: (view: "plans" | "memory" | "settings") => void;
}

interface ArtifactSummary {
  images: number;
  documents: number;
  folders: number;
  other: number;
}

export function summarizeArtifacts(entries: DirectoryEntry[]): ArtifactSummary {
  return entries.reduce(
    (summary, entry) => {
      const name = entry.name.toLowerCase();
      if (entry.isDir) summary.folders += 1;
      else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) summary.images += 1;
      else if (/\.(docx|pdf|txt|md|rtf)$/i.test(name)) summary.documents += 1;
      else summary.other += 1;
      return summary;
    },
    { images: 0, documents: 0, folders: 0, other: 0 },
  );
}

export function approvalLabel(level: ToolPermissionLevel): string {
  switch (level) {
    case "read-only":
      return "Auto-read";
    case "reversible-write":
      return "Approval";
    case "external-network":
      return "Approval";
    case "dangerous":
      return "Blocked";
  }
}

function capabilityLabel(capability: ModelCapability): string {
  switch (capability) {
    case "image-generation":
      return "image";
    case "long-context":
      return "long";
    case "local-only":
      return "local";
    case "requires-network":
      return "network";
    default:
      return capability;
  }
}

function formatBytes(value?: number): string {
  if (value === undefined) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function activePlan(plans: TaskPlan[]): TaskPlan | null {
  return plans.find((plan) => plan.status === "in-progress") ?? plans.find((plan) => plan.status === "ready") ?? plans[0] ?? null;
}

export function AssistantWorkspace({ settings, onOpenView }: AssistantWorkspaceProps) {
  const [plans, setPlans] = useState<TaskPlan[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [artifacts, setArtifacts] = useState<DirectoryEntry[]>([]);
  const [artifactStatus, setArtifactStatus] = useState("Not loaded");
  const [auditRecords, setAuditRecords] = useState<ToolAuditRecord[]>([]);

  const modelRegistry = useMemo(() => buildModelRegistry(settings), [settings]);
  const tools = useMemo(() => jarvisToolRegistry.list(), []);
  const selectedPlan = useMemo(() => activePlan(plans), [plans]);
  const artifactSummary = useMemo(() => summarizeArtifacts(artifacts), [artifacts]);
  const pendingApprovals = auditRecords.filter((record) => record.status === "approval-required");

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  async function refreshWorkspace() {
    const [nextPlans, nextMemories, nextAuditRecords] = await Promise.all([
      taskPlanRepository.list().catch(() => [] as TaskPlan[]),
      memoryRepository.list().catch(() => [] as MemoryRecord[]),
      toolAuditSink.list(),
    ]);
    setPlans(nextPlans);
    setMemories(nextMemories);
    setAuditRecords(nextAuditRecords);
  }

  async function refreshArtifacts() {
    setArtifactStatus("Reading local output");
    const context = createToolExecutionContext(settings, "user");
    try {
      const result = await jarvisToolRegistry.run<{ limit: number }, ListOutputFolderResult>(
        "local.listOutputFolder",
        { limit: 24 },
        context,
        toolAuditSink,
      );
      setAuditRecords(await toolAuditSink.list());
      if (result.result) {
        setArtifacts(result.result.entries);
        setArtifactStatus(`${result.result.entries.length} local item(s)`);
      } else {
        setArtifactStatus(result.auditRecord.error ?? result.auditRecord.resultSummary ?? "No folder result");
      }
    } catch (err) {
      setArtifactStatus(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="workspace-page">
      <section className="workspace-chat-panel" aria-label="Conversation panel">
        <div className="workspace-panel-heading">
          <div>
            <p className="workspace-kicker">Conversation</p>
            <h2>Assistant</h2>
          </div>
          <span className="workspace-pill workspace-pill--ok">Local first</span>
        </div>
        <ChatPage settings={settings} />
      </section>

      <aside className="workspace-side-panel" aria-label="Assistant workspace status">
        <section className="workspace-card workspace-status-card">
          <div className="workspace-panel-heading">
            <div>
              <p className="workspace-kicker">Models and sources</p>
              <h2>Status</h2>
            </div>
            <button onClick={() => onOpenView("settings")}>Settings</button>
          </div>
          <div className="workspace-model-list">
            {modelRegistry.models.map((model) => (
              <article key={model.id}>
                <div>
                  <strong>{model.label}</strong>
                  <span>{model.baseUrl || "No local endpoint"}</span>
                </div>
                <span className={model.enabled ? "workspace-pill workspace-pill--ok" : "workspace-pill"}>{model.enabled ? "Ready" : "Off"}</span>
                <p>{model.capabilities.map(capabilityLabel).join(", ")}</p>
              </article>
            ))}
          </div>
          <div className="workspace-source-grid">
            <span>No cloud fallback</span>
            <span>Localhost only</span>
            <span>Manual saves</span>
            <span>Explicit recall</span>
          </div>
        </section>

        <section className="workspace-card">
          <div className="workspace-panel-heading">
            <div>
              <p className="workspace-kicker">Task plan</p>
              <h2>{selectedPlan?.title ?? "No active plan"}</h2>
            </div>
            <button onClick={() => onOpenView("plans")}>Open</button>
          </div>
          {selectedPlan ? (
            <>
              <p className="workspace-clamp">{selectedPlan.goal}</p>
              <div className="workspace-step-list">
                {selectedPlan.steps.slice(0, 5).map((step) => (
                  <article key={step.id}>
                    <span className={`workspace-step-dot workspace-step-dot--${step.status}`} />
                    <strong>{step.title}</strong>
                    <em>{step.status}</em>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="workspace-muted">Create a local plan before starting multi-step work.</p>
          )}
        </section>

        <section className="workspace-card">
          <div className="workspace-panel-heading">
            <div>
              <p className="workspace-kicker">Artifacts</p>
              <h2>Output panel</h2>
            </div>
            <button onClick={() => void refreshArtifacts()}>Refresh</button>
          </div>
          <div className="workspace-metrics">
            <span>{artifactSummary.images} images</span>
            <span>{artifactSummary.documents} docs</span>
            <span>{artifactSummary.folders} folders</span>
            <span>{artifactSummary.other} other</span>
          </div>
          <p className="workspace-status-line">{artifactStatus}</p>
          <div className="workspace-artifact-list">
            {artifacts.length === 0 ? (
              <p className="workspace-muted">No output folder snapshot loaded.</p>
            ) : (
              artifacts.slice(0, 6).map((entry) => (
                <article key={entry.path}>
                  <strong>{entry.name}</strong>
                  <span>{entry.isDir ? "Folder" : formatBytes(entry.sizeBytes)}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="workspace-card">
          <div className="workspace-panel-heading">
            <div>
              <p className="workspace-kicker">Memory controls</p>
              <h2>{memories.length} records</h2>
            </div>
            <button onClick={() => onOpenView("memory")}>Manage</button>
          </div>
          <div className="workspace-memory-list">
            {memories.length === 0 ? (
              <p className="workspace-muted">No local memories saved yet.</p>
            ) : (
              memories.slice(0, 4).map((memory) => (
                <article key={memory.id}>
                  <strong>{memory.title}</strong>
                  <span>{memory.type}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="workspace-card">
          <div className="workspace-panel-heading">
            <div>
              <p className="workspace-kicker">Tool approvals</p>
              <h2>{pendingApprovals.length ? `${pendingApprovals.length} pending` : "Clear"}</h2>
            </div>
            <button onClick={() => void refreshWorkspace()}>Reload</button>
          </div>
          <div className="workspace-approval-list">
            {tools.map((tool) => (
              <article key={tool.id}>
                <div>
                  <strong>{tool.title}</strong>
                  <span>{tool.permissionLevel}</span>
                </div>
                <em>{approvalLabel(tool.permissionLevel)}</em>
              </article>
            ))}
          </div>
          <div className="workspace-audit-list">
            {auditRecords.length === 0 ? (
              <p className="workspace-muted">No tool activity recorded.</p>
            ) : (
              auditRecords.slice(0, 4).map((record) => (
                <article key={record.id}>
                  <strong>{record.toolTitle}</strong>
                  <span>
                    {record.status} at {formatTime(record.requestedAt)}
                  </span>
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
