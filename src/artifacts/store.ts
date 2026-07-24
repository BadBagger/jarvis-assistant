import { invoke } from "@tauri-apps/api/core";
import { describeError } from "../shared/errors";
import { appDataFilePath, readJsonFile, writeJsonFile } from "../shared/persistence";
import { toolAuditSink } from "../tools/audit";
import type { ToolAuditRecord } from "../tools/types";
import { artifactFileName, createArtifactRecord, formatForKind } from "./metadata";
import type { ArtifactFormat, ArtifactKind, ArtifactRecord, ArtifactStoreFile, SavedArtifactResult } from "./types";

const STORE_FILE = "artifacts.json";

async function artifactStorePath(): Promise<string> {
  return appDataFilePath(STORE_FILE);
}

function emptyStore(): ArtifactStoreFile {
  return { version: 1, artifacts: [] };
}

function audit(record: Omit<ToolAuditRecord, "id" | "requestedAt"> & { requestedAt?: string }) {
  return toolAuditSink.append({
    id: `audit-${crypto.randomUUID()}`,
    requestedAt: record.requestedAt ?? new Date().toISOString(),
    ...record,
  });
}

export class ArtifactRepository {
  async list(): Promise<ArtifactRecord[]> {
    const store = await readJsonFile<ArtifactStoreFile>(await artifactStorePath(), emptyStore());
    return [...store.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async append(record: ArtifactRecord): Promise<void> {
    const store = await readJsonFile<ArtifactStoreFile>(await artifactStorePath(), emptyStore());
    await writeJsonFile(await artifactStorePath(), {
      version: 1,
      artifacts: [record, ...store.artifacts.filter((artifact) => artifact.id !== record.id)].slice(0, 500),
    });
  }

  async validateOutputFolder(outputDir: string): Promise<string> {
    return invoke<string>("validate_output_folder", { outputDir });
  }

  async saveTextArtifact(input: {
    outputDir: string;
    kind: Extract<ArtifactKind, "markdown" | "text" | "json">;
    title: string;
    contents: string;
    source: ArtifactRecord["source"];
    messageId?: string;
    prompt?: string;
    now?: Date;
  }): Promise<ArtifactRecord> {
    const now = input.now ?? new Date();
    const format = formatForKind(input.kind);
    const fileName = artifactFileName(input.title, format, now);
    const requestedAt = now.toISOString();
    try {
      const result = await invoke<SavedArtifactResult>("save_artifact_text", {
        outputDir: input.outputDir,
        fileName,
        contents: input.contents,
      });
      const record = createArtifactRecord({
        id: crypto.randomUUID(),
        kind: input.kind,
        format,
        title: input.title,
        path: result.path,
        sizeBytes: result.sizeBytes,
        source: input.source,
        now,
        prompt: input.prompt,
        messageId: input.messageId,
        contents: input.contents,
      });
      await this.append(record);
      await audit({
        toolId: "artifact.saveText",
        toolTitle: "Save text artifact",
        permissionLevel: "reversible-write",
        status: "completed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: `${input.kind} artifact: ${fileName}`,
        resultSummary: `Saved ${record.fileName}`,
      });
      return record;
    } catch (error) {
      await audit({
        toolId: "artifact.saveText",
        toolTitle: "Save text artifact",
        permissionLevel: "reversible-write",
        status: "failed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: `${input.kind} artifact: ${fileName}`,
        error: describeError(error),
      });
      throw error;
    }
  }

  async saveBinaryArtifact(input: {
    outputDir: string;
    kind: Extract<ArtifactKind, "document" | "image">;
    format?: ArtifactFormat;
    title: string;
    base64Data: string;
    source: ArtifactRecord["source"];
    messageId?: string;
    prompt?: string;
    now?: Date;
  }): Promise<ArtifactRecord> {
    const now = input.now ?? new Date();
    const format = input.format ?? formatForKind(input.kind);
    const fileName = artifactFileName(input.title, format, now);
    const requestedAt = now.toISOString();
    try {
      const result = await invoke<SavedArtifactResult>("save_artifact_binary", {
        outputDir: input.outputDir,
        fileName,
        base64Data: input.base64Data,
      });
      const record = createArtifactRecord({
        id: crypto.randomUUID(),
        kind: input.kind,
        format,
        title: input.title,
        path: result.path,
        sizeBytes: result.sizeBytes,
        source: input.source,
        now,
        prompt: input.prompt,
        messageId: input.messageId,
      });
      await this.append(record);
      await audit({
        toolId: "artifact.saveBinary",
        toolTitle: "Save binary artifact",
        permissionLevel: "reversible-write",
        status: "completed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: `${input.kind} artifact: ${fileName}`,
        resultSummary: `Saved ${record.fileName}`,
      });
      return record;
    } catch (error) {
      await audit({
        toolId: "artifact.saveBinary",
        toolTitle: "Save binary artifact",
        permissionLevel: "reversible-write",
        status: "failed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: `${input.kind} artifact: ${fileName}`,
        error: describeError(error),
      });
      throw error;
    }
  }

  async revealInFolder(outputDir: string, record: Pick<ArtifactRecord, "path" | "fileName">): Promise<void> {
    const requestedAt = new Date().toISOString();
    try {
      await invoke("reveal_artifact_in_folder", { outputDir, artifactPathValue: record.path });
      await audit({
        toolId: "artifact.revealInFolder",
        toolTitle: "Open artifact folder",
        permissionLevel: "read-only",
        status: "completed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: record.fileName,
        resultSummary: "Opened containing folder",
      });
    } catch (error) {
      await audit({
        toolId: "artifact.revealInFolder",
        toolTitle: "Open artifact folder",
        permissionLevel: "read-only",
        status: "failed",
        actor: "user",
        dryRun: false,
        requestedAt,
        completedAt: new Date().toISOString(),
        inputSummary: record.fileName,
        error: describeError(error),
      });
      throw error;
    }
  }
}

export const artifactRepository = new ArtifactRepository();
