# Jarvis Local Memory System

Jarvis memory is local-only in this first pass. Records are stored as JSON in the
Tauri app data directory at `memory.json`, using the same `app_data_dir`,
`read_text_file`, and `write_text_file` commands as settings persistence. No memory
data is sent to a cloud API.

## Record Model

Each memory record has:

- `id`: stable UUID.
- `type`: one of `user-preference`, `project-summary`, `conversation-summary`,
  or `saved-fact`.
- `title`: short editable label.
- `content`: editable body text.
- `tags`: normalized lowercase tags.
- `source`: structured source metadata with `kind`, `label`, and optional
  `conversationId`/`messageId`.
- `confidence`: numeric trust signal from 0 to 1.
- `project`: optional linkage with project `id`, display `name`, and optional
  local `path`.
- `createdAt`: ISO timestamp.
- `updatedAt`: ISO timestamp.
- `lastAccessedAt`: ISO timestamp set after retrieval matches.
- `embedding`: optional vector slot reserved for a future embeddings pass.

The on-disk file is versioned:

```json
{
  "version": 1,
  "records": []
}
```

## API Boundary

The typed boundary lives in `src/memory`:

- `types.ts` defines `MemoryRecord`, CRUD inputs, retrieval query/result shapes,
  and the `MemoryRepository` interface.
- `store.ts` implements `JsonMemoryRepository`, backed by local app-data JSON.
- `embeddingProvider.ts` defines the embedding provider contract and a clean stub.
- `MemoryPage.tsx` provides editable/deletable records in the app UI.
- `exportJson()` and `importJson()` move versioned memory JSON in and out of the
  local store. Exports omit embeddings unless explicitly requested.

Use `memoryRepository` for the current app default:

```ts
const record = await memoryRepository.create({
  type: "user-preference",
  title: "Response style",
  content: "Prefer concise implementation notes after builds.",
  tags: ["style"],
  source: { kind: "manual", label: "Memory page" },
  confidence: 0.9,
  project: { id: "jarvis", name: "Jarvis Assistant" },
});

const matches = await memoryRepository.retrieve({
  query: "how should you summarize builds",
  projectId: "jarvis",
  limit: 5,
});
```

## Retrieval

Embeddings are intentionally stubbed for this pass. Current retrieval is
keyword/recency based:

- Query text is tokenized into lowercase terms.
- Records are searched across type, title, content, tags, and source label.
- Project id/name/path are searchable only after the project boundary allows the
  record into the candidate set.
- Title and tag matches receive extra weight.
- Recently updated records receive a small recency boost.
- Confidence adds a small trust boost after keyword matching.
- Matching records are sorted by score and capped by `limit`.
- Unscoped retrieval returns global memories only. Scoped retrieval returns
  global memories plus memories linked to the requested project id. Linked
  memories from other projects are excluded.

Chat uses this boundary before normal text completion. Matching records are added
as a system context message so local memory can help the model answer without
changing provider internals.

## Editing And Deletion

The Memory tab supports:

- Creating records manually.
- Editing type, title, content, tags, and source label.
- Editing source kind and source label.
- Editing confidence and optional project linkage.
- Deleting records from `memory.json`.
- Searching through the same retrieval API used by chat.
- Importing/exporting versioned memory JSON.
- Inspecting created and updated timestamps for each record.

Deletion is a hard local delete in v1. If audit history becomes important later,
add a tombstone field in a v2 schema instead of changing the meaning of v1.

## Future Embeddings Pass

`MemoryEmbeddingProvider` is already defined, but the default implementation is
`StubMemoryEmbeddingProvider` with `available = false`. A future provider should:

- Generate vectors locally, preferably through Ollama embeddings.
- Populate `record.embedding` on create/update.
- Add vector similarity to `retrieve()` while preserving keyword fallback.
- Keep remote embedding providers disabled unless the user explicitly configures
  them.
