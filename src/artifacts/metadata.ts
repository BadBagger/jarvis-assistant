import type { ArtifactFormat, ArtifactKind, ArtifactRecord } from "./types";

const FORMAT_BY_KIND: Record<ArtifactKind, ArtifactFormat> = {
  markdown: "md",
  text: "txt",
  json: "json",
  document: "docx",
  image: "png",
};

const MIME_BY_FORMAT: Record<ArtifactFormat, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function artifactTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export function safeArtifactSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "jarvis-artifact";
}

export function artifactFileName(title: string, format: ArtifactFormat, now: Date): string {
  return `${safeArtifactSlug(title)}-${artifactTimestamp(now)}.${format}`;
}

export function formatForKind(kind: ArtifactKind): ArtifactFormat {
  return FORMAT_BY_KIND[kind];
}

export function mimeForFormat(format: ArtifactFormat): string {
  return MIME_BY_FORMAT[format];
}

export function createArtifactRecord(input: {
  id: string;
  kind: ArtifactKind;
  format?: ArtifactFormat;
  title: string;
  path: string;
  sizeBytes: number;
  source: ArtifactRecord["source"];
  now: Date;
  prompt?: string;
  messageId?: string;
  contents?: string;
}): ArtifactRecord {
  const format = input.format ?? formatForKind(input.kind);
  const fileName = input.path.split(/[\\/]/).pop() ?? artifactFileName(input.title, format, input.now);
  const createdAt = input.now.toISOString();
  return {
    id: input.id,
    kind: input.kind,
    format,
    title: input.title.trim() || "Jarvis artifact",
    fileName,
    path: input.path,
    sizeBytes: input.sizeBytes,
    source: input.source,
    createdAt,
    updatedAt: createdAt,
    metadata: {
      prompt: input.prompt,
      messageId: input.messageId,
      mimeType: mimeForFormat(format),
      wordCount: input.contents ? input.contents.trim().split(/\s+/).filter(Boolean).length : undefined,
    },
  };
}
