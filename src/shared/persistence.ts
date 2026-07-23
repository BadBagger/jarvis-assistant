import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Omit<Settings, "outputDir"> = {
  version: 1,
  ollamaBaseUrl: "http://localhost:11434",
  chatModel: "llama3.1",
  visionModel: "llava",
  imageGenBaseUrl: "http://127.0.0.1:7860",
};

async function settingsPath(): Promise<string> {
  const dir = await invoke<string>("app_data_dir");
  return `${dir}/settings.json`;
}

export async function loadSettings(): Promise<Settings> {
  const appDir = await invoke<string>("app_data_dir");
  const defaults: Settings = { ...DEFAULT_SETTINGS, outputDir: `${appDir}/outputs` };

  const path = await settingsPath();
  const raw = await invoke<string | null>("read_text_file", { path });
  if (!raw) return defaults;

  try {
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const path = await settingsPath();
  await invoke("write_text_file", { path, contents: JSON.stringify(settings, null, 2) });
}
