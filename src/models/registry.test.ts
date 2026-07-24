import { describe, expect, it } from "vitest";
import type { Settings } from "../shared/types";
import { buildModelRegistry, selectModelForUseCase, UnsupportedModelCapabilityError } from "./registry";

const baseSettings: Settings = {
  version: 1,
  ollamaBaseUrl: "http://localhost:11434",
  chatModel: "llama3.1",
  visionModel: "llava",
  imageGenBaseUrl: "http://127.0.0.1:7860",
  outputDir: "C:\\Users\\KyleB\\Documents\\Jarvis",
};

describe("model registry routing", () => {
  it("selects local providers by requested capability", () => {
    const registry = buildModelRegistry(baseSettings);

    expect(selectModelForUseCase(registry, "chat")).toMatchObject({
      id: "ollama:chat",
      local: true,
      requiresNetwork: false,
      privacyLevel: "local-only",
    });
    expect(selectModelForUseCase(registry, "vision").id).toBe("ollama:vision");
    expect(selectModelForUseCase(registry, "image-generation")).toMatchObject({
      id: "automatic1111:image-generation",
      provider: "automatic1111",
    });
  });

  it("records typed capability metadata for configured models", () => {
    const registry = buildModelRegistry({ ...baseSettings, chatModel: "deepseek-coder-v2:16k" });
    const chatModel = selectModelForUseCase(registry, "coding");

    expect(chatModel.capabilities).toEqual(expect.arrayContaining(["chat", "coding", "long-context", "local-only"]));
    expect(chatModel.contextWindowTokens).toBe(16_384);
  });

  it("throws an unsupported-capability error when enabled models cannot satisfy a route", () => {
    const registry = buildModelRegistry({
      ...baseSettings,
      chatModel: "mistral",
      visionModel: "",
      imageGenBaseUrl: "",
    });

    expect(() => selectModelForUseCase(registry, "vision")).toThrow(UnsupportedModelCapabilityError);
    expect(() => selectModelForUseCase(registry, "vision")).toThrow("Required capabilities: chat, vision");
  });
});
