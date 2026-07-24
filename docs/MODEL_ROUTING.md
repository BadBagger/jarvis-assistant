# Model Routing Architecture

Jarvis routes model work through a small TypeScript provider layer in `src/models`.
The current Rust commands and local service behavior are unchanged: chat and vision
still use the `ollama_chat` Tauri command, and image generation still uses the
generic `http_post` command against an AUTOMATIC1111-compatible `/sdapi/v1/txt2img`
endpoint.

## Goals

- Keep local-first Ollama and AUTOMATIC1111 support as the default behavior.
- Give chat, vision, image generation, embeddings, and future cloud providers typed
  contracts.
- Keep UI code from depending on provider-specific endpoints.
- Add a capability registry so later features can request a use case such as
  `coding`, `vision`, or `long-context` without hard-coding model names in the
  workflow.

## Files

- `src/models/types.ts` defines provider-neutral request and result types for:
  chat, vision, image generation, embeddings, and future cloud provider config.
- `src/models/providers.ts` contains concrete local providers:
  `OllamaProvider` and `Automatic1111Provider`.
- `src/models/registry.ts` builds a simple registry from current Settings and
  tags each configured model with capabilities.
- `src/models/router.ts` selects a registered model by use case and invokes the
  matching provider.
- `src/ollama/client.ts` and `src/imagegen/client.ts` remain as compatibility
  wrappers around the provider layer for existing imports.

## Current Routes

| Use case | Provider | Source setting | Capability |
| --- | --- | --- | --- |
| Chat | Ollama | `ollamaBaseUrl`, `chatModel` | `chat` |
| Vision | Ollama | `ollamaBaseUrl`, `visionModel` | `chat`, `vision` |
| Image generation | AUTOMATIC1111-compatible API | `imageGenBaseUrl` | `image-generation` |

The UI uses `createModelRouter(settings)` and calls:

- `completeChat(...)` for normal assistant messages.
- `analyzeImage(...)` for image attachments.
- `generateImage(...)` for `/imagine`.

## Capability Registry

`buildModelRegistry(settings)` creates `ModelDescriptor` entries for the current
configured services. Capability detection is intentionally conservative and
name-based for now:

- code-oriented names such as `coder`, `codestral`, or `deepseek-coder` add
  `coding`.
- vision-oriented names such as `llava`, `vision`, `moondream`, or `qwen-vl` add
  `vision`.
- embedding-oriented names such as `embed`, `bge`, `nomic`, or `mxbai` add
  `embeddings`.
- long-context hints such as `128k`, `200k`, `long`, `llama3.1`, or `qwen2.5`
  add `long-context`.

This registry is not a quality ranking system. It is a routing contract that lets
future features ask for a capability without knowing provider details. A later
Settings model manager can replace the name heuristics with explicit user-edited
metadata while keeping the same `ModelDescriptor` shape.

## Future Cloud Providers

Cloud providers should implement the same interfaces in `src/models/types.ts`:

- `ChatModelProvider`
- `VisionModelProvider`
- `ImageGenerationProvider`
- `EmbeddingProvider`

Cloud provider settings should map into `ModelDescriptor` records with
`provider: "cloud"` and `local: false`. Remote providers should stay disabled
until the user explicitly configures them, and any future API key setting should
be represented through `CloudProviderConfig` rather than stored in the registry
itself.

## Behavior Compatibility

The abstraction does not change user-visible behavior:

- Streaming chat still emits and listens for `jarvis:chat-chunk`.
- Vision still sends base64 image bytes on the Ollama chat message.
- `/imagine` still uses a 512x512, 20-step default A1111 payload.
- Generated images and documents are saved by the existing chat UI actions.
