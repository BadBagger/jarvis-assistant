import { useEffect, useMemo, useState } from "react";
import { memoryRepository } from "./store";
import type { MemoryRecord, MemoryRecordType, MemorySource } from "./types";

const MEMORY_TYPES: Array<{ value: MemoryRecordType; label: string }> = [
  { value: "user-preference", label: "User preference" },
  { value: "project-summary", label: "Project summary" },
  { value: "conversation-summary", label: "Conversation summary" },
  { value: "saved-fact", label: "Saved fact" },
];

const SOURCE_KINDS: Array<{ value: MemorySource["kind"]; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "chat", label: "Chat" },
  { value: "project", label: "Project" },
  { value: "import", label: "Import" },
  { value: "system", label: "System" },
];

const EMPTY_FORM = {
  type: "saved-fact" as MemoryRecordType,
  title: "",
  content: "",
  tags: "",
  sourceKind: "manual" as MemorySource["kind"],
  sourceLabel: "Manual entry",
  confidence: "0.75",
  projectId: "",
  projectName: "",
  projectPath: "",
  importJson: "",
  exportJson: "",
};

export function MemoryPage() {
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const selectedRecord = useMemo(() => records.find((record) => record.id === selectedId) ?? null, [records, selectedId]);

  useEffect(() => {
    void refreshRecords();
  }, []);

  async function refreshRecords() {
    setRecords(await memoryRepository.list());
  }

  function editRecord(record: MemoryRecord) {
    setSelectedId(record.id);
    setForm({
      type: record.type,
      title: record.title,
      content: record.content,
      tags: record.tags.join(", "),
      sourceKind: record.source.kind,
      sourceLabel: record.source.label,
      confidence: String(record.confidence),
      projectId: record.project?.id ?? "",
      projectName: record.project?.name ?? "",
      projectPath: record.project?.path ?? "",
      importJson: "",
      exportJson: "",
    });
    setStatus(null);
  }

  function resetForm() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
  }

  async function saveRecord() {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title || !content) {
      setStatus("Title and content are required.");
      return;
    }

    const payload = {
      type: form.type,
      title,
      content,
      tags: form.tags.split(","),
      source: { kind: form.sourceKind, label: form.sourceLabel.trim() || "Manual entry" },
      confidence: Number(form.confidence),
      project:
        form.projectId.trim() && form.projectName.trim()
          ? {
              id: form.projectId.trim(),
              name: form.projectName.trim(),
              path: form.projectPath.trim() || undefined,
            }
          : undefined,
    };

    if (selectedRecord) {
      await memoryRepository.update(selectedRecord.id, payload);
      setStatus("Memory updated.");
    } else {
      await memoryRepository.create(payload);
      setStatus("Memory saved.");
    }
    resetForm();
    await refreshRecords();
  }

  async function deleteRecord(record: MemoryRecord) {
    await memoryRepository.delete(record.id);
    if (selectedId === record.id) resetForm();
    setStatus("Memory deleted.");
    await refreshRecords();
  }

  async function runRetrieval() {
    const results = await memoryRepository.retrieve({ query, limit: 8 });
    setRecords(results.map((result) => result.record));
    setStatus(results.length ? `Retrieved ${results.length} matching memories.` : "No matching memories found.");
  }

  async function exportMemories() {
    const json = await memoryRepository.exportJson();
    setForm((prev) => ({ ...prev, exportJson: json }));
    setStatus("Memory JSON exported locally. Embeddings are omitted.");
  }

  async function importMemories() {
    if (!form.importJson.trim()) {
      setStatus("Paste memory JSON before importing.");
      return;
    }
    try {
      const imported = await memoryRepository.importJson(form.importJson, { replace: false });
      setStatus(`Imported ${imported.length} memories.`);
      setForm((prev) => ({ ...prev, importJson: "" }));
      await refreshRecords();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Memory import failed.");
    }
  }

  const displayedRecords = records;

  return (
    <div className="memory-page">
      <section className="memory-editor">
        <h2>{selectedRecord ? "Edit memory" : "Add memory"}</h2>
        <label>
          Type
          <select value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as MemoryRecordType }))}>
            {MEMORY_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
        </label>
        <label>
          Content
          <textarea value={form.content} onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))} />
        </label>
        <label>
          Tags
          <input value={form.tags} onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))} placeholder="local, project, preference" />
        </label>
        <label>
          Source type
          <select value={form.sourceKind} onChange={(e) => setForm((prev) => ({ ...prev, sourceKind: e.target.value as MemorySource["kind"] }))}>
            {SOURCE_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source label
          <input value={form.sourceLabel} onChange={(e) => setForm((prev) => ({ ...prev, sourceLabel: e.target.value }))} />
        </label>
        <label>
          Confidence
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={form.confidence}
            onChange={(e) => setForm((prev) => ({ ...prev, confidence: e.target.value }))}
          />
        </label>
        <label>
          Project ID
          <input value={form.projectId} onChange={(e) => setForm((prev) => ({ ...prev, projectId: e.target.value }))} />
        </label>
        <label>
          Project name
          <input value={form.projectName} onChange={(e) => setForm((prev) => ({ ...prev, projectName: e.target.value }))} />
        </label>
        <label>
          Project path
          <input value={form.projectPath} onChange={(e) => setForm((prev) => ({ ...prev, projectPath: e.target.value }))} />
        </label>
        <div className="memory-editor__actions">
          <button onClick={() => void saveRecord()}>{selectedRecord ? "Save changes" : "Save memory"}</button>
          {selectedRecord && <button onClick={resetForm}>Cancel</button>}
        </div>
        <div className="memory-import-export">
          <button onClick={() => void exportMemories()}>Export JSON</button>
          <button onClick={() => void importMemories()}>Import JSON</button>
          <textarea
            value={form.importJson}
            onChange={(e) => setForm((prev) => ({ ...prev, importJson: e.target.value }))}
            placeholder="Paste memory JSON to import"
          />
          {form.exportJson && <textarea readOnly value={form.exportJson} aria-label="Exported memory JSON" />}
        </div>
        {status && <p className="memory-status">{status}</p>}
      </section>

      <section className="memory-list">
        <div className="memory-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Retrieve memories by keyword..." />
          <button onClick={() => void runRetrieval()} disabled={!query.trim()}>
            Search
          </button>
          <button onClick={() => void refreshRecords()}>All</button>
        </div>

        {displayedRecords.length === 0 ? (
          <p className="memory-empty">No local memories saved yet.</p>
        ) : (
          displayedRecords.map((record) => (
            <article key={record.id} className="memory-record">
              <div className="memory-record__header">
                <div>
                  <p className="memory-record__type">{MEMORY_TYPES.find((type) => type.value === record.type)?.label}</p>
                  <h3>{record.title}</h3>
                </div>
                <div className="memory-record__actions">
                  <button onClick={() => editRecord(record)}>Edit</button>
                  <button onClick={() => void deleteRecord(record)}>Delete</button>
                </div>
              </div>
              <p>{record.content}</p>
              <footer>
                <span>
                  {record.source.kind}: {record.source.label}
                </span>
                <span>Confidence {Math.round(record.confidence * 100)}%</span>
                <span>Updated {new Date(record.updatedAt).toLocaleString()}</span>
              </footer>
              {record.project && (
                <p className="memory-record__timestamps">
                  Project {record.project.name} ({record.project.id})
                </p>
              )}
              <p className="memory-record__timestamps">Created {new Date(record.createdAt).toLocaleString()}</p>
              {record.tags.length > 0 && <p className="memory-record__tags">{record.tags.join(", ")}</p>}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
