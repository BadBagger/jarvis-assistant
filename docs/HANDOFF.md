# Jarvis Assistant Handoff

Date: 2026-07-24

## Project State

Jarvis Assistant is a local-first Tauri 2 + React 19 desktop app. It provides a
workspace shell, chat through local Ollama, image scanning through local Ollama
vision, `/imagine` image generation through a local AUTOMATIC1111-compatible
API, local memory records, local task plans, manual artifact exports, settings
health checks, and deterministic evals.

Do not describe it as generally intelligent or autonomous. The app only does
the implemented flows above, and it does not give a model unrestricted shell,
filesystem, network, delete, overwrite, send, or background-control access.

## Repository Setup

From the repo root:

```powershell
npm.cmd install
```

Useful commands:

```powershell
npm.cmd run dev
npm.cmd run tauri dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run eval
npm.cmd run build
cd src-tauri
cargo check
cargo test
cd ..
npm.cmd run tauri build
```

The app stores settings, memory records, plans, artifact metadata, and other
app JSON files under the Tauri app data directory. Generated documents and
images save to the configured output directory.

## Ollama Setup

Install Ollama, then pull the default chat and vision models:

```powershell
ollama pull llama3.1
ollama pull llava
```

Start Ollama if needed:

```powershell
ollama serve
```

Default Jarvis settings:

- Ollama base URL: `http://localhost:11434`
- Chat model: `llama3.1`
- Vision model: `llava`

Settings health checks call `GET /api/tags`. A healthy Ollama process is not
enough by itself; the configured model names should also appear in the returned
tag list.

## AUTOMATIC1111 API Setup

Install AUTOMATIC1111 Stable Diffusion WebUI and launch it with API mode:

```powershell
.\webui-user.bat --api
```

For repeated use, add `--api` to `COMMANDLINE_ARGS` in `webui-user.bat`.

Default Jarvis image-generation base URL:

```text
http://127.0.0.1:7860
```

Jarvis checks `GET /sdapi/v1/options` and sends `/imagine` requests to
`POST /sdapi/v1/txt2img` with a simple 512x512, 20-step default payload.

## Current Capabilities

- Combined Workspace view with embedded chat, model route status, output folder
  counts, current plan summary, local memory count, and tool/audit preview.
- Chat with a configured local Ollama model via streamed `/api/chat`.
- Image scanning by attaching an image and sending its base64 data to the
  configured Ollama vision model.
- `/imagine <prompt>` image generation through a local A1111-compatible
  txt2img endpoint.
- Retry queue for failed chat, image-scan, and image-generation requests.
- Save assistant text replies as `.md`, `.txt`, `.json`, or `.docx`.
- Save generated images as `.png`.
- Reveal saved artifacts in the output folder.
- Settings screen for Ollama URL, chat model, vision model, image-generation
  URL, output folder, service health, model routes, output folder preview, tool
  approvals, and in-memory audit preview.
- Local JSON memory records with create, edit, delete, import, export, search,
  type filters, confidence, tags, source labels, and project scope.
- Chat memory retrieval that injects matching local memories only when a query
  matches them.
- Local JSON planning workspace with plan status, steps, notes, artifact
  references, result summaries, and explicit permission boundary text.
- Model provider/routing layer for chat, vision, image generation, embeddings
  contracts, and future provider descriptors.
- Tool registry for current local UI tools, risk labels, and in-memory audit
  records.
- Offline eval harness for local-first/privacy behavior, hallucination
  boundaries, memory retrieval, tool permissions, model routing, vision prompt
  handling, image request shaping, chat quality, and coding-help behavior.
- Fine-tuning preparation path under `finetune/`, including schema, data prep,
  training config, QLoRA script, and merge/export script. No training job was
  started in this pass.

## Backend Constraints

- Local service URLs are validated in TypeScript and Rust.
- Allowed service hosts are `localhost`, `127.*`, and `[::1]` over `http://` or
  `https://`.
- `http_get`, `http_post`, and `ollama_chat` reject remote hosts before making
  requests.
- The app does not bind a listening port.
- Generic Rust file commands still exist for app persistence and exports. They
  should not be exposed as model-callable tools without narrower path
  validation, explicit approval, and audit/undo behavior.
- Chat streaming uses Ollama newline-delimited JSON from `/api/chat` and emits
  `jarvis:chat-chunk` events by request ID.
- Image generation currently supports A1111-compatible APIs only.
- Tool audit records are currently in-memory only.

## Verification Results

All verification below was run on 2026-07-24 from:

```text
C:\Users\KyleB\Documents\Codex\2026-07-22\here-s-the-plain-list-just\jarvis-assistant
```

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run typecheck` | Pass | `tsc --noEmit` completed cleanly. |
| `npm.cmd test` | Pass | Vitest: 8 test files, 27 tests passed. |
| `npm.cmd run eval` | Pass | 8 suites, 32 cases, 0 deterministic failures. |
| `npm.cmd run build` | Pass | Vite production build completed. Warning: JS chunk is 609.84 kB after minification, above the 500 kB advisory threshold. |
| `cargo check` in `src-tauri` | Pass | Rust dev profile check completed cleanly. |
| `cargo test` in `src-tauri` | Pass | 5 Rust unit tests passed. |
| `npm.cmd run tauri build` | Pass | Built release executable plus MSI and NSIS installers. |

Build artifacts:

- `src-tauri/target/release/jarvis-assistant.exe`
- `src-tauri/target/release/bundle/msi/Jarvis Assistant_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Jarvis Assistant_0.1.0_x64-setup.exe`

Not verified in this pass:

- Live Ollama chat with `llama3.1`.
- Live Ollama vision/image scanning with `llava`.
- Live A1111 image generation through `/sdapi/v1/txt2img`.
- Installed MSI/NSIS smoke test.
- Fine-tuning dependencies or GPU training.

## Changes Made In Final Pass

- Updated `README.md` with current setup, implemented capabilities, local
  backend setup, limitations, verification results, and roadmap.
- Updated this handoff with current verification counts, setup steps, current
  capabilities, known limitations, and next priorities.

No source-code fixes were required after the verification pass.

## Known Limitations

- Chat history is in-memory only and clears on restart.
- Memory, plans, and artifact metadata are JSON-backed first passes rather than
  SQLite-backed durable stores with migrations and robust concurrent-write
  handling.
- Memory retrieval is keyword/recency based; embeddings are only a provider
  hook at this stage.
- Plans record user-visible task structure and local results; they do not
  execute work autonomously.
- Tool audit records are in-memory only and disappear on restart.
- There are not yet mocked tests for Ollama stream parsing, image generation
  response parsing, DOCX output, settings persistence, or file-write failures.
- The production JS bundle triggers Vite's chunk-size warning. This is advisory
  but should be addressed before the app grows much more.
- No live backend acceptance run was done with Ollama/A1111 running.
- No installer smoke test was done after the MSI/NSIS build.

## Next Roadmap

1. Run live local acceptance with Ollama `llama3.1`, Ollama `llava`, and A1111:
   chat, image attach, `/imagine`, DOCX export, PNG export, missing-service
   errors, and invalid-output-folder errors.
2. Persist chat threads and messages, including attachments metadata and saved
   artifact links; restore the latest thread on launch.
3. Move settings, threads, artifacts, memories, plans, indexed sources,
   retrieval chunks, and audit events into SQLite with migrations.
4. Add mocked tests for Ollama stream parsing, image generation response
   parsing, DOCX generation, settings persistence, memory import/export, plan
   persistence, and file-write failures.
5. Add local embeddings through Ollama or another local provider, then build
   source-cited retrieval over explicitly selected folders.
6. Replace any future model-facing broad file/HTTP actions with narrow typed
   Rust commands, approval gates, persistent audit records, and undo/versioning
   where practical.
7. Add image-generation controls for dimensions, steps, seed, model/checkpoint
   metadata, and generation history.
8. Add installer smoke checks: install MSI or NSIS, launch app, confirm app data
   path, run health checks, export a small document, then uninstall cleanly.
9. Keep fine-tuning external until there is a reviewed dataset, stable eval
   baseline, GPU check, run monitoring, and model comparison report.
