import { describe, expect, it, vi } from "vitest";
import {
  checkOllamaHealthWithFetch,
  isOllamaModelAvailable,
  missingModelsMessage,
  normalizeOllamaError,
  retryTransient,
} from "./reliability";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Ollama reliability", () => {
  it("checks health and accepts Ollama :latest tags for default models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [{ name: "llama3.1:latest" }, { name: "llava:latest" }],
      }),
    );

    const result = await checkOllamaHealthWithFetch(
      { baseUrl: "http://localhost:11434", chatModel: "llama3.1", visionModel: "llava" },
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    expect(result.availableModels).toEqual(["llama3.1:latest", "llava:latest"]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("reports actionable pull commands for missing models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ models: [{ name: "llama3.1:latest" }] }));

    const result = await checkOllamaHealthWithFetch(
      { baseUrl: "http://localhost:11434", chatModel: "llama3.1", visionModel: "llava" },
      { fetchImpl },
    );

    expect(result.ok).toBe(false);
    expect(result.missingModels).toEqual(["llava"]);
    expect(result.message).toContain("ollama pull llava");
  });

  it("retries transient fetch failures with backoff", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("HTTP 503 from http://localhost:11434/api/tags"))
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: "llama3.1:latest" }, { name: "llava:latest" }] }));

    const result = await checkOllamaHealthWithFetch(
      { baseUrl: "http://localhost:11434", chatModel: "llama3.1", visionModel: "llava" },
      { fetchImpl, retry: { attempts: 2, baseDelayMs: 1 } },
    );

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient failures", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("Ollama model not found"));

    await expect(retryTransient(operation, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("not found");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("normalizes missing service and model errors into user-facing messages", () => {
    expect(normalizeOllamaError(new Error("could not reach Ollama at http://localhost:11434/api/chat"), "llama3.1").message).toContain(
      "Start Ollama",
    );
    expect(normalizeOllamaError(new Error("model 'llava' not found"), "llava").message).toContain("ollama pull llava");
  });

  it("matches exact tags, latest tags, and untagged names", () => {
    expect(isOllamaModelAvailable("llama3.1", ["llama3.1:latest"])).toBe(true);
    expect(isOllamaModelAvailable("llava:13b", ["llava:13b"])).toBe(true);
    expect(isOllamaModelAvailable("mistral", ["llama3.1:latest"])).toBe(false);
    expect(missingModelsMessage(["llama3.1", "llava"])).toContain("ollama pull llama3.1 and ollama pull llava");
  });
});
