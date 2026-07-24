export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function actionableError(context: string, error: unknown, hint?: string): string {
  const detail = describeError(error);
  return hint ? `${context}: ${detail}. ${hint}` : `${context}: ${detail}`;
}

export function validateBaseUrl(label: string, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error(`${label} is blank`);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid http:// or https:// URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
  if (!isLocalhost) {
    throw new Error(`${label} must point to localhost, 127.0.0.1, or [::1]`);
  }

  return trimmed;
}
