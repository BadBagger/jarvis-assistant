import { invoke } from "@tauri-apps/api/core";
import { actionableError, validateBaseUrl } from "./errors";
import type { Settings } from "./types";

interface HttpResult {
  status: number;
  body: string;
}

export interface HealthCheckResult {
  id: "ollama" | "imageGen";
  label: string;
  ok: boolean;
  message: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export async function checkOllamaHealth(settings: Settings): Promise<HealthCheckResult> {
  const label = "Ollama";
  try {
    const baseUrl = validateBaseUrl("Ollama base URL", settings.ollamaBaseUrl);
    const result = await invoke<HttpResult>("http_get", {
      url: `${baseUrl}/api/tags`,
      timeoutMs: 5000,
    });

    if (result.status < 200 || result.status >= 300) {
      return {
        id: "ollama",
        label,
        ok: false,
        message: `HTTP ${result.status} from ${baseUrl}/api/tags. Start Ollama or check the base URL.`,
      };
    }

    const parsed = JSON.parse(result.body) as OllamaTagsResponse;
    const names = new Set((parsed.models ?? []).map((model) => model.name).filter(Boolean));
    const missing = [settings.chatModel, settings.visionModel].filter((model) => !names.has(model));
    if (missing.length > 0) {
      return {
        id: "ollama",
        label,
        ok: false,
        message: `Connected, but missing model(s): ${missing.join(", ")}. Run ollama pull ${missing[0]}.`,
      };
    }

    return {
      id: "ollama",
      label,
      ok: true,
      message: `Connected at ${baseUrl}. Models available: ${settings.chatModel}, ${settings.visionModel}.`,
    };
  } catch (error) {
    return {
      id: "ollama",
      label,
      ok: false,
      message: actionableError("Ollama health check failed", error, "Confirm Ollama is running and reachable at the configured URL."),
    };
  }
}

export async function checkImageGenHealth(settings: Settings): Promise<HealthCheckResult> {
  const label = "Stable Diffusion";
  try {
    const baseUrl = validateBaseUrl("Image generation base URL", settings.imageGenBaseUrl);
    const result = await invoke<HttpResult>("http_get", {
      url: `${baseUrl}/sdapi/v1/options`,
      timeoutMs: 5000,
    });

    if (result.status < 200 || result.status >= 300) {
      return {
        id: "imageGen",
        label,
        ok: false,
        message: `HTTP ${result.status} from ${baseUrl}/sdapi/v1/options. Launch Stable Diffusion WebUI with --api or check the base URL.`,
      };
    }

    return {
      id: "imageGen",
      label,
      ok: true,
      message: `Connected at ${baseUrl}. The /sdapi/v1/options endpoint is responding.`,
    };
  } catch (error) {
    return {
      id: "imageGen",
      label,
      ok: false,
      message: actionableError(
        "Stable Diffusion health check failed",
        error,
        "Confirm the WebUI is running with --api and reachable at the configured URL.",
      ),
    };
  }
}

export async function checkBackendHealth(settings: Settings): Promise<HealthCheckResult[]> {
  return Promise.all([checkOllamaHealth(settings), checkImageGenHealth(settings)]);
}
