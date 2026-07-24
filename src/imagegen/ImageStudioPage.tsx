import { useState } from "react";
import { artifactRepository } from "../artifacts/store";
import type { ArtifactRecord } from "../artifacts/types";
import { createModelRouter } from "../models/router";
import { checkImageGenHealth } from "../shared/health";
import type { Settings } from "../shared/types";

interface Props {
  settings: Settings;
}

type SizePreset = "512x512" | "768x768" | "1024x1024" | "768x512" | "512x768";

interface GeneratedImageState {
  prompt: string;
  imageBase64: string;
  savedRecord?: ArtifactRecord;
}

const SIZE_PRESETS: SizePreset[] = ["768x768", "512x512", "1024x1024", "768x512", "512x768"];

function parseSize(preset: SizePreset): { width: number; height: number } {
  const [width, height] = preset.split("x").map((value) => Number.parseInt(value, 10));
  return { width, height };
}

export function ImageStudioPage({ settings }: Props) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality, distorted, text artifacts");
  const [sizePreset, setSizePreset] = useState<SizePreset>("768x768");
  const [steps, setSteps] = useState(24);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready.");
  const [generated, setGenerated] = useState<GeneratedImageState | null>(null);

  async function runHealthCheck() {
    setStatus("Checking image backend...");
    const result = await checkImageGenHealth(settings);
    setStatus(result.message);
  }

  async function generate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setStatus("Enter an image prompt first.");
      return;
    }

    setBusy(true);
    setStatus("Generating image...");
    setGenerated(null);
    try {
      const router = createModelRouter(settings);
      const { width, height } = parseSize(sizePreset);
      const result = await router.generateImage(trimmedPrompt, {
        width,
        height,
        steps,
        negativePrompt: negativePrompt.trim(),
      });
      setGenerated({ prompt: trimmedPrompt, imageBase64: result.imageBase64 });
      setStatus(`Generated ${width}x${height} image.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveImage() {
    if (!generated) return;
    setStatus("Saving image...");
    try {
      const record = await artifactRepository.saveBinaryArtifact({
        outputDir: settings.outputDir,
        kind: "image",
        format: "png",
        title: "Jarvis image",
        base64Data: generated.imageBase64,
        source: "image-generation",
        prompt: generated.prompt,
      });
      setGenerated({ ...generated, savedRecord: record });
      setStatus(`Saved ${record.fileName}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function openSavedFolder() {
    if (!generated?.savedRecord) return;
    try {
      await artifactRepository.revealInFolder(settings.outputDir, generated.savedRecord);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="image-studio-page">
      <section className="image-studio-panel image-studio-panel--controls">
        <div className="image-studio-heading">
          <div>
            <p className="image-studio-kicker">Stable Diffusion</p>
            <h2>Image Studio</h2>
          </div>
          <button onClick={() => void runHealthCheck()} disabled={busy}>
            Check backend
          </button>
        </div>

        <label>
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="A cinematic product photo of a compact AI control room, clean lighting, realistic materials"
          />
        </label>

        <label>
          Negative prompt
          <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} />
        </label>

        <div className="image-studio-grid">
          <label>
            Size
            <select value={sizePreset} onChange={(event) => setSizePreset(event.target.value as SizePreset)}>
              {SIZE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            Steps
            <input
              type="number"
              min={8}
              max={80}
              value={steps}
              onChange={(event) => setSteps(Number.parseInt(event.target.value || "24", 10))}
            />
          </label>
        </div>

        <button className="image-studio-primary" onClick={() => void generate()} disabled={busy}>
          {busy ? "Generating..." : "Generate"}
        </button>
        <p className="image-studio-status">{status}</p>
      </section>

      <section className="image-studio-panel image-studio-panel--preview">
        {generated ? (
          <>
            <img src={`data:image/png;base64,${generated.imageBase64}`} alt={generated.prompt} />
            <div className="image-studio-result-bar">
              <p>{generated.prompt}</p>
              <div>
                <button onClick={() => void saveImage()}>Save PNG</button>
                {generated.savedRecord && <button onClick={() => void openSavedFolder()}>Open folder</button>}
              </div>
            </div>
          </>
        ) : (
          <div className="image-studio-empty">
            <span>PNG</span>
          </div>
        )}
      </section>
    </div>
  );
}
