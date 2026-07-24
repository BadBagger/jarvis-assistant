import { invoke } from "@tauri-apps/api/core";
import { defaultMemoryEmbeddingProvider, type MemoryEmbeddingProvider } from "./embeddingProvider";
import type {
  CreateMemoryRecordInput,
  MemoryProjectLink,
  MemoryRecord,
  MemoryRecordType,
  MemoryRepository,
  MemoryRetrievalQuery,
  MemoryRetrievalResult,
  MemorySource,
  MemoryStoreFile,
  UpdateMemoryRecordInput,
} from "./types";

const STORE_VERSION = 1;
const DEFAULT_LIMIT = 6;
const TOKEN_MIN_LENGTH = 2;
const MEMORY_TYPES = new Set<MemoryRecordType>(["user-preference", "project-summary", "conversation-summary", "saved-fact"]);

export interface MemoryStorage {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

async function memoryPath(): Promise<string> {
  const dir = await invoke<string>("app_data_dir");
  return `${dir}/memory.json`;
}

class TauriMemoryStorage implements MemoryStorage {
  async read(): Promise<string | null> {
    const path = await memoryPath();
    return invoke<string | null>("read_text_file", { path });
  }

  async write(contents: string): Promise<void> {
    const path = await memoryPath();
    await invoke("write_text_file", { path, contents });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

function normalizeConfidence(confidence: number | undefined): number {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return 0.75;
  return Math.min(1, Math.max(0, confidence));
}

function normalizeType(type: unknown): MemoryRecordType {
  if (typeof type === "string" && MEMORY_TYPES.has(type as MemoryRecordType)) return type as MemoryRecordType;
  if (type === "preference") return "user-preference";
  if (type === "constraint" || type === "note" || type === "fact") return "saved-fact";
  if (type === "project") return "project-summary";
  if (type === "conversation") return "conversation-summary";
  return "saved-fact";
}

function normalizeSource(source: unknown): MemorySource {
  if (!source || typeof source !== "object") return { kind: "import", label: "Imported memory" };
  const candidate = source as Partial<MemorySource>;
  const sourceKinds = new Set<MemorySource["kind"]>(["manual", "chat", "project", "import", "system"]);
  return {
    kind: sourceKinds.has(candidate.kind as MemorySource["kind"]) ? (candidate.kind as MemorySource["kind"]) : "import",
    label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : "Imported memory",
    conversationId: typeof candidate.conversationId === "string" ? candidate.conversationId : undefined,
    messageId: typeof candidate.messageId === "string" ? candidate.messageId : undefined,
  };
}

function normalizeProject(project: unknown): MemoryProjectLink | undefined {
  if (!project || typeof project !== "object") return undefined;
  const candidate = project as Partial<MemoryProjectLink>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return undefined;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return undefined;
  return {
    id: candidate.id.trim(),
    name: candidate.name.trim(),
    path: typeof candidate.path === "string" && candidate.path.trim() ? candidate.path.trim() : undefined,
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_'-]+/g)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length >= TOKEN_MIN_LENGTH);
}

function recordSearchText(record: MemoryRecord): string {
  return [
    record.type,
    record.title,
    record.content,
    record.tags.join(" "),
    record.source.label,
    record.source.kind,
    record.project?.id ?? "",
    record.project?.name ?? "",
    record.project?.path ?? "",
  ].join(" ");
}

function scoreRecord(record: MemoryRecord, queryTokens: string[], nowMs: number): MemoryRetrievalResult | null {
  const searchable = recordSearchText(record).toLowerCase();
  const title = record.title.toLowerCase();
  const tags = record.tags.join(" ").toLowerCase();
  let score = 0;
  const reasons = new Set<string>();

  for (const token of queryTokens) {
    if (!searchable.includes(token)) continue;
    score += 1;
    reasons.add(`matched "${token}"`);
    if (title.includes(token)) score += 2;
    if (tags.includes(token)) score += 1.5;
  }

  const ageDays = Math.max(0, (nowMs - Date.parse(record.updatedAt)) / 86_400_000);
  const recencyScore = 1 / (1 + ageDays / 14);
  score += recencyScore;
  if (recencyScore > 0.75) reasons.add("recent");

  if (score <= 0) return null;
  score += record.confidence;
  if (record.confidence >= 0.85) reasons.add("high confidence");
  return { record, score, reasons: Array.from(reasons) };
}

function validateStore(raw: unknown): MemoryStoreFile {
  if (!raw || typeof raw !== "object") return { version: STORE_VERSION, records: [] };
  const parsed = raw as Partial<MemoryStoreFile>;
  if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.records)) {
    return { version: STORE_VERSION, records: [] };
  }
  return {
    version: STORE_VERSION,
    records: parsed.records.map(normalizeImportedRecord).filter((record): record is MemoryRecord => record !== null),
  };
}

function normalizeImportedRecord(raw: unknown): MemoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<MemoryRecord>;
  if (typeof record.title !== "string" || typeof record.content !== "string") return null;
  const timestamp = nowIso();
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : timestamp;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : crypto.randomUUID(),
    type: normalizeType(record.type),
    title: record.title.trim(),
    content: record.content.trim(),
    tags: normalizeTags(record.tags),
    source: normalizeSource(record.source),
    confidence: normalizeConfidence(record.confidence),
    project: normalizeProject(record.project),
    createdAt,
    updatedAt,
    lastAccessedAt: typeof record.lastAccessedAt === "string" ? record.lastAccessedAt : undefined,
    embedding: Array.isArray(record.embedding) && record.embedding.every((value) => typeof value === "number") ? record.embedding : undefined,
  };
}

function canRetrieveRecord(record: MemoryRecord, query: MemoryRetrievalQuery): boolean {
  if (!record.project) return true;
  return !!query.projectId && record.project.id === query.projectId;
}

export class JsonMemoryRepository implements MemoryRepository {
  constructor(
    private readonly embeddingProvider: MemoryEmbeddingProvider = defaultMemoryEmbeddingProvider,
    private readonly storage: MemoryStorage = new TauriMemoryStorage(),
  ) {}

  async list(): Promise<MemoryRecord[]> {
    const store = await this.loadStore();
    return [...store.records].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async create(input: CreateMemoryRecordInput): Promise<MemoryRecord> {
    const store = await this.loadStore();
    const timestamp = nowIso();
    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      tags: normalizeTags(input.tags),
      source: input.source,
      confidence: normalizeConfidence(input.confidence),
      project: normalizeProject(input.project),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (this.embeddingProvider.available) {
      const [embedding] = await this.embeddingProvider.embed(`${record.title}\n${record.content}`);
      record.embedding = embedding;
    }

    store.records.push(record);
    await this.saveStore(store);
    return record;
  }

  async update(id: string, input: UpdateMemoryRecordInput): Promise<MemoryRecord> {
    const store = await this.loadStore();
    const index = store.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`Memory record not found: ${id}`);

    const current = store.records[index];
    const updated: MemoryRecord = {
      ...current,
      ...input,
      title: input.title === undefined ? current.title : input.title.trim(),
      content: input.content === undefined ? current.content : input.content.trim(),
      tags: input.tags === undefined ? current.tags : normalizeTags(input.tags),
      source: input.source === undefined ? current.source : input.source,
      confidence: input.confidence === undefined ? current.confidence : normalizeConfidence(input.confidence),
      project: input.project === undefined ? current.project : normalizeProject(input.project),
      updatedAt: nowIso(),
      embedding: undefined,
    };

    if (this.embeddingProvider.available) {
      const [embedding] = await this.embeddingProvider.embed(`${updated.title}\n${updated.content}`);
      updated.embedding = embedding;
    }

    store.records[index] = updated;
    await this.saveStore(store);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const store = await this.loadStore();
    const nextRecords = store.records.filter((record) => record.id !== id);
    if (nextRecords.length === store.records.length) return;
    await this.saveStore({ ...store, records: nextRecords });
  }

  async retrieve(query: MemoryRetrievalQuery): Promise<MemoryRetrievalResult[]> {
    const queryTokens = tokenize(query.query);
    if (queryTokens.length === 0) return [];

    const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
    const typeSet = query.types ? new Set(query.types) : null;
    const nowMs = Date.now();
    const records = await this.list();
    const matches = records
      .filter((record) => !typeSet || typeSet.has(record.type))
      .filter((record) => canRetrieveRecord(record, query))
      .map((record) => scoreRecord(record, queryTokens, nowMs))
      .filter((result): result is MemoryRetrievalResult => result !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (matches.length > 0) {
      const store = await this.loadStore();
      const accessedAt = nowIso();
      const ids = new Set(matches.map((match) => match.record.id));
      await this.saveStore({
        ...store,
        records: store.records.map((record) => (ids.has(record.id) ? { ...record, lastAccessedAt: accessedAt } : record)),
      });
    }

    return matches;
  }

  async exportJson(options: { includeEmbeddings?: boolean } = {}): Promise<string> {
    const store = await this.loadStore();
    const records = options.includeEmbeddings
      ? store.records
      : store.records.map(({ embedding, ...record }) => {
          void embedding;
          return record;
        });
    return JSON.stringify({ version: STORE_VERSION, records }, null, 2);
  }

  async importJson(json: string, options: { replace?: boolean } = {}): Promise<MemoryRecord[]> {
    const parsed = validateStore(JSON.parse(json));
    const incoming = parsed.records.map((record) => ({
      ...record,
      source: record.source.kind === "import" ? record.source : { ...record.source, kind: "import" as const },
    }));
    const current = options.replace ? { version: STORE_VERSION, records: [] } : await this.loadStore();
    const byId = new Map(current.records.map((record) => [record.id, record]));
    for (const record of incoming) {
      byId.set(record.id, record);
    }
    const nextRecords = Array.from(byId.values());
    await this.saveStore({ version: STORE_VERSION, records: nextRecords });
    return incoming;
  }

  private async loadStore(): Promise<MemoryStoreFile> {
    const raw = await this.storage.read();
    if (!raw) return { version: STORE_VERSION, records: [] };
    try {
      return validateStore(JSON.parse(raw));
    } catch {
      return { version: STORE_VERSION, records: [] };
    }
  }

  private async saveStore(store: MemoryStoreFile): Promise<void> {
    await this.storage.write(JSON.stringify(store, null, 2));
  }
}

export const memoryRepository = new JsonMemoryRepository();
