import { OllamaProvider } from "../models/providers";
import type { ChatProviderMessage } from "../models/types";

export type OllamaChatMessage = ChatProviderMessage;

/**
 * Sends a chat/vision request to a local Ollama server and streams the
 * reply. `onChunk` is called with each incremental content delta as it
 * arrives; the full accumulated reply is returned once the stream ends.
 * Uses the same command for both plain chat and vision -- Ollama tells
 * these apart by whether the last message carries an `images` field, not
 * by a different endpoint.
 */
export async function streamOllamaChat(
  baseUrl: string,
  model: string,
  messages: OllamaChatMessage[],
  onChunk: (delta: string) => void,
): Promise<string> {
  const provider = new OllamaProvider();
  const result = await provider.completeChat({
    model: {
      id: "ollama:compat",
      provider: "ollama",
      label: `Ollama (${model})`,
      modelName: model,
      baseUrl,
      capabilities: ["chat", "local-only"],
      local: true,
      requiresNetwork: false,
      privacyLevel: "local-only",
      enabled: true,
    },
    messages,
    onChunk,
  });
  return result.content;
}

/** Strips a `data:image/png;base64,...` prefix down to the raw base64 payload Ollama expects. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}
