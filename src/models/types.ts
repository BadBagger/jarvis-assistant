export type ModelProviderKind = "ollama" | "automatic1111" | "openai" | "cloud";

export type ModelCapability =
  | "chat"
  | "coding"
  | "vision"
  | "image-generation"
  | "embeddings"
  | "long-context"
  | "local-only"
  | "requires-network";

export type ModelRouteUseCase = "chat" | "coding" | "vision" | "image-generation" | "embeddings" | "long-context";

export type ModelPrivacyLevel = "local-only" | "private-network" | "cloud";

export interface ModelDescriptor {
  id: string;
  provider: ModelProviderKind;
  label: string;
  modelName?: string;
  baseUrl?: string;
  capabilities: ModelCapability[];
  contextWindowTokens?: number;
  local: boolean;
  requiresNetwork: boolean;
  privacyLevel: ModelPrivacyLevel;
  enabled: boolean;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatProviderMessage {
  role: ChatRole;
  content: string;
  /** Base64 image bytes, no data URL prefix. */
  images?: string[];
}

export interface ChatCompletionRequest {
  model: ModelDescriptor;
  messages: ChatProviderMessage[];
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: ModelDescriptor;
}

export interface VisionAnalysisRequest {
  model: ModelDescriptor;
  prompt: string;
  imageBase64: string;
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ImageGenerationOptions {
  steps?: number;
  width?: number;
  height?: number;
  negativePrompt?: string;
}

export interface ImageGenerationRequest {
  model: ModelDescriptor;
  prompt: string;
  options?: ImageGenerationOptions;
}

export interface ImageGenerationResult {
  imageBase64: string;
  model: ModelDescriptor;
}

export interface EmbeddingRequest {
  model: ModelDescriptor;
  input: string | string[];
}

export interface EmbeddingResult {
  vectors: number[][];
  model: ModelDescriptor;
}

export interface ChatModelProvider {
  readonly id: string;
  completeChat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export interface VisionModelProvider {
  readonly id: string;
  analyzeImage(request: VisionAnalysisRequest): Promise<ChatCompletionResult>;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export interface CloudProviderConfig {
  id: string;
  label: string;
  baseUrl?: string;
  apiKeySettingName?: string;
  enabled: boolean;
}
