import { useState } from "react";
import { saveSettings } from "../shared/persistence";
import type { Settings } from "../shared/types";

interface Props {
  settings: Settings;
  onSaved: (settings: Settings) => void;
}

export function SettingsPage({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [status, setStatus] = useState<string | null>(null);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setStatus(null);
    try {
      await saveSettings(draft);
      onSaved(draft);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <label>
        Ollama base URL
        <input
          value={draft.ollamaBaseUrl}
          onChange={(e) => update("ollamaBaseUrl", e.target.value)}
          placeholder="http://localhost:11434"
        />
      </label>

      <label>
        Chat model
        <input value={draft.chatModel} onChange={(e) => update("chatModel", e.target.value)} placeholder="llama3.1" />
      </label>

      <label>
        Vision model (image scanning)
        <input value={draft.visionModel} onChange={(e) => update("visionModel", e.target.value)} placeholder="llava" />
      </label>

      <label>
        Image generation base URL
        <input
          value={draft.imageGenBaseUrl}
          onChange={(e) => update("imageGenBaseUrl", e.target.value)}
          placeholder="http://127.0.0.1:7860"
        />
      </label>

      <label>
        Output folder (saved images/documents)
        <input value={draft.outputDir} onChange={(e) => update("outputDir", e.target.value)} />
      </label>

      <button onClick={() => void handleSave()}>Save</button>
      {status && <p className="settings-status">{status}</p>}

      <div className="settings-help">
        <h3>Setup checklist (runs on your machine, not in the cloud)</h3>
        <ul>
          <li>
            Install <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a>, then run{" "}
            <code>ollama pull llama3.1</code> and <code>ollama pull llava</code>.
          </li>
          <li>
            Install AUTOMATIC1111&apos;s Stable Diffusion WebUI and launch it with the <code>--api</code> flag so this
            app can reach its <code>/sdapi/v1/txt2img</code> endpoint.
          </li>
          <li>Both must be running locally before chat, image scanning, or image generation will work.</li>
        </ul>
      </div>
    </div>
  );
}
