import type { Settings } from "../shared/types";
import type { ModelCapability, ModelDescriptor, ModelRouteUseCase } from "./types";

export interface ModelRegistry {
  models: ModelDescriptor[];
}

const DEFAULT_CHAT_CONTEXT_WINDOW = 8_192;
const DEFAULT_VISION_CONTEXT_WINDOW = 4_096;

const useCaseCapabilities: Record<ModelRouteUseCase, ModelCapability[]> = {
  chat: ["chat"],
  coding: ["chat", "coding"],
  vision: ["chat", "vision"],
  "image-generation": ["image-generation"],
  embeddings: ["embeddings"],
  "long-context": ["chat", "long-context"],
};

export function buildModelRegistry(settings: Settings): ModelRegistry {
  const ollamaBaseUrl = settings.ollamaBaseUrl.trim();
  const imageGenBaseUrl = settings.imageGenBaseUrl.trim();

  return {
    models: [
      {
        id: "ollama:chat",
        provider: "ollama",
        label: `Ollama chat (${settings.chatModel})`,
        modelName: settings.chatModel,
        baseUrl: ollamaBaseUrl,
        capabilities: capabilitiesForOllamaModel(settings.chatModel, ["chat"]),
        contextWindowTokens: estimateContextWindow(settings.chatModel, DEFAULT_CHAT_CONTEXT_WINDOW),
        local: true,
        enabled: Boolean(ollamaBaseUrl && settings.chatModel.trim()),
      },
      {
        id: "ollama:vision",
        provider: "ollama",
        label: `Ollama vision (${settings.visionModel})`,
        modelName: settings.visionModel,
        baseUrl: ollamaBaseUrl,
        capabilities: capabilitiesForOllamaModel(settings.visionModel, ["chat", "vision"]),
        contextWindowTokens: estimateContextWindow(settings.visionModel, DEFAULT_VISION_CONTEXT_WINDOW),
        local: true,
        enabled: Boolean(ollamaBaseUrl && settings.visionModel.trim()),
      },
      {
        id: "automatic1111:image-generation",
        provider: "automatic1111",
        label: "Stable Diffusion WebUI image generation",
        baseUrl: imageGenBaseUrl,
        capabilities: ["image-generation"],
        local: true,
        enabled: Boolean(imageGenBaseUrl),
      },
    ],
  };
}

export function selectModelForUseCase(registry: ModelRegistry, useCase: ModelRouteUseCase): ModelDescriptor {
  const requiredCapabilities = useCaseCapabilities[useCase];
  const match = registry.models.find(
    (model) => model.enabled && requiredCapabilities.every((capability) => model.capabilities.includes(capability)),
  );

  if (!match) {
    throw new Error(`No enabled model is registered for ${useCase}. Check Settings and model provider configuration.`);
  }

  return match;
}

export function modelSupports(model: ModelDescriptor, capability: ModelCapability): boolean {
  return model.capabilities.includes(capability);
}

function capabilitiesForOllamaModel(modelName: string, baseline: ModelCapability[]): ModelCapability[] {
  const normalized = modelName.toLowerCase();
  const capabilities = new Set<ModelCapability>(baseline);

  if (/(code|coder|codestral|deepseek-coder|starcoder)/.test(normalized)) {
    capabilities.add("coding");
  }

  if (/(llava|vision|moondream|bakllava|minicpm-v|qwen.*vl|gemma.*vision)/.test(normalized)) {
    capabilities.add("vision");
  }

  if (/(embed|bge|nomic|snowflake-arctic-embed|mxbai)/.test(normalized)) {
    capabilities.add("embeddings");
  }

  if (/(128k|200k|1m|long|llama3\.1|qwen2\.5|qwen3|gemini|claude)/.test(normalized)) {
    capabilities.add("long-context");
  }

  return [...capabilities];
}

function estimateContextWindow(modelName: string, fallback: number): number {
  const normalized = modelName.toLowerCase();
  if (/(1m|1000k)/.test(normalized)) return 1_000_000;
  if (/(200k|256k)/.test(normalized)) return 200_000;
  if (/(128k|llama3\.1|qwen2\.5|qwen3)/.test(normalized)) return 128_000;
  if (/32k/.test(normalized)) return 32_768;
  if (/16k/.test(normalized)) return 16_384;
  return fallback;
}
