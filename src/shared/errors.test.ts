import { describe, expect, it } from "vitest";
import { validateBaseUrl } from "./errors";

describe("validateBaseUrl", () => {
  it("accepts localhost service URLs and trims trailing slashes", () => {
    expect(validateBaseUrl("Ollama base URL", " http://localhost:11434/// ")).toBe("http://localhost:11434");
    expect(validateBaseUrl("Image generation base URL", "http://127.0.0.1:7860")).toBe("http://127.0.0.1:7860");
    expect(validateBaseUrl("Ollama base URL", "http://[::1]:11434")).toBe("http://[::1]:11434");
  });

  it("rejects blank, non-http, and remote URLs", () => {
    expect(() => validateBaseUrl("URL", "")).toThrow("blank");
    expect(() => validateBaseUrl("URL", "file:///tmp/model")).toThrow("http:// or https://");
    expect(() => validateBaseUrl("URL", "https://example.com")).toThrow("localhost");
    expect(() => validateBaseUrl("URL", "http://192.168.1.10:11434")).toThrow("localhost");
  });
});
