import type { ToolAuditRecord } from "./types";

export interface ToolAuditSink {
  append(record: ToolAuditRecord): Promise<void>;
  list(): Promise<ToolAuditRecord[]>;
}

export class InMemoryToolAuditSink implements ToolAuditSink {
  private records: ToolAuditRecord[] = [];

  async append(record: ToolAuditRecord): Promise<void> {
    this.records = [record, ...this.records].slice(0, 250);
  }

  async list(): Promise<ToolAuditRecord[]> {
    return [...this.records];
  }
}

export const toolAuditSink = new InMemoryToolAuditSink();
