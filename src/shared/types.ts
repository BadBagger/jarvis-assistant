export interface Settings {
  version: 1;
  /** Base URL of a local Ollama server, e.g. http://localhost:11434 */
  ollamaBaseUrl: string;
  /** Ollama model used for plain chat, e.g. llama3.1 */
  chatModel: string;
  /** Ollama vision-capable model used for image scanning, e.g. llava */
  visionModel: string;
  /** Base URL of a local Stable Diffusion WebUI-compatible server (AUTOMATIC1111 or ComfyUI-with-A1111-API-shim), e.g. http://127.0.0.1:7860 */
  imageGenBaseUrl: string;
  /** Folder generated images/documents are saved into */
  outputDir: string;
}

export type ChatRole = "user" | "assistant";
export type ChatMessageKind = "text" | "image-scan" | "image-gen" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind: ChatMessageKind;
  content: string;
  /** Data URL of an image the user attached (image-scan messages) */
  attachedImageDataUrl?: string;
  /** Base64 PNG bytes of an assistant-generated image (image-gen messages), no data: prefix */
  generatedImageBase64?: string;
  /** True while an assistant reply is still streaming in */
  pending?: boolean;
  /** Set after a "save as document"/"save image" action completes */
  savedTo?: string;
}

export type TaskPlanStatus = "draft" | "ready" | "in-progress" | "blocked" | "completed";
export type TaskStepStatus = "todo" | "doing" | "blocked" | "done";
export type TaskArtifactKind = "note" | "markdown" | "document" | "image" | "code" | "other";

export interface TaskPlanNote {
  id: string;
  content: string;
  createdAt: string;
}

export interface TaskPlanStep {
  id: string;
  title: string;
  details: string;
  status: TaskStepStatus;
  notes: TaskPlanNote[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanArtifact {
  id: string;
  title: string;
  kind: TaskArtifactKind;
  path: string;
  summary: string;
  createdAt: string;
}

export interface TaskPlan {
  id: string;
  title: string;
  goal: string;
  status: TaskPlanStatus;
  permissionBoundary: string;
  steps: TaskPlanStep[];
  notes: TaskPlanNote[];
  artifacts: TaskPlanArtifact[];
  resultSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanStoreFile {
  version: 1;
  plans: TaskPlan[];
}
