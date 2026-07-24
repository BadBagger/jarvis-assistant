# Jarvis Assistant Handoff

Date: 2026-07-23

## Setup

Jarvis Assistant is a local-first Tauri 2 + React 19 desktop app. Install Node dependencies from the repo root:

```powershell
npm.cmd install
```

Useful development commands:

```powershell
npm.cmd run dev
npm.cmd run tauri dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run eval
npm.cmd run build
npm.cmd run tauri build
```

The app stores settings, plans, and memory JSON under the Tauri app data directory. Generated documents/images save to the configured output directory.

## Running Ollama

Install Ollama, then pull the default chat and vision models:

```powershell
ollama pull llama3.1
ollama pull llava
ollama serve
```

Default Jarvis settings:

- Ollama base URL: `http://localhost:11434`
- Chat model: `llama3.1`
- Vision model: `llava`

Settings health checks call `GET /api/tags` and report missing configured models.

## Running A1111

Install AUTOMATIC1111 Stable Diffusion WebUI and launch it with API mode enabled:

```powershell
.\webui-user.bat --api
```

If using `webui-user.bat`, adding `--api` to `COMMANDLINE_ARGS` is usually cleaner. Default Jarvis image generation URL is:

```text
http://127.0.0.1:7860
```

Jarvis checks `GET /sdapi/v1/options` and sends `/imagine` requests to `POST /sdapi/v1/txt2img` with a 512x512, 20-step default payload.

## Backend Constraints

- Local-only service URLs are enforced in both TypeScript validation and Rust commands.
- Allowed hosts are `localhost`, `127.*`, and `[::1]` over `http://` or `https://`.
- `http_get`, `http_post`, and `ollama_chat` reject remote hosts before making requests.
- The app does not bind a listening port.
- Generic Rust file commands still exist for app persistence and exports; they should not be exposed as model-callable tools without narrower path validation and approval.
- Chat streaming uses Ollama newline-delimited JSON from `/api/chat` and emits `jarvis:chat-chunk` events by request ID.
- Image generation currently supports A1111-compatible APIs only.
- Memory and plans are JSON-backed first passes, not SQLite-backed durable databases.
- Tool audit records are currently in-memory only.

## Current Capabilities

- Chat with a configured local Ollama model.
- Vision/image scanning through a configured Ollama vision model.
- `/imagine <prompt>` image generation through a local A1111-compatible endpoint.
- Save assistant replies as `.docx`.
- Save generated images to disk.
- Settings screen with model/service configuration, backend health checks, output folder preview, tool registry preview, and in-memory audit preview.
- Local memory records with create/edit/delete/search and keyword/recency retrieval injected into chat context.
- Local planning workspace with task steps, notes, artifacts, result summaries, and explicit permission boundary text.
- Model provider/routing layer for chat, vision, image generation, embeddings contracts, and future providers.
- Offline eval harness with deterministic privacy, hallucination, memory, tool-permission, vision-prompt, image-shaping, chat-quality, and coding-help cases.
- Fine-tuning preparation path under `finetune/`, including schema, data prep, training config, QLoRA training script, and merge/export script. No training job was started.

## Verification Results

All verification below was run on 2026-07-24 from `C:\Users\KyleB\Documents\Codex\2026-07-22\here-s-the-plain-list-just\jarvis-assistant`.

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run typecheck` | Pass | `tsc --noEmit` completed cleanly. |
| `npm.cmd test` | Pass | Vitest: 2 test files, 4 tests passed. Added URL validation and retry queue coverage. |
| `npm.cmd run eval` | Pass | 7 suites, 16 cases, 0 deterministic failures, 5 model-scored cases skipped by design. |
| `npm.cmd run build` | Pass | Vite production build completed. Warning: JS chunk is 586.86 kB after minification, above 500 kB advisory threshold. |
| `cargo check` in `src-tauri` | Pass | Rust dev profile check completed cleanly. |
| `cargo test` in `src-tauri` | Pass | 2 Rust unit tests passed for local URL validation; binary/doc tests had 0 tests. |
| `npm.cmd run tauri build` | Pass | Built release executable plus MSI and NSIS installers. |

Build artifacts:

- `src-tauri/target/release/jarvis-assistant.exe`
- `src-tauri/target/release/bundle/msi/Jarvis Assistant_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Jarvis Assistant_0.1.0_x64-setup.exe`

Not verified in this pass:

- Live Ollama chat/vision behavior against running local models.
- Live A1111 image generation.
- Installed MSI/NSIS smoke test.
- Fine-tuning dependencies or GPU training.

## Changes Made In Final Pass

- Enforced localhost-only HTTP URL validation in `src-tauri/src/lib.rs`.
- Added Rust tests for accepted local service URLs and rejected remote/non-HTTP URLs.
- Enforced matching local URL validation in `src/shared/errors.ts`.
- Added Vitest coverage in `src/shared/errors.test.ts`.
- Updated `docs/JARVIS_AI_ROADMAP.md` so the HTTP-boundary risk is no longer stale.
- Added this handoff.

## Remaining Risks

- Tauri file commands can read/write caller-provided paths. Current UI uses them for app data and user-configured exports, but future model-directed tools need narrower Rust commands and path allowlists.
- Chat history is still in-memory and clears on restart.
- Memory retrieval is keyword/recency based; embeddings are stubbed.
- Plans and memory use JSON files; concurrent writes and migrations are basic.
- Tool audit is in-memory only and disappears on restart.
- No mocked tests yet for Ollama stream parsing, image generation response parsing, DOCX output, settings persistence, or file-write failures.
- No manual acceptance run was done with Ollama/A1111 running, so runtime service wiring still needs local smoke testing.
- Production JS bundle triggers a Vite chunk-size warning; this is advisory but should be addressed before the app grows much more.

## Next Priorities

1. Run a live local smoke test with Ollama and A1111: chat, vision attach, `/imagine`, DOCX export, PNG export, missing-service errors.
2. Persist chat threads/messages and restore the latest thread on launch.
3. Replace broad file commands in any future assistant-action path with narrow, typed, path-scoped commands.
4. Add durable SQLite storage for threads, artifacts, memories, indexed sources, retrieval chunks, and audit events.
5. Add mocked tests for streaming chat, image generation parsing, document export, and settings persistence.
6. Add local embeddings through Ollama and source-cited retrieval over selected folders.
7. Add a remote-provider design only after explicit opt-in settings, host allowlists, and audit/consent flows are defined.
8. Keep fine-tuning external until there is a reviewed dataset, stable eval baseline, GPU check, run monitoring, and model comparison report.
