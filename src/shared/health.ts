import { invoke } from "@tauri-apps/api/core";
import { actionableError, validateBaseUrl } from "./errors";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_VISION_MODEL,
  summarizeOllamaHealth,
  type OllamaTagsResponse,
} from "../ollama/reliability";
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

export async function checkOllamaHealth(settings: Settings): Promise<HealthCheckResult> {
  const label = "Ollama";
  try {
    const baseUrl = validateBaseUrl("Ollama base URL", settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
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
    const health = summarizeOllamaHealth(
      {
        baseUrl,
        chatModel: settings.chatModel || DEFAULT_CHAT_MODEL,
        visionModel: settings.visionModel || DEFAULT_VISION_MODEL,
      },
      baseUrl,
      parsed,
    );
    return {
      id: "ollama",
      label,
      ok: health.ok,
      message: health.message,
    };
  } catch (error) {
    return {
      id: "ollama",
      label,
      ok: false,
      message: actionableError(
        "Ollama health check failed",
        error,
        `Start Ollama and confirm it is reachable at ${DEFAULT_OLLAMA_BASE_URL}. Pull defaults with ollama pull ${DEFAULT_CHAT_MODEL} and ollama pull ${DEFAULT_VISION_MODEL}.`,
      ),
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
