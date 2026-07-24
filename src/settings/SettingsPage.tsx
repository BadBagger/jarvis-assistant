import { useEffect, useMemo, useState } from "react";
import { checkBackendHealth, type HealthCheckResult } from "../shared/health";
import { saveSettings } from "../shared/persistence";
import type { Settings } from "../shared/types";
import { buildModelRegistry } from "../models/registry";
import type { ModelCapability, ModelDescriptor } from "../models/types";
import {
  createToolExecutionContext,
  jarvisToolRegistry,
  toolAuditSink,
  type DirectoryEntry,
  type ListOutputFolderResult,
  type ToolAuditRecord,
  type ToolPermissionLevel,
} from "../tools";

interface Props {
  settings: Settings;
  onSaved: (settings: Settings) => void;
}

export function SettingsPage({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [status, setStatus] = useState<string | null>(null);
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [healthStatus, setHealthStatus] = useState<string>("Not checked yet.");
  const [outputEntries, setOutputEntries] = useState<DirectoryEntry[]>([]);
  const [outputStatus, setOutputStatus] = useState<string>("Not loaded yet.");
  const [auditRecords, setAuditRecords] = useState<ToolAuditRecord[]>([]);

  const tools = useMemo(() => jarvisToolRegistry.list(), []);
  const modelRegistry = useMemo(() => buildModelRegistry(draft), [draft]);
  const generatedCounts = useMemo(() => {
    return outputEntries.reduce(
      (counts, entry) => {
        const name = entry.name.toLowerCase();
        if (entry.isDir) counts.folders += 1;
        else if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")) counts.images += 1;
        else if (name.endsWith(".docx") || name.endsWith(".pdf") || name.endsWith(".txt") || name.endsWith(".md")) counts.documents += 1;
        else counts.other += 1;
        return counts;
      },
      { images: 0, documents: 0, folders: 0, other: 0 },
    );
  }, [outputEntries]);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void refreshAudit();
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setStatus(null);
    try {
      await saveSettings(draft);
      onSaved(draft);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function runHealthCheck() {
    setHealthStatus("Checking local backends...");
    const checks = await checkBackendHealth(draft);
    setHealthChecks(checks);
    setHealthStatus(`${checks.filter((check) => check.ok).length}/${checks.length} services ready.`);
  }

  async function refreshOutputFolder() {
    setOutputStatus("Reading output folder...");
    try {
      const context = createToolExecutionContext(draft, "user");
      const result = await jarvisToolRegistry.run<{ limit: number }, ListOutputFolderResult>(
        "local.listOutputFolder",
        { limit: 50 },
        context,
        toolAuditSink,
      );
      await refreshAudit();
      if (result.result) {
        setOutputEntries(result.result.entries);
        setOutputStatus(`${result.result.entries.length} item(s) in ${result.result.outputDir}`);
      } else {
        setOutputStatus(result.auditRecord.error ?? result.auditRecord.resultSummary ?? "Folder read did not return entries.");
      }
    } catch (err) {
      setOutputStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshAudit() {
    setAuditRecords(await toolAuditSink.list());
  }

  function approvalCopy(level: ToolPermissionLevel) {
    switch (level) {
      case "read-only":
        return "Auto-allowed";
      case "reversible-write":
        return "Ask first";
      case "external-network":
        return "Ask first";
      case "dangerous":
        return "Blocked until approved";
    }
  }

  function formatBytes(value?: number) {
    if (value === undefined) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(ms?: number) {
    return ms ? new Date(ms).toLocaleString() : "";
  }

  function healthForModel(model: ModelDescriptor): HealthCheckResult | undefined {
    const healthId = model.provider === "automatic1111" ? "imageGen" : model.provider;
    return healthChecks.find((check) => check.id === healthId);
  }

  function modelStatus(model: ModelDescriptor) {
    if (!model.enabled) return "Not configured";
    const health = healthForModel(model);
    if (!health) return "Configured";
    return health.ok ? "Healthy" : "Needs attention";
  }

  function capabilityLabel(capability: ModelCapability) {
    switch (capability) {
      case "image-generation":
        return "image generation";
      case "long-context":
        return "long context";
      case "local-only":
        return "local only";
      case "requires-network":
        return "requires network";
      default:
        return capability;
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-shell">
        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Operations</p>
              <h2>Backend health</h2>
            </div>
            <button onClick={() => void runHealthCheck()}>Run checks</button>
          </div>
          <p className="settings-status">{healthStatus}</p>
          <div className="health-grid">
            {(healthChecks.length ? healthChecks : [
              { id: "ollama", label: "Ollama", ok: false, message: "Chat and vision model server." },
              { id: "imageGen", label: "Stable Diffusion", ok: false, message: "Local image generation API." },
            ]).map((check) => (
              <article key={check.id} className="health-row">
                <span className={`health-dot ${check.ok ? "health-dot--ok" : ""}`} />
                <div>
                  <h3>{check.label}</h3>
                  <p>{check.message}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Routing</p>
              <h2>Model settings</h2>
            </div>
            <button onClick={() => void handleSave()}>Save settings</button>
          </div>
          <div className="settings-form-grid">
            <label>
              Ollama base URL
              <input value={draft.ollamaBaseUrl} onChange={(e) => update("ollamaBaseUrl", e.target.value)} placeholder="http://localhost:11434" />
            </label>
            <label>
              Chat model
              <input value={draft.chatModel} onChange={(e) => update("chatModel", e.target.value)} placeholder="llama3.1" />
            </label>
            <label>
              Vision model
              <input value={draft.visionModel} onChange={(e) => update("visionModel", e.target.value)} placeholder="llava" />
            </label>
            <label>
              Image generation base URL
              <input
                value={draft.imageGenBaseUrl}
                onChange={(e) => update("imageGenBaseUrl", e.target.value)}
                placeholder="http://127.0.0.1:7860"
              />
            </label>
          </div>
          <div className="settings-toggle-row">
            <label>
              <input type="checkbox" checked readOnly />
              Local Ollama first
            </label>
            <label>
              <input type="checkbox" checked readOnly />
              No cloud fallback
            </label>
            <label>
              <input type="checkbox" checked readOnly />
              Manual output saves
            </label>
          </div>
          {status && <p className="settings-status">{status}</p>}
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Capabilities</p>
              <h2>Model routes</h2>
            </div>
          </div>
          <div className="model-route-grid">
            {modelRegistry.models.map((model) => {
              const health = healthForModel(model);
              return (
                <article key={model.id} className="model-route-card">
                  <div className="model-route-card__header">
                    <div>
                      <h3>{model.label}</h3>
                      <p>{model.provider} - {model.privacyLevel} - {model.requiresNetwork ? "network required" : "local endpoint"}</p>
                    </div>
                    <span className={model.enabled && health?.ok ? "model-route-status model-route-status--ok" : "model-route-status"}>
                      {modelStatus(model)}
                    </span>
                  </div>
                  <div className="model-capability-list">
                    {model.capabilities.map((capability) => (
                      <span key={capability}>{capabilityLabel(capability)}</span>
                    ))}
                  </div>
                  {health && <p className="model-route-health">{health.message}</p>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Memory</p>
              <h2>Controls</h2>
            </div>
          </div>
          <dl className="settings-metric-list">
            <div>
              <dt>Store</dt>
              <dd>Local JSON</dd>
            </div>
            <div>
              <dt>Recall</dt>
              <dd>Explicit retrieval only</dd>
            </div>
            <div>
              <dt>Embeddings</dt>
              <dd>Optional provider hook</dd>
            </div>
          </dl>
          <div className="settings-toggle-row settings-toggle-row--stacked">
            <label>
              <input type="checkbox" checked readOnly />
              Review and edit memories
            </label>
            <label>
              <input type="checkbox" checked readOnly />
              Keep source labels visible
            </label>
            <label>
              <input type="checkbox" checked readOnly />
              Delete stays manual
            </label>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Workspace</p>
              <h2>Output folder</h2>
            </div>
            <button onClick={() => void refreshOutputFolder()}>Refresh</button>
          </div>
          <label>
            Saved images/documents
            <input value={draft.outputDir} onChange={(e) => update("outputDir", e.target.value)} />
          </label>
          <p className="settings-status">{outputStatus}</p>
          <div className="asset-summary">
            <span>{generatedCounts.images} images</span>
            <span>{generatedCounts.documents} documents</span>
            <span>{generatedCounts.folders} folders</span>
            <span>{generatedCounts.other} other</span>
          </div>
          <div className="asset-list">
            {outputEntries.length === 0 ? (
              <p>No generated assets loaded.</p>
            ) : (
              outputEntries.slice(0, 8).map((entry) => (
                <article key={entry.path}>
                  <strong>{entry.name}</strong>
                  <span>{entry.isDir ? "Folder" : `${formatBytes(entry.sizeBytes)} ${formatDate(entry.modifiedMs)}`}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-kicker">Tools</p>
              <h2>Approvals</h2>
            </div>
            <button onClick={() => void refreshAudit()}>Audit log</button>
          </div>
          <div className="approval-grid">
            {tools.map((tool) => (
              <article key={tool.id}>
                <div>
                  <h3>{tool.title}</h3>
                  <p>{tool.description}</p>
                </div>
                <span>{approvalCopy(tool.permissionLevel)}</span>
              </article>
            ))}
          </div>
          <div className="audit-list">
            {auditRecords.length === 0 ? (
              <p>No tool runs recorded in this session.</p>
            ) : (
              auditRecords.slice(0, 5).map((record) => (
                <article key={record.id}>
                  <strong>{record.toolTitle}</strong>
                  <span>
                    {record.status} - {record.permissionLevel} - {new Date(record.requestedAt).toLocaleTimeString()}
                  </span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="settings-panel settings-panel--wide settings-help">
          <h3>Setup checklist</h3>
          <ul>
            <li>
              Install <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a>, then run <code>ollama pull llama3.1</code> and{" "}
              <code>ollama pull llava</code>.
            </li>
            <li>
              Launch a Stable Diffusion WebUI-compatible server with <code>--api</code> for <code>/sdapi/v1/txt2img</code>.
            </li>
            <li>Jarvis keeps these defaults local-first: no login, no tracking, and no cloud fallback from this settings screen.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
