export type MemoryRecordType = "user-preference" | "project-summary" | "conversation-summary" | "saved-fact";

export interface MemorySource {
  kind: "manual" | "chat" | "project" | "import" | "system";
  label: string;
  conversationId?: string;
  messageId?: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryRecordType;
  title: string;
  content: string;
  tags: string[];
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  embedding?: number[];
}

export interface MemoryStoreFile {
  version: 1;
  records: MemoryRecord[];
}

export interface CreateMemoryRecordInput {
  type: MemoryRecordType;
  title: string;
  content: string;
  tags?: string[];
  source: MemorySource;
}

export interface UpdateMemoryRecordInput {
  type?: MemoryRecordType;
  title?: string;
  content?: string;
  tags?: string[];
  source?: MemorySource;
}

export interface MemoryRetrievalQuery {
  query: string;
  types?: MemoryRecordType[];
  limit?: number;
  includeEmbeddings?: boolean;
}

export interface MemoryRetrievalResult {
  record: MemoryRecord;
  score: number;
  reasons: string[];
}

export interface MemoryRepository {
  list(): Promise<MemoryRecord[]>;
  create(input: CreateMemoryRecordInput): Promise<MemoryRecord>;
  update(id: string, input: UpdateMemoryRecordInput): Promise<MemoryRecord>;
  delete(id: string): Promise<void>;
  retrieve(query: MemoryRetrievalQuery): Promise<MemoryRetrievalResult[]>;
}
