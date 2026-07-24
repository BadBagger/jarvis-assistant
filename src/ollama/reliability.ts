import { describeError, validateBaseUrl } from "../shared/errors";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_CHAT_MODEL = "llama3.1";
export const DEFAULT_VISION_MODEL = "llava";

export interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

export interface OllamaHealthInput {
  baseUrl: string;
  chatModel: string;
  visionModel: string;
}

export interface OllamaHealthResult {
  ok: boolean;
  baseUrl: string;
  availableModels: string[];
  missingModels: string[];
  message: string;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export async function checkOllamaHealthWithFetch(
  input: OllamaHealthInput,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; retry?: RetryOptions } = {},
): Promise<OllamaHealthResult> {
  const baseUrl = validateBaseUrl("Ollama base URL", input.baseUrl || DEFAULT_OLLAMA_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  const response = await retryTransient(
    () =>
      fetchWithTimeout(`${baseUrl}/api/tags`, {
        fetchImpl,
        timeoutMs,
        signal: options.retry?.signal,
      }),
    options.retry,
  );

  if (!response.ok) {
    throw new Error(ollamaHttpMessage(response.status, `${baseUrl}/api/tags`));
  }

  const parsed = (await response.json()) as OllamaTagsResponse;
  return summarizeOllamaHealth(input, baseUrl, parsed);
}

export function summarizeOllamaHealth(input: OllamaHealthInput, baseUrl: string, tags: OllamaTagsResponse): OllamaHealthResult {
  const availableModels = extractOllamaModelNames(tags);
  const requiredModels = uniqueModelNames([input.chatModel || DEFAULT_CHAT_MODEL, input.visionModel || DEFAULT_VISION_MODEL]);
  const missingModels = requiredModels.filter((model) => !isOllamaModelAvailable(model, availableModels));

  if (missingModels.length > 0) {
    return {
      ok: false,
      baseUrl,
      availableModels,
      missingModels,
      message: missingModelsMessage(missingModels),
    };
  }

  return {
    ok: true,
    baseUrl,
    availableModels,
    missingModels: [],
    message: `Connected at ${baseUrl}. Models available: ${requiredModels.join(", ")}.`,
  };
}

export function extractOllamaModelNames(tags: OllamaTagsResponse): string[] {
  return uniqueModelNames((tags.models ?? []).map((model) => model.name ?? model.model ?? ""));
}

export function isOllamaModelAvailable(requestedModel: string, availableModels: string[]): boolean {
  const requested = normalizeOllamaModelName(requestedModel);
  if (!requested) return false;
  return availableModels.some((available) => {
    const normalized = normalizeOllamaModelName(available);
    return normalized === requested || normalized === `${requested}:latest` || normalized.split(":")[0] === requested;
  });
}

export function missingModelsMessage(missingModels: string[]): string {
  const pulls = missingModels.map((model) => `ollama pull ${model}`).join(" and ");
  return `Ollama is running, but missing model(s): ${missingModels.join(", ")}. Run ${pulls}, then retry.`;
}

export function normalizeOllamaError(error: unknown, modelName?: string): Error {
  const detail = describeError(error);
  const lower = detail.toLowerCase();
  const model = modelName?.trim();

  if (lower.includes("abort") || lower.includes("timed out") || lower.includes("timeout")) {
    return new Error(`Ollama request timed out. Confirm Ollama is still responding at ${DEFAULT_OLLAMA_BASE_URL}, then retry.`);
  }

  if (lower.includes("could not reach ollama") || lower.includes("failed to fetch") || lower.includes("connection refused")) {
    return new Error(
      `Ollama is not reachable. Start Ollama, confirm it is listening at ${DEFAULT_OLLAMA_BASE_URL}, then retry. Jarvis will not fall back to cloud providers.`,
    );
  }

  if (lower.includes("not found") && lower.includes("model")) {
    return new Error(`Ollama model${model ? ` "${model}"` : ""} is not available. Run ollama pull ${model || DEFAULT_CHAT_MODEL}, then retry.`);
  }

  if (lower.includes("http 404") && model) {
    return new Error(`Ollama model "${model}" is not available. Run ollama pull ${model}, then retry.`);
  }

  if (lower.includes("http 500") || lower.includes("http 502") || lower.includes("http 503") || lower.includes("http 504")) {
    return new Error(`Ollama returned a temporary server error. Check the Ollama window/logs and retry. Details: ${detail}`);
  }

  return error instanceof Error ? error : new Error(detail);
}

export function isTransientOllamaError(error: unknown): boolean {
  const lower = describeError(error).toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("connection reset") ||
    lower.includes("connection closed") ||
    lower.includes("http 408") ||
    lower.includes("http 429") ||
    lower.includes("http 500") ||
    lower.includes("http 502") ||
    lower.includes("http 503") ||
    lower.includes("http 504")
  );
}

export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientOllamaError(error)) break;
      await delay(baseDelayMs * 2 ** (attempt - 1), options.signal);
    }
  }

  throw lastError;
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (timeoutMs <= 0) return operation;
  throwIfAborted(signal);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Ollama request timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(
  url: string,
  options: { fetchImpl: typeof fetch; timeoutMs: number; signal?: AbortSignal },
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await options.fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`Ollama health check timed out after ${options.timeoutMs}ms`);
    if (controller.signal.aborted) throw new Error("Ollama request was cancelled");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function ollamaHttpMessage(status: number, url: string): string {
  if (status === 404) return `HTTP 404 from ${url}. Confirm Ollama is running at the configured base URL.`;
  if (status >= 500) return `HTTP ${status} from ${url}. Ollama responded with a temporary server error.`;
  return `HTTP ${status} from ${url}. Start Ollama or check the base URL.`;
}

function normalizeOllamaModelName(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function uniqueModelNames(modelNames: string[]): string[] {
  return [...new Set(modelNames.map((model) => model.trim()).filter(Boolean))];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Ollama request was cancelled");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error("Ollama request was cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
