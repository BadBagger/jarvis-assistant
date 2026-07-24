# Jarvis Assistant

Jarvis Assistant is a local-first Tauri + React desktop assistant for chat,
image scanning, image generation, local memory records, simple task plans, and
manual artifact exports. It orchestrates local services you run on your own
machine; it is not a generally intelligent autonomous agent, and it does not
claim capabilities beyond the UI and command paths implemented in this repo.

No cloud AI API, account, telemetry service, or remote model fallback is wired
into the app. Model and image-generation calls are restricted to local service
URLs such as `localhost`, `127.*`, and `[::1]`.

## Implemented Capabilities

- **Workspace** - a combined conversation and status view with local model
  route status, output-folder summary, active plan summary, memory count, and
  tool/audit preview.
- **Chat** - streams replies from a configured local Ollama model through
  `/api/chat`. The default chat model name is `llama3.1`.
- **Image scanning** - attaches an image to a chat prompt and sends the image
  bytes to a configured Ollama vision model. The default vision model name is
  `llava`.
- **Image generation** - handles `/imagine <description>` by calling a local
  Stable Diffusion WebUI-compatible `/sdapi/v1/txt2img` endpoint. AUTOMATIC1111
  works when launched with API mode enabled.
- **Manual exports** - saves assistant text replies as Markdown, TXT, JSON, or
  DOCX. Saves generated images as PNG. Output paths are validated against the
  configured output folder before writing.
- **Local memory records** - lets the user create, edit, delete, import,
  export, and search local JSON-backed memory records. Chat retrieves matching
  records explicitly and injects them as local context.
- **Task plans** - stores JSON-backed plans with steps, notes, artifact
  references, status, result summaries, and explicit permission-boundary text.
- **Settings and health checks** - configures Ollama, model names, A1111 base
  URL, output folder, local model routes, output-folder preview, and in-memory
  tool audit preview.
- **Offline eval harness** - deterministic checks for local-first behavior,
  hallucination boundaries, memory retrieval, tool permissions, routing, vision
  prompt handling, image request shaping, chat quality, and coding-help style.
- **Fine-tuning prep** - `finetune/` contains a separate LoRA/QLoRA preparation
  path for creating a custom Ollama-served model. The desktop app does not run
  training jobs.

## Local Backend Setup

### Ollama with `llama3.1` and `llava`

1. Install Ollama from <https://ollama.com>.
2. Pull the default chat and vision models:

   ```powershell
   ollama pull llama3.1
   ollama pull llava
   ```

3. Start Ollama if it is not already running:

   ```powershell
   ollama serve
   ```

4. In Jarvis Settings, use:

   ```text
   Ollama base URL: http://localhost:11434
   Chat model: llama3.1
   Vision model: llava
   ```

Settings health checks call `GET /api/tags` and report whether the configured
chat and vision model names are present.

### AUTOMATIC1111 API

1. Install AUTOMATIC1111 Stable Diffusion WebUI from
   <https://github.com/AUTOMATIC1111/stable-diffusion-webui>.
2. Launch it with API mode enabled. Either pass `--api` directly:

   ```powershell
   .\webui-user.bat --api
   ```

   or add `--api` to `COMMANDLINE_ARGS` in `webui-user.bat`.

3. In Jarvis Settings, use the default local image-generation base URL unless
   you changed the WebUI port:

   ```text
   http://127.0.0.1:7860
   ```

Jarvis checks `GET /sdapi/v1/options` and sends `/imagine` requests to
`POST /sdapi/v1/txt2img` with a basic 512x512, 20-step payload.

## App Setup

```powershell
npm.cmd install
npm.cmd run tauri dev
```

Useful development and verification commands:

```powershell
npm.cmd run dev          # Vite dev server only
npm.cmd run tauri dev    # full desktop app with Tauri commands
npm.cmd run typecheck    # tsc --noEmit
npm.cmd test             # Vitest unit tests
npm.cmd run eval         # deterministic eval harness
npm.cmd run build        # frontend production build
cd src-tauri
cargo check
cargo test
cd ..
npm.cmd run tauri build  # release exe plus MSI/NSIS bundles
```

## Project Layout

```text
src/
  workspace/AssistantWorkspace.tsx  combined chat/status workspace
  chat/ChatPage.tsx                 chat, image attach, /imagine, retry queue,
                                     and save actions
  ollama/client.ts                  streaming Ollama chat/vision bridge
  imagegen/client.ts                A1111-compatible txt2img client
  documents/generateDocx.ts         DOCX generation from assistant text
  settings/SettingsPage.tsx         backend settings and health checks
  memory/                           local JSON memory records and retrieval
  planning/                         local JSON task plans
  artifacts/                        metadata, safe names, save/reveal flows
  tools/                            local tool registry and in-memory audit sink
  models/                           local provider registry and routing
  shared/                           persistence, health, errors, common types
src-tauri/src/lib.rs                Rust commands for app data, local HTTP,
                                     file writes, artifact validation/reveal,
                                     and streamed Ollama chat
evals/                              deterministic offline eval cases
finetune/                           separate local fine-tuning prep workflow
docs/HANDOFF.md                     current setup, verification, limits, roadmap
```

## Known Limitations

- Chat history is still in-memory and clears on restart.
- Memory, plans, and artifact metadata are JSON-backed first passes, not
  SQLite-backed durable databases with migrations or concurrent-write handling.
- Memory retrieval is keyword/recency based unless a future embedding provider
  is implemented and enabled.
- Tool audit records are in-memory only and disappear on restart.
- The current tool registry is UI-driven; the model is not allowed to execute
  arbitrary shell commands, remote network calls, sends, deletes, or overwrites.
- Generic Rust file commands exist for app persistence and exports. Future
  model-directed tools need narrower path-scoped commands and explicit approval.
- Image generation supports A1111-compatible APIs only. ComfyUI needs an
  A1111-compatible shim or a dedicated client.
- Fine-tuning is external to the app and requires a real local GPU setup,
  reviewed data, and a separate training run.
- This pass did not live-smoke-test real Ollama, `llava`, or A1111 services;
  the verified checks are source/build/eval checks.

## Verification

Final verification was run from this checkout on 2026-07-24:

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd test` | Pass: 8 test files, 27 tests |
| `npm.cmd run eval` | Pass: 8 suites, 32 cases, 0 deterministic failures |
| `npm.cmd run build` | Pass, with Vite's advisory 500 kB chunk-size warning |
| `cargo check` in `src-tauri` | Pass |
| `cargo test` in `src-tauri` | Pass: 5 Rust tests |
| `npm.cmd run tauri build` | Pass, produced exe plus MSI/NSIS installers |

Release build artifacts:

- `src-tauri/target/release/jarvis-assistant.exe`
- `src-tauri/target/release/bundle/msi/Jarvis Assistant_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Jarvis Assistant_0.1.0_x64-setup.exe`

## Roadmap

1. Run live local acceptance with Ollama `llama3.1`, Ollama `llava`, and A1111
   API: chat, vision attach, `/imagine`, DOCX export, PNG export, and
   missing-service error states.
2. Persist chat threads and messages, then restore the last active thread on
   launch.
3. Move memory, plans, artifacts, indexed sources, retrieval chunks, and audit
   events into SQLite with migrations.
4. Add mocked tests for Ollama stream parsing, image-generation parsing, DOCX
   output, settings persistence, and file-write failures.
5. Add local embeddings and source-cited retrieval over explicitly selected
   folders.
6. Replace any future model-facing broad file/HTTP actions with narrow typed
   commands, approvals, audit records, and undo/versioning where practical.
7. Add image-generation controls for size, steps, seed, model metadata, and
   save history.
8. Keep fine-tuning external until there is a reviewed dataset, stable eval
   baseline, GPU check, run monitoring, and model comparison report.
