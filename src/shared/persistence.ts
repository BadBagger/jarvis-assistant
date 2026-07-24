import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Omit<Settings, "outputDir"> = {
  version: 1,
  ollamaBaseUrl: "http://localhost:11434",
  chatModel: "llama3.1",
  visionModel: "llava",
  imageGenBaseUrl: "http://127.0.0.1:7860",
};

export async function appDataFilePath(fileName: string): Promise<string> {
  const dir = await invoke<string>("app_data_dir");
  return `${dir}/${fileName}`;
}

async function settingsPath(): Promise<string> {
  return appDataFilePath("settings.json");
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  const raw = await invoke<string | null>("read_text_file", { path });
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(path: string, value: T): Promise<void> {
  await invoke("write_text_file", { path, contents: JSON.stringify(value, null, 2) });
}

export async function loadSettings(): Promise<Settings> {
  let appDir: string;
  try {
    appDir = await invoke<string>("app_data_dir");
  } catch {
    return { ...DEFAULT_SETTINGS, outputDir: "Jarvis/outputs" };
  }
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
  await writeJsonFile(path, settings);
}
