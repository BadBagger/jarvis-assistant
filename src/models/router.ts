import type { Settings } from "../shared/types";
import { Automatic1111Provider, OllamaProvider } from "./providers";
import { buildModelRegistry, selectModelForUseCase } from "./registry";
import type { ModelRegistry } from "./registry";
import type {
  ChatCompletionResult,
  ChatProviderMessage,
  EmbeddingResult,
  ImageGenerationOptions,
  ImageGenerationResult,
  ModelRouteUseCase,
} from "./types";

export class ModelRouter {
  readonly registry: ModelRegistry;

  private readonly ollama = new OllamaProvider();
  private readonly automatic1111 = new Automatic1111Provider();

  constructor(settings: Settings) {
    this.registry = buildModelRegistry(settings);
  }

  select(useCase: ModelRouteUseCase) {
    return selectModelForUseCase(this.registry, useCase);
  }

  completeChat(messages: ChatProviderMessage[], onChunk?: (delta: string) => void): Promise<ChatCompletionResult> {
    const model = this.select("chat");
    return this.ollama.completeChat({ model, messages, onChunk });
  }

  analyzeImage(prompt: string, imageBase64: string, onChunk?: (delta: string) => void): Promise<ChatCompletionResult> {
    const model = this.select("vision");
    return this.ollama.analyzeImage({ model, prompt, imageBase64, onChunk });
  }

  generateImage(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const model = this.select("image-generation");
    return this.automatic1111.generateImage({ model, prompt, options });
  }

  createEmbeddings(input: string | string[]): Promise<EmbeddingResult> {
    const model = this.select("embeddings");
    return this.ollama.createEmbeddings({ model, input });
  }
}

export function createModelRouter(settings: Settings): ModelRouter {
  return new ModelRouter(settings);
}
