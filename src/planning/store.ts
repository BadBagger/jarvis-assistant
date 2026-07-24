import { invoke } from "@tauri-apps/api/core";
import type {
  TaskArtifactKind,
  TaskPlan,
  TaskPlanArtifact,
  TaskPlanNote,
  TaskPlanStatus,
  TaskPlanStep,
  TaskPlanStoreFile,
  TaskStepStatus,
} from "../shared/types";

const STORE_VERSION = 1;
const DEFAULT_PERMISSION_BOUNDARY =
  "Planning only. Jarvis may save app-owned notes, plan records, and generated artifact references locally. External actions, network calls, shell commands, file changes outside app-owned/output folders, sends, deletes, and overwrites require separate user permission.";

async function planPath(): Promise<string> {
  const dir = await invoke<string>("app_data_dir");
  return `${dir}/plans.json`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createNote(content: string): TaskPlanNote {
  return {
    id: crypto.randomUUID(),
    content: content.trim(),
    createdAt: nowIso(),
  };
}

function createStep(title: string, details = ""): TaskPlanStep {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    details: details.trim(),
    status: "todo",
    notes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateStore(raw: unknown): TaskPlanStoreFile {
  if (!raw || typeof raw !== "object") return { version: STORE_VERSION, plans: [] };
  const parsed = raw as Partial<TaskPlanStoreFile>;
  if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.plans)) {
    return { version: STORE_VERSION, plans: [] };
  }

  return {
    version: STORE_VERSION,
    plans: parsed.plans.filter((plan): plan is TaskPlan => {
      return (
        !!plan &&
        typeof plan.id === "string" &&
        typeof plan.title === "string" &&
        typeof plan.goal === "string" &&
        Array.isArray(plan.steps) &&
        Array.isArray(plan.notes) &&
        Array.isArray(plan.artifacts)
      );
    }),
  };
}

export interface CreatePlanInput {
  title: string;
  goal: string;
  steps: Array<{ title: string; details?: string }>;
  note?: string;
}

export interface UpdatePlanInput {
  title?: string;
  goal?: string;
  status?: TaskPlanStatus;
  resultSummary?: string;
  permissionBoundary?: string;
}

export class JsonTaskPlanRepository {
  async list(): Promise<TaskPlan[]> {
    const store = await this.loadStore();
    return [...store.plans].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async create(input: CreatePlanInput): Promise<TaskPlan> {
    const timestamp = nowIso();
    const plan: TaskPlan = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      goal: input.goal.trim(),
      status: "draft",
      permissionBoundary: DEFAULT_PERMISSION_BOUNDARY,
      steps: input.steps.map((step) => createStep(step.title, step.details)),
      notes: input.note?.trim() ? [createNote(input.note)] : [],
      artifacts: [],
      resultSummary: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const store = await this.loadStore();
    store.plans.push(plan);
    await this.saveStore(store);
    return plan;
  }

  async update(id: string, input: UpdatePlanInput): Promise<TaskPlan> {
    return this.patchPlan(id, (plan) => ({
      ...plan,
      ...input,
      title: input.title === undefined ? plan.title : input.title.trim(),
      goal: input.goal === undefined ? plan.goal : input.goal.trim(),
      resultSummary: input.resultSummary === undefined ? plan.resultSummary : input.resultSummary.trim(),
      permissionBoundary: input.permissionBoundary === undefined ? plan.permissionBoundary : input.permissionBoundary.trim(),
      updatedAt: nowIso(),
    }));
  }

  async delete(id: string): Promise<void> {
    const store = await this.loadStore();
    const plans = store.plans.filter((plan) => plan.id !== id);
    if (plans.length === store.plans.length) return;
    await this.saveStore({ ...store, plans });
  }

  async addStep(planId: string, title: string, details = ""): Promise<TaskPlan> {
    return this.patchPlan(planId, (plan) => ({
      ...plan,
      steps: [...plan.steps, createStep(title, details)],
      updatedAt: nowIso(),
    }));
  }

  async updateStep(planId: string, stepId: string, patch: { title?: string; details?: string; status?: TaskStepStatus }): Promise<TaskPlan> {
    return this.patchPlan(planId, (plan) => ({
      ...plan,
      steps: plan.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              ...patch,
              title: patch.title === undefined ? step.title : patch.title.trim(),
              details: patch.details === undefined ? step.details : patch.details.trim(),
              updatedAt: nowIso(),
            }
          : step,
      ),
      updatedAt: nowIso(),
    }));
  }

  async addNote(planId: string, content: string, stepId?: string): Promise<TaskPlan> {
    const note = createNote(content);
    return this.patchPlan(planId, (plan) => {
      if (!stepId) {
        return { ...plan, notes: [note, ...plan.notes], updatedAt: nowIso() };
      }
      return {
        ...plan,
        steps: plan.steps.map((step) =>
          step.id === stepId ? { ...step, notes: [note, ...step.notes], updatedAt: nowIso() } : step,
        ),
        updatedAt: nowIso(),
      };
    });
  }

  async addArtifact(planId: string, input: { title: string; kind: TaskArtifactKind; path: string; summary: string }): Promise<TaskPlan> {
    const artifact: TaskPlanArtifact = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      kind: input.kind,
      path: input.path.trim(),
      summary: input.summary.trim(),
      createdAt: nowIso(),
    };
    return this.patchPlan(planId, (plan) => ({
      ...plan,
      artifacts: [artifact, ...plan.artifacts],
      updatedAt: nowIso(),
    }));
  }

  private async patchPlan(id: string, update: (plan: TaskPlan) => TaskPlan): Promise<TaskPlan> {
    const store = await this.loadStore();
    const index = store.plans.findIndex((plan) => plan.id === id);
    if (index < 0) throw new Error(`Task plan not found: ${id}`);
    const updated = update(store.plans[index]);
    store.plans[index] = updated;
    await this.saveStore(store);
    return updated;
  }

  private async loadStore(): Promise<TaskPlanStoreFile> {
    const path = await planPath();
    const raw = await invoke<string | null>("read_text_file", { path });
    if (!raw) return { version: STORE_VERSION, plans: [] };
    try {
      return validateStore(JSON.parse(raw));
    } catch {
      return { version: STORE_VERSION, plans: [] };
    }
  }

  private async saveStore(store: TaskPlanStoreFile): Promise<void> {
    const path = await planPath();
    await invoke("write_text_file", { path, contents: JSON.stringify(store, null, 2) });
  }
}

export const taskPlanRepository = new JsonTaskPlanRepository();
