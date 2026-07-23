import { invoke } from "@tauri-apps/api/core";

export interface ImageGenOptions {
  steps?: number;
  width?: number;
  height?: number;
  negativePrompt?: string;
}

interface HttpResult {
  status: number;
  body: string;
}

interface Txt2ImgResponse {
  images?: string[];
}

/**
 * Generates an image via a Stable Diffusion WebUI-compatible `/sdapi/v1/txt2img`
 * endpoint (AUTOMATIC1111's WebUI exposes this natively when started with
 * `--api`; ComfyUI needs an API-compatibility shim to match this shape).
 * Returns base64 PNG bytes, no data: prefix.
 */
export async function generateImage(
  baseUrl: string,
  prompt: string,
  options: ImageGenOptions = {},
): Promise<string> {
  const payload = {
    prompt,
    negative_prompt: options.negativePrompt ?? "",
    steps: options.steps ?? 20,
    width: options.width ?? 512,
    height: options.height ?? 512,
  };

  const result = await invoke<HttpResult>("http_post", {
    url: `${baseUrl.trim().replace(/\/$/, "")}/sdapi/v1/txt2img`,
    bodyJson: JSON.stringify(payload),
    timeoutMs: 180_000,
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Image generation server responded with HTTP ${result.status}: ${result.body}`);
  }

  let parsed: Txt2ImgResponse;
  try {
    parsed = JSON.parse(result.body) as Txt2ImgResponse;
  } catch {
    throw new Error("Image generation server returned an unparseable response");
  }

  const image = parsed.images?.[0];
  if (!image) throw new Error("Image generation server returned no image");
  return image;
}
