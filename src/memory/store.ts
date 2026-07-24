import { invoke } from "@tauri-apps/api/core";
import { defaultMemoryEmbeddingProvider, type MemoryEmbeddingProvider } from "./embeddingProvider";
import type {
  CreateMemoryRecordInput,
  MemoryRecord,
  MemoryRepository,
  MemoryRetrievalQuery,
  MemoryRetrievalResult,
  MemoryStoreFile,
  UpdateMemoryRecordInput,
} from "./types";

const STORE_VERSION = 1;
const DEFAULT_LIMIT = 6;
const TOKEN_MIN_LENGTH = 2;

async function memoryPath(): Promise<string> {
  const dir = await invoke<string>("app_data_dir");
  return `${dir}/memory.json`;
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_'-]+/g)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length >= TOKEN_MIN_LENGTH);
}

function recordSearchText(record: MemoryRecord): string {
  return [record.type, record.title, record.content, record.tags.join(" "), record.source.label, record.source.kind].join(" ");
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
    records: parsed.records.filter((record): record is MemoryRecord => {
      return (
        !!record &&
        typeof record.id === "string" &&
        typeof record.title === "string" &&
        typeof record.content === "string" &&
        Array.isArray(record.tags) &&
        !!record.source &&
        typeof record.createdAt === "string" &&
        typeof record.updatedAt === "string"
      );
    }),
  };
}

export class JsonMemoryRepository implements MemoryRepository {
  constructor(private readonly embeddingProvider: MemoryEmbeddingProvider = defaultMemoryEmbeddingProvider) {}

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

  private async loadStore(): Promise<MemoryStoreFile> {
    const path = await memoryPath();
    const raw = await invoke<string | null>("read_text_file", { path });
    if (!raw) return { version: STORE_VERSION, records: [] };
    try {
      return validateStore(JSON.parse(raw));
    } catch {
      return { version: STORE_VERSION, records: [] };
    }
  }

  private async saveStore(store: MemoryStoreFile): Promise<void> {
    const path = await memoryPath();
    await invoke("write_text_file", { path, contents: JSON.stringify(store, null, 2) });
  }
}

export const memoryRepository = new JsonMemoryRepository();
