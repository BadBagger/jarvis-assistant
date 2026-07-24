import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatProviderMessage,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  VisionAnalysisRequest,
  VisionModelProvider,
  ChatModelProvider,
} from "./types";

interface ChatChunkPayload {
  request_id: string;
  content: string;
  done: boolean;
  error: string | null;
}

interface HttpResult {
  status: number;
  body: string;
}

interface Txt2ImgResponse {
  images?: string[];
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export class OllamaProvider implements ChatModelProvider, VisionModelProvider, EmbeddingProvider {
  readonly id = "ollama";

  async completeChat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    return {
      content: await this.streamChat(request.model.baseUrl, request.model.modelName, request.messages, request.onChunk),
      model: request.model,
    };
  }

  async analyzeImage(request: VisionAnalysisRequest): Promise<ChatCompletionResult> {
    const messages: ChatProviderMessage[] = [
      {
        role: "user",
        content: request.prompt,
        images: [request.imageBase64],
      },
    ];

    return {
      content: await this.streamChat(request.model.baseUrl, request.model.modelName, messages, request.onChunk),
      model: request.model,
    };
  }

  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const baseUrl = requireEndpoint(request.model.baseUrl, "Ollama base URL");
    const modelName = requireModelName(request.model.modelName, "Ollama embedding model");
    const input = Array.isArray(request.input) ? request.input : [request.input];
    const result = await invoke<HttpResult>("http_post", {
      url: `${baseUrl.trim().replace(/\/$/, "")}/api/embed`,
      bodyJson: JSON.stringify({ model: modelName, input }),
      timeoutMs: 60_000,
    });

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Ollama embeddings responded with HTTP ${result.status}: ${result.body}`);
    }

    const parsed = JSON.parse(result.body) as OllamaEmbedResponse;
    const vectors = parsed.embeddings ?? (parsed.embedding ? [parsed.embedding] : undefined);
    if (!vectors) throw new Error("Ollama embeddings returned no vectors");
    return { vectors, model: request.model };
  }

  private async streamChat(
    baseUrl: string | undefined,
    modelName: string | undefined,
    messages: ChatProviderMessage[],
    onChunk: ((delta: string) => void) | undefined,
  ): Promise<string> {
    const requestId = crypto.randomUUID();
    let streamError: string | null = null;
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const unlisten = await listen<ChatChunkPayload>("jarvis:chat-chunk", (event) => {
      if (event.payload.request_id !== requestId) return;
      if (event.payload.error) streamError = event.payload.error;
      if (event.payload.content) onChunk?.(event.payload.content);
      if (event.payload.done) resolveDone();
    });

    try {
      const invokePromise = invoke<string>("ollama_chat", {
        baseUrl: requireEndpoint(baseUrl, "Ollama base URL"),
        model: requireModelName(modelName, "Ollama model"),
        messages,
        requestId,
      });
      const [fullReply] = await Promise.all([invokePromise, donePromise]);
      if (streamError) throw new Error(streamError);
      return fullReply;
    } finally {
      unlisten();
    }
  }
}

export class Automatic1111Provider implements ImageGenerationProvider {
  readonly id = "automatic1111";

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const payload = {
      prompt: request.prompt,
      negative_prompt: request.options?.negativePrompt ?? "",
      steps: request.options?.steps ?? 20,
      width: request.options?.width ?? 512,
      height: request.options?.height ?? 512,
    };

    const result = await invoke<HttpResult>("http_post", {
      url: `${requireEndpoint(request.model.baseUrl, "Image generation base URL").trim().replace(/\/$/, "")}/sdapi/v1/txt2img`,
      bodyJson: JSON.stringify(payload),
      timeoutMs: 180_000,
    });

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Image generation server responded with HTTP ${result.status}: ${result.body}`);
    }

    let parsed: Txt2ImgResponse;
    try {
      parsed = JSON.parse(result.body) as Txt2ImgResponse;
    } catch {
      throw new Error("Image generation server returned an unparseable response");
    }

    const imageBase64 = parsed.images?.[0];
    if (!imageBase64) throw new Error("Image generation server returned no image");
    return { imageBase64, model: request.model };
  }
}

function requireEndpoint(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is not configured`);
  return value;
}

function requireModelName(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is not configured`);
  return value;
}
