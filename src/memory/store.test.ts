import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonMemoryRepository, type MemoryStorage } from "./store";

class InMemoryStorage implements MemoryStorage {
  contents: string | null = null;

  async read(): Promise<string | null> {
    return this.contents;
  }

  async write(contents: string): Promise<void> {
    this.contents = contents;
  }
}

function createRepository(storage = new InMemoryStorage()) {
  return { repository: new JsonMemoryRepository(undefined, storage), storage };
}

describe("JsonMemoryRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates, updates, deletes, and lists editable memory records", async () => {
    const { repository } = createRepository();

    const created = await repository.create({
      type: "user-preference",
      title: " Output folder ",
      content: " Save generated artifacts locally. ",
      tags: ["Jarvis", "local", "jarvis"],
      source: { kind: "manual", label: "Memory page" },
      confidence: 1.4,
      project: { id: "jarvis", name: "Jarvis Assistant" },
    });

    expect(created).toMatchObject({
      type: "user-preference",
      title: "Output folder",
      content: "Save generated artifacts locally.",
      tags: ["jarvis", "local"],
      confidence: 1,
      project: { id: "jarvis", name: "Jarvis Assistant" },
    });

    const updated = await repository.update(created.id, {
      content: "Save documents and images to the configured local output folder.",
      confidence: 0.55,
      project: null,
    });

    expect(updated.content).toContain("configured local output folder");
    expect(updated.confidence).toBe(0.55);
    expect(updated.project).toBeUndefined();

    await repository.delete(created.id);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("retrieves by keyword, recency, type, and project boundary", async () => {
    const { repository } = createRepository();

    const global = await repository.create({
      type: "saved-fact",
      title: "Jarvis output folder",
      content: "Generated files stay in the local output folder.",
      tags: ["output"],
      source: { kind: "manual", label: "settings" },
      confidence: 0.9,
    });
    const scoped = await repository.create({
      type: "project-summary",
      title: "Jarvis release notes",
      content: "The release checklist includes evals and cargo test.",
      tags: ["release"],
      source: { kind: "project", label: "handoff" },
      project: { id: "jarvis", name: "Jarvis Assistant" },
      confidence: 0.85,
    });
    await repository.create({
      type: "project-summary",
      title: "Other project release notes",
      content: "Private launch notes for another workspace.",
      tags: ["release"],
      source: { kind: "project", label: "handoff" },
      project: { id: "other", name: "Other Project" },
      confidence: 0.85,
    });

    const unscoped = await repository.retrieve({ query: "release notes output folder", limit: 5 });
    expect(unscoped.map((result) => result.record.id)).toEqual([global.id]);

    const scopedResults = await repository.retrieve({
      query: "release notes output folder",
      types: ["project-summary", "saved-fact"],
      projectId: "jarvis",
      limit: 5,
    });

    expect(scopedResults.map((result) => result.record.id)).toEqual(expect.arrayContaining([global.id, scoped.id]));
    expect(scopedResults.map((result) => result.record.project?.id)).not.toContain("other");
    expect((await repository.list()).filter((record) => record.lastAccessedAt).length).toBeGreaterThan(0);
  });

  it("imports and exports memory JSON without embeddings by default", async () => {
    const { repository, storage } = createRepository();
    storage.contents = JSON.stringify({
      version: 1,
      records: [
        {
          id: "legacy-pref",
          type: "preference",
          title: "Response style",
          content: "Keep implementation notes concise.",
          tags: ["Style"],
          source: { kind: "manual", label: "old export" },
          createdAt: "2026-07-20T12:00:00.000Z",
          updatedAt: "2026-07-20T12:00:00.000Z",
          embedding: [0.1, 0.2],
        },
      ],
    });

    expect((await repository.list())[0]).toMatchObject({
      id: "legacy-pref",
      type: "user-preference",
      confidence: 0.75,
      tags: ["style"],
    });

    const exported = JSON.parse(await repository.exportJson());
    expect(exported.records[0].embedding).toBeUndefined();

    const imported = await repository.importJson(
      JSON.stringify({
        version: 1,
        records: [
          {
            id: "imported",
            type: "constraint",
            title: "External calls",
            content: "Do not send memory records to remote services.",
            tags: ["privacy"],
            source: { kind: "system", label: "policy" },
            createdAt: "2026-07-23T12:00:00.000Z",
            updatedAt: "2026-07-23T12:00:00.000Z",
          },
        ],
      }),
    );

    expect(imported[0]).toMatchObject({
      id: "imported",
      type: "saved-fact",
      source: { kind: "import", label: "policy" },
    });
  });
});
