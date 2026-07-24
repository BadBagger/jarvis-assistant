import { Automatic1111Provider } from "../models/providers";

export interface ImageGenOptions {
  steps?: number;
  width?: number;
  height?: number;
  negativePrompt?: string;
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
  const provider = new Automatic1111Provider();
  const result = await provider.generateImage({
    model: {
      id: "automatic1111:compat",
      provider: "automatic1111",
      label: "Stable Diffusion WebUI image generation",
      baseUrl,
      capabilities: ["image-generation", "local-only"],
      local: true,
      requiresNetwork: false,
      privacyLevel: "local-only",
      enabled: true,
    },
    prompt,
    options,
  });
  return result.imageBase64;
}
