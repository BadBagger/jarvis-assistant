import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Base64 image bytes, no "data:image/...;base64," prefix -- required for vision models like llava */
  images?: string[];
}

interface ChatChunkPayload {
  request_id: string;
  content: string;
  done: boolean;
  error: string | null;
}

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
  const requestId = crypto.randomUUID();
  let streamError: string | null = null;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // Attach the listener *before* invoking the command so no early chunk can
  // arrive and be missed while the listener is still being set up.
  const unlisten = await listen<ChatChunkPayload>("jarvis:chat-chunk", (event) => {
    if (event.payload.request_id !== requestId) return;
    if (event.payload.error) streamError = event.payload.error;
    if (event.payload.content) onChunk(event.payload.content);
    if (event.payload.done) resolveDone();
  });

  try {
    const invokePromise = invoke<string>("ollama_chat", {
      baseUrl,
      model,
      messages,
      requestId,
    });
    const [fullReply] = await Promise.all([invokePromise, donePromise]);
    if (streamError) throw new Error(streamError);
    return fullReply;
  } finally {
    unlisten();
  }
}

/** Strips a `data:image/png;base64,...` prefix down to the raw base64 payload Ollama expects. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}
