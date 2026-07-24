import { describe, expect, it } from "vitest";
import { approvalLabel, summarizeArtifacts } from "./AssistantWorkspace";
import type { DirectoryEntry, ToolPermissionLevel } from "../tools";

describe("AssistantWorkspace summaries", () => {
  it("groups output folder entries by artifact type", () => {
    const entries: DirectoryEntry[] = [
      { name: "scan.png", path: "C:/Jarvis/scan.png", isDir: false, sizeBytes: 1200 },
      { name: "brief.DOCX", path: "C:/Jarvis/brief.DOCX", isDir: false, sizeBytes: 2400 },
      { name: "project", path: "C:/Jarvis/project", isDir: true },
      { name: "archive.zip", path: "C:/Jarvis/archive.zip", isDir: false, sizeBytes: 500 },
    ];

    expect(summarizeArtifacts(entries)).toEqual({
      images: 1,
      documents: 1,
      folders: 1,
      other: 1,
    });
  });

  it("keeps approval labels conservative for non-read-only tools", () => {
    const levels: ToolPermissionLevel[] = ["read-only", "reversible-write", "external-network", "dangerous"];

    expect(levels.map(approvalLabel)).toEqual(["Auto-read", "Approval", "Approval", "Blocked"]);
  });
});
