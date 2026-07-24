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
        requiresNetwork: false,
        privacyLevel: "local-only",
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
        requiresNetwork: false,
        privacyLevel: "local-only",
        enabled: Boolean(ollamaBaseUrl && settings.visionModel.trim()),
      },
      {
        id: "automatic1111:image-generation",
        provider: "automatic1111",
        label: "Stable Diffusion WebUI image generation",
        baseUrl: imageGenBaseUrl,
        capabilities: withOperationalCapabilities(["image-generation"], { local: true, requiresNetwork: false }),
        local: true,
        requiresNetwork: false,
        privacyLevel: "local-only",
        enabled: Boolean(imageGenBaseUrl),
      },
    ],
  };
}

export function selectModelForUseCase(registry: ModelRegistry, useCase: ModelRouteUseCase): ModelDescriptor {
  const requiredCapabilities = useCaseCapabilities[useCase];
  const enabledModels = registry.models.filter((model) => model.enabled);
  const match = enabledModels.find((model) => requiredCapabilities.every((capability) => model.capabilities.includes(capability)));

  if (!match) {
    if (enabledModels.length > 0) {
      throw new UnsupportedModelCapabilityError(useCase, requiredCapabilities, enabledModels);
    }
    throw new ModelRouteUnavailableError(useCase);
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

  if (/(16k|32k|128k|200k|1m|long|llama3\.1|qwen2\.5|qwen3|gemini|claude)/.test(normalized)) {
    capabilities.add("long-context");
  }

  return withOperationalCapabilities([...capabilities], { local: true, requiresNetwork: false });
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

function withOperationalCapabilities(
  capabilities: ModelCapability[],
  options: { local: boolean; requiresNetwork: boolean },
): ModelCapability[] {
  const expanded = new Set<ModelCapability>(capabilities);
  if (options.local) expanded.add("local-only");
  if (options.requiresNetwork) expanded.add("requires-network");
  return [...expanded];
}

export class ModelRouteUnavailableError extends Error {
  readonly useCase: ModelRouteUseCase;

  constructor(useCase: ModelRouteUseCase) {
    super(`No enabled model is registered for ${useCase}. Check Settings and model provider configuration.`);
    this.name = "ModelRouteUnavailableError";
    this.useCase = useCase;
  }
}

export class UnsupportedModelCapabilityError extends Error {
  readonly useCase: ModelRouteUseCase;
  readonly requiredCapabilities: ModelCapability[];
  readonly enabledModelIds: string[];

  constructor(useCase: ModelRouteUseCase, requiredCapabilities: ModelCapability[], enabledModels: ModelDescriptor[]) {
    super(
      `No enabled model supports ${useCase}. Required capabilities: ${requiredCapabilities.join(", ")}. Enabled models: ${
        enabledModels.map((model) => model.id).join(", ") || "none"
      }.`,
    );
    this.name = "UnsupportedModelCapabilityError";
    this.useCase = useCase;
    this.requiredCapabilities = requiredCapabilities;
    this.enabledModelIds = enabledModels.map((model) => model.id);
  }
}
