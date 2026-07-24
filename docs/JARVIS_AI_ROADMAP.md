# Jarvis Assistant AI Roadmap

## Executive summary

Jarvis Assistant is currently a local-first Tauri desktop app that connects a React UI to local model services through a Rust command layer. The working product surface is useful but narrow: chat with an Ollama model, image scanning through an Ollama vision model, image generation through an AUTOMATIC1111-compatible Stable Diffusion endpoint, settings persisted in app data, and one-click export of assistant replies to `.docx` or generated images to disk.

The practical product direction is not "fully autonomous AI." The credible direction for this repo is a governed local assistant: durable conversations, user-controlled memory, local retrieval over selected files, transparent tool execution, and measurable quality checks. Local models should provide default private inference. Optional cloud or remote providers can be added later only behind explicit settings, but the product should remain useful with Ollama and localhost services alone.

## Current app inventory

### Frontend

- `src/App.tsx` provides a two-view shell: Chat and Settings.
- `src/chat/ChatPage.tsx` owns the in-memory conversation state, message rendering, image attachment, `/imagine` command routing, Ollama streaming, document export, and generated-image export.
- `src/settings/SettingsPage.tsx` edits the local service settings: Ollama base URL, chat model, vision model, image generation base URL, and output directory.
- `src/shared/types.ts` defines versioned settings and the current message shape.
- `src/shared/persistence.ts` stores settings as JSON under the app data directory by calling Rust file commands.
- `src/ollama/client.ts` wraps the `ollama_chat` Tauri command and listens for streamed `jarvis:chat-chunk` events.
- `src/imagegen/client.ts` calls a local `/sdapi/v1/txt2img` endpoint through Rust-side HTTP.
- `src/documents/generateDocx.ts` creates a basic `.docx` from assistant text using the `docx` npm package.

### Rust/Tauri

- `src-tauri/src/lib.rs` exposes local commands for app data directory resolution, text reads/writes, binary writes, generic HTTP GET/POST, and streamed Ollama chat/vision.
- The Rust layer uses `reqwest` so local model servers can be called without browser CORS issues.
- The app does not currently bind a listening port.
- Tauri capabilities are limited to core/event/opener permissions in `src-tauri/capabilities/default.json`; app-specific commands are exposed through the invoke handler.
- `src-tauri/tauri.conf.json` configures a desktop window, bundle metadata, icons, Vite frontend build, and Tauri package build settings.

### Fine-tuning workflow

- `finetune/README.md` documents a separate LoRA/QLoRA path for customizing an open-weight chat model and then registering the result with Ollama.
- `finetune/prepare_data.py`, `train.py`, and `merge_and_export.py` are intended to prepare data, train an adapter, merge it, and export a model usable by Ollama after GGUF conversion.
- Fine-tuning is not integrated into the desktop app UI and should remain a power-user workflow until data quality, evals, and hardware checks exist.

### Current limitations

- Chat history is lost on restart.
- There is no memory store, retrieval index, source citation pipeline, or semantic search.
- There is no formal tool registry; current "tools" are implicit UI actions and generic Rust HTTP/file commands.
- The generic `http_get`/`http_post` commands are now restricted at the Rust boundary to `localhost`, `127.*`, and `[::1]` HTTP(S) URLs. Future remote-provider work needs an explicit allowlist and user-facing consent model instead of reusing these local-service commands.
- There is no action approval queue, undo model, audit log, eval harness, or regression dataset.
- Image generation supports only A1111-compatible request/response shape.
- Document creation is basic text-to-DOCX export, not a full document editor or template system.

## Target capabilities

### Product capabilities

- Persistent chat threads with titles, timestamps, model metadata, attachments, and exported artifact links.
- Local memory that the user can inspect, edit, pin, delete, and disable.
- Retrieval over user-selected folders and app-created artifacts, with citations to local files and snippets.
- Safe tool execution for narrow, reversible actions such as saving files, opening folders, summarizing selected documents, searching indexed content, and creating draft artifacts.
- A task workspace where multi-step requests are decomposed into a visible plan before any filesystem-changing action runs.
- Local health checks for Ollama, configured models, image generation server, and output directory permissions.
- Better artifact workflows: save as Markdown, DOCX, plain text, and PNG; show saved artifacts in a local library.
- Vision workflows that make image analysis results reusable in memory and documents only after user confirmation.
- Optional advanced connectors later, but only as opt-in providers with clear privacy boundaries.

### Non-goals for the near term

- No claim of general autonomous computer control.
- No unsupervised shell access from model output.
- No hidden internet calls.
- No training a foundation model from scratch.
- No automatic ingestion of the user's filesystem without explicit folder selection.
- No background listening, wake word, or continuous audio capture in this repo until a separate privacy and platform design exists.

## Local-first model strategy

Jarvis should treat local inference as the default product contract.

- Chat and reasoning: keep Ollama as the first provider. Support configurable model names but add model capability checks before routing vision, embedding, or tool-heavy tasks.
- Vision: keep image scanning on a dedicated Ollama vision model. Store only user-approved image summaries or extracted facts, not raw images by default.
- Image generation: keep A1111-compatible generation as an optional local service. Add a server status check and expose common generation parameters before expanding providers.
- Embeddings: add a local embedding model through Ollama or a bundled local embedding runtime. Do not call a remote embedding API by default.
- Routing: introduce a model registry in settings that records provider, base URL, model name, capability tags, context window estimate, and whether the model can use images or embeddings.
- Context management: build deterministic context assembly before model calls. The model should receive the active thread, selected memories, retrieved snippets, and tool contracts as separate, auditable inputs.
- Fallback behavior: when a local service is unavailable, show a clear setup or health error. Do not silently switch to a remote provider.

## Memory/RAG strategy

Memory should be explicit, inspectable, and scoped.

- Store durable app data under the Tauri app data directory using a structured local database, preferably SQLite from Rust.
- Persist chat threads separately from long-term memory. Not every chat message should become memory.
- Add a "Save to memory" action on assistant/user content, plus an optional "suggested memory" review queue.
- Memory records should include text, source type, source path or thread id, created/updated timestamps, tags, confidence/source notes, and deletion status.
- Add an ingestion flow where users pick files or folders. Index only selected paths and show what is indexed.
- Generate embeddings locally and store vectors alongside document chunks. If a vector extension is not used initially, keep an abstraction that can move from simple FTS to vector search.
- Retrieval should return source-grounded snippets with file paths, chunk ids, and timestamps. The answer UI should show citations for retrieved context.
- Add redaction controls before indexing sensitive files. At minimum, support exclude patterns, max file size, allowed extensions, and a dry-run index preview.
- Keep raw transcripts and source documents intact. Memory is an overlay, not a replacement for source material.

## Tool-use safety model

The app needs a tool boundary before any assistant can act beyond chat.

- Define tools in Rust as narrow commands with typed arguments, validation, and explicit permissions.
- Remove or restrict generic HTTP commands before exposing model-driven tool use. If generic HTTP remains, enforce localhost by default and require user-approved hosts for anything else.
- Add a tool registry with name, description, argument schema, risk level, reversible flag, required confirmation, and audit fields.
- Let the model propose tool calls, but execute only after deterministic validation and, for write actions, user approval.
- Use three risk classes:
  - Read-only: inspect selected local data, list configured app artifacts, retrieve indexed snippets.
  - Local reversible: write drafts, save exports, create app-owned files, update app settings after confirmation.
  - High risk: delete, overwrite, run processes, call non-local network services, or modify files outside app-owned/output directories. These should be blocked until a specific implementation and approval design exists.
- Every tool execution should produce an audit record: time, model, prompt/thread id, tool name, arguments, approval status, result, and changed paths.
- Tool results should be summarized back into the chat with exact changed paths and errors.
- Add undo where practical for app-owned writes by saving previous versions or writing new files instead of overwriting.

## Fine-tuning strategy

Fine-tuning should improve style and domain behavior, not replace retrieval or safety controls.

- Keep the existing `finetune/` workflow as an external training pipeline.
- Use fine-tuning only after the product has a durable dataset of high-quality examples and an eval harness.
- Start with small LoRA/QLoRA experiments on an instruct model that can run locally through Ollama after export.
- Train on cleaned conversations, task formats, refusal/approval behavior, and preferred writing style. Do not train private facts that should live in memory/RAG.
- Maintain dataset provenance: source thread, user approval, redaction status, and version.
- Evaluate tuned models against the same task set as base models before recommending them in the app.
- Expose tuned models in Settings as normal Ollama model names; do not add fine-tuning controls to the main app until hardware checks, job monitoring, and failure recovery are built.

## Eval strategy

Jarvis needs repeatable checks for correctness, privacy, and tool safety.

- Unit tests: settings persistence, URL validation, document generation, image generation response parsing, retrieval chunking, and tool schema validation.
- Rust tests: localhost URL enforcement, path validation, app-data writes, audit-log writes, and failure messages.
- Golden chat tests: deterministic prompts against mocked Ollama streams for routing, context assembly, citation formatting, and error handling.
- RAG evals: small local fixture corpus with expected retrieved files/snippets and answer citation requirements.
- Tool evals: model proposes safe, unsafe, malformed, and ambiguous tool calls; executor must approve, block, or request confirmation correctly.
- Privacy evals: verify no remote calls occur unless an explicitly enabled provider is selected.
- Manual acceptance checks: Ollama unavailable, missing model, image server unavailable, invalid output directory, large attachment, app restart with persisted thread.
- Track eval results in `docs/evals/` or a simple JSON report before adding a heavier framework.

## Phased roadmap

### Phase 0: Stabilize the current assistant

- Fix encoding artifacts visible in README/UI text.
- Add service health checks for Ollama, configured models, image generation, and output folder writes.
- Add tests around current client and persistence behavior.
- Document current local-only architecture and known risk boundaries.

### Phase 1: Durable local workspace

- Add SQLite-backed storage for threads, messages, attachments metadata, settings migrations, artifacts, and audit events.
- Add thread list/search and restore the last active thread on launch.
- Add artifact library entries for saved DOCX and PNG outputs.
- Keep all data under app data/output directories unless the user selects additional folders.

### Phase 2: Memory and retrieval

- Add user-approved memory records with edit/delete controls.
- Add local file ingestion for selected folders and explicit file-type allowlists.
- Add local embeddings and/or FTS search behind a retrieval service.
- Build cited answer generation with visible source snippets.

### Phase 3: Governed tools

- Introduce a typed tool registry and approval queue.
- Replace generic model-facing actions with narrow Rust commands.
- Add audit logs and undo/versioning for app-owned writes.
- Add a task plan UI for multi-step requests.

### Shipped on 2026-07-23: First-pass task planning workspace

- Added a local Plans workspace in the app shell for visible assistant work plans.
- Added typed plan data for plan status, task step status, progress notes, generated artifact references, result summaries, and the explicit permission boundary.
- Persisted plans to `plans.json` under the Tauri app data directory through the existing local file command path.
- The workspace supports creating plans from goals and steps, updating plan and step progress, adding notes, recording generated artifacts by local path, and saving final result summaries.
- Automation remains bounded: the planning workspace records intent and local results only. It does not run shell commands, call external services, send messages, delete files, overwrite files, or modify files outside app-owned/output folders without separate user permission.

### Phase 4: Model routing and quality

- Add model capability registry and local provider health probes.
- Add eval fixtures and CI-friendly mocked model tests.
- Compare base and tuned models against the same eval set.
- Add optional local model recommendations based on hardware and task type, without claiming guaranteed quality.

### Phase 5: Advanced local workflows

- Expand document generation with templates and Markdown export.
- Add image workflow controls for size, steps, seed, and save metadata.
- Add optional connector/provider architecture only after safety, audit, and settings boundaries are mature.

## Prioritized backlog

1. Fix text encoding artifacts in README and UI strings.
2. Done: add URL validation that defaults to localhost-only for model services.
3. Add service health checks in Settings.
4. Persist chat threads and messages locally.
5. Add a thread sidebar with create, rename, delete, and search.
6. Add artifact tracking for saved documents and images.
7. Add SQLite storage and migrations in Rust.
8. Add test coverage for persistence, streaming, and document/image save flows.
9. Add a memory review queue with save/edit/delete controls.
10. Add local retrieval over app-created notes and selected files.
11. Add local embedding support and retrieval citations.
12. Add a typed tool registry with risk levels.
13. Add user approval and audit logging for write tools.
14. Replace broad HTTP/file commands in model-facing paths with narrow allowlisted tools.
15. Add RAG and tool-use eval fixtures.
16. Add model capability registry and routing rules.
17. Add fine-tune dataset export from approved examples only.
18. Add tuned-model comparison reports before recommending a tuned model.
19. Expand export formats to Markdown and plain text.
20. Add image generation controls and generation metadata.

## First 10 implementation tasks

1. Create a `docs/ARCHITECTURE.md` or expand README with the current local service flow: React UI -> Tauri invoke -> Rust command -> localhost Ollama/A1111 -> streamed events/file writes.
2. Clean the visible mojibake in README and `src/chat/ChatPage.tsx` so setup instructions and attachment/cursor UI render correctly.
3. Add `src/shared/urlValidation.ts` with a `validateLocalServiceUrl()` helper that accepts `localhost`, `127.0.0.1`, and `[::1]` by default.
4. Done: enforce the same local URL validation in Rust before `http_get`, `http_post`, and `ollama_chat` execute requests.
5. Add Settings health-check buttons for Ollama chat model, Ollama vision model, image generation endpoint, and output folder write access.
6. Introduce a storage design doc and Rust module plan for SQLite tables: `threads`, `messages`, `artifacts`, `memories`, `indexed_sources`, `retrieval_chunks`, and `tool_audit_events`.
7. Implement thread persistence first: save user/assistant text messages, restore the latest thread on app launch, and preserve existing in-memory UI behavior while storage is added.
8. Add Vitest coverage for `dataUrlToBase64`, image generation response parsing through a mock invoke seam, settings merge/default behavior, and DOCX generation smoke behavior.
9. Add Rust unit tests for local URL validation, app-data path creation, and safe write-path behavior.
10. Add a simple `docs/evals/README.md` with the initial manual acceptance matrix: missing Ollama, missing model, missing A1111 server, invalid output folder, app restart, image attachment, `/imagine`, and document export.
