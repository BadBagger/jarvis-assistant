# Jarvis Assistant

A local-first, Tauri + React desktop assistant: chat, image scanning
(vision), image generation, and document creation — all backed by models
that run entirely on your own machine. No cloud AI API, no accounts, no
usage limits beyond what your hardware can do.

## How it's wired

- **Chat** — sends messages to a local [Ollama](https://ollama.com) server
  (`/api/chat`, streamed). Model is configurable in Settings (default
  `llama3.1`).
- **Image scanning** — attach an image in chat and it's sent to Ollama's
  vision-capable model (default `llava`) alongside your prompt, using the
  same chat endpoint (Ollama takes images as base64 on the message).
- **Image generation** — type `/imagine <description>` and it's sent to a
  local Stable Diffusion WebUI-compatible server's `/sdapi/v1/txt2img`
  endpoint (works out of the box with
  [AUTOMATIC1111's WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui)
  launched with `--api`).
- **Document creation** — any assistant text reply has a "Save as document"
  button that builds a real `.docx` (via the `docx` npm package) and writes
  it to your configured output folder.

Everything talks to `localhost`/`127.0.0.1` only — this app never binds a
listening port and never calls out to the internet.

## Setup (on your own machine — this repo was scaffolded in a cloud dev
session that cannot run these services itself)

1. Install [Ollama](https://ollama.com), then:
   ```
   ollama pull llama3.1
   ollama pull llava
   ```
2. Install
   [AUTOMATIC1111's Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui)
   and launch it with the `--api` flag (e.g. add `--api` to
   `COMMANDLINE_ARGS` in `webui-user.bat`/`webui-user.sh`).
3. In this repo:
   ```
   npm install
   npm run tauri dev
   ```
4. Open Settings in the app and confirm/adjust the base URLs, models, and
   output folder, then hit Save.

## Development

```
npm install
npm run dev          # Vite dev server only (browser preview, no Tauri APIs)
npm run tauri dev    # full desktop app with hot reload
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build (frontend only)
npm run tauri build  # full desktop app build
```

`cargo check` inside `src-tauri/` type-checks the Rust backend
independently.

## Fine-tuning your own chat model

The app talks to whatever model Ollama serves under a given name — including
a model you've actually trained yourself. See `finetune/README.md` for a
full LoRA/QLoRA fine-tuning pipeline: prepare your own conversation data,
train a real custom adapter on an open base model, merge it, convert to
GGUF, and register it with Ollama. Then just point Settings → Chat model at
your new model's name. Needs a real GPU on your own machine; doesn't run in
a cloud sandbox.

## Project layout

```
src/
  ollama/client.ts         streamOllamaChat() -- shared by both plain chat
                            and vision (image scanning); talks to Ollama's
                            /api/chat over the Rust-side ollama_chat command
                            and listens for streamed "jarvis:chat-chunk"
                            events.
  imagegen/client.ts       generateImage() -- calls a Stable Diffusion
                            WebUI-compatible /sdapi/v1/txt2img endpoint via
                            the generic http_post command.
  documents/generateDocx.ts  builds a real .docx from a title + text body.
  chat/ChatPage.tsx         the whole assistant UI: message list, image
                            attach, /imagine command, save-as-document and
                            save-image actions.
  settings/SettingsPage.tsx  configure Ollama/image-gen URLs, models, and
                            the output folder.
  shared/persistence.ts     versioned settings JSON store (OS app-data dir).
src-tauri/src/lib.rs        Rust commands: app_data_dir, read/write_text_file,
                            write_binary_file, http_get, http_post (generic
                            local HTTP), ollama_chat (streaming chat/vision).
```

## Known setup gotchas

- **AUTOMATIC1111 WebUI on newer NVIDIA GPUs (e.g. RTX 5080/50-series):**
  the WebUI's pinned `Stability-AI/stablediffusion` dependency has gone
  missing upstream, and the default bundled PyTorch build doesn't support
  the newest CUDA-capable cards. Fix: point the dependency at a mirrored
  fork of that repo, and upgrade PyTorch to a CUDA 12.8 build. See
  [AUTOMATIC1111/stable-diffusion-webui#17204](https://github.com/AUTOMATIC1111/stable-diffusion-webui/issues/17204)
  for the specifics.

## Known limitations

- Chat history is in-memory only (cleared on restart) — no persisted
  conversation log yet.
- Image generation uses AUTOMATIC1111/A1111-API-compatible servers only;
  a ComfyUI setup needs its own API-compatibility shim or a dedicated
  ComfyUI client to work here.
- The base app orchestrates existing local models rather than training one;
  see `finetune/` if you want an actually-trained, custom-tuned chat model
  instead of an off-the-shelf one.
