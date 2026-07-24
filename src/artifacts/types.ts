export type ArtifactKind = "markdown" | "text" | "json" | "document" | "image";

export type ArtifactFormat = "md" | "txt" | "json" | "docx" | "png" | "jpg" | "jpeg" | "webp" | "pdf";

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  format: ArtifactFormat;
  title: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  source: "assistant-message" | "image-generation" | "manual";
  createdAt: string;
  updatedAt: string;
  metadata: {
    prompt?: string;
    messageId?: string;
    mimeType?: string;
    wordCount?: number;
  };
}

export interface ArtifactStoreFile {
  version: 1;
  artifacts: ArtifactRecord[];
}

export interface SavedArtifactResult {
  path: string;
  sizeBytes: number;
}
