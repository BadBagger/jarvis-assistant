import { invoke } from "@tauri-apps/api/core";
import { describeError } from "./errors";

export async function logAppError(source: string, error: unknown): Promise<void> {
  const message = `[${new Date().toISOString()}] ${source}: ${describeError(error)}`;
  console.error(message, error);

  try {
    await invoke("append_app_log", { line: message });
  } catch (logError) {
    console.error("Could not write Jarvis app log", logError);
  }
}
