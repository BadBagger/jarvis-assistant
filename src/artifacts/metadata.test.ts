import { describe, expect, it } from "vitest";
import { artifactFileName, createArtifactRecord, safeArtifactSlug } from "./metadata";

describe("artifact metadata", () => {
  const now = new Date(2026, 6, 23, 12, 34, 56);

  it("creates stable safe file names", () => {
    expect(artifactFileName("Quarterly Plan: v1 / draft", "md", now)).toBe("quarterly-plan-v1-draft-20260723-123456.md");
    expect(artifactFileName("../Secrets", "txt", now)).toBe("secrets-20260723-123456.txt");
    expect(safeArtifactSlug("***")).toBe("jarvis-artifact");
  });

  it("records generated artifact metadata", () => {
    const record = createArtifactRecord({
      id: "artifact-1",
      kind: "markdown",
      title: "Meeting Notes",
      path: "C:/Jarvis/outputs/meeting-notes-20260723-123456.md",
      sizeBytes: 42,
      source: "assistant-message",
      now,
      messageId: "message-1",
      contents: "One two three",
    });

    expect(record).toMatchObject({
      id: "artifact-1",
      kind: "markdown",
      format: "md",
      title: "Meeting Notes",
      fileName: "meeting-notes-20260723-123456.md",
      sizeBytes: 42,
      source: "assistant-message",
      createdAt: now.toISOString(),
      metadata: {
        messageId: "message-1",
        mimeType: "text/markdown",
        wordCount: 3,
      },
    });
  });
});
