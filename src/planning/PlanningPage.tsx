import { useEffect, useMemo, useState } from "react";
import { taskPlanRepository } from "./store";
import type { TaskArtifactKind, TaskPlan, TaskPlanStatus, TaskStepStatus } from "../shared/types";

const PLAN_STATUSES: Array<{ value: TaskPlanStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "in-progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
];

const STEP_STATUSES: Array<{ value: TaskStepStatus; label: string }> = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const ARTIFACT_KINDS: Array<{ value: TaskArtifactKind; label: string }> = [
  { value: "note", label: "Note" },
  { value: "markdown", label: "Markdown" },
  { value: "document", label: "Document" },
  { value: "image", label: "Image" },
  { value: "code", label: "Code" },
  { value: "other", label: "Other" },
];

const DEFAULT_STEPS = "Clarify request\nInspect local context\nMake bounded changes\nVerify result\nRecord handoff";

export function PlanningPage() {
  const [plans, setPlans] = useState<TaskPlan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [stepsText, setStepsText] = useState(DEFAULT_STEPS);
  const [noteText, setNoteText] = useState("");
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepDetails, setNewStepDetails] = useState("");
  const [newNote, setNewNote] = useState("");
  const [artifact, setArtifact] = useState({ title: "", kind: "note" as TaskArtifactKind, path: "", summary: "" });
  const [status, setStatus] = useState<string | null>(null);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null, [plans, selectedId]);

  useEffect(() => {
    void refreshPlans();
  }, []);

  useEffect(() => {
    if (!selectedId && plans[0]) setSelectedId(plans[0].id);
  }, [plans, selectedId]);

  async function refreshPlans(nextSelectedId?: string) {
    const nextPlans = await taskPlanRepository.list();
    setPlans(nextPlans);
    if (nextSelectedId) setSelectedId(nextSelectedId);
  }

  async function createPlan() {
    const cleanTitle = title.trim();
    const cleanGoal = goal.trim();
    const steps = stepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ title: line }));

    if (!cleanTitle || !cleanGoal || steps.length === 0) {
      setStatus("Title, goal, and at least one step are required.");
      return;
    }

    const plan = await taskPlanRepository.create({ title: cleanTitle, goal: cleanGoal, steps, note: noteText });
    setTitle("");
    setGoal("");
    setStepsText(DEFAULT_STEPS);
    setNoteText("");
    setStatus("Plan saved locally.");
    await refreshPlans(plan.id);
  }

  async function updatePlan(patch: Partial<Pick<TaskPlan, "title" | "goal" | "status" | "resultSummary">>) {
    if (!selectedPlan) return;
    await taskPlanRepository.update(selectedPlan.id, patch);
    setStatus("Plan updated.");
    await refreshPlans(selectedPlan.id);
  }

  async function addStep() {
    if (!selectedPlan || !newStepTitle.trim()) return;
    await taskPlanRepository.addStep(selectedPlan.id, newStepTitle, newStepDetails);
    setNewStepTitle("");
    setNewStepDetails("");
    setStatus("Step added.");
    await refreshPlans(selectedPlan.id);
  }

  async function addPlanNote() {
    if (!selectedPlan || !newNote.trim()) return;
    await taskPlanRepository.addNote(selectedPlan.id, newNote);
    setNewNote("");
    setStatus("Note saved.");
    await refreshPlans(selectedPlan.id);
  }

  async function addArtifact() {
    if (!selectedPlan || !artifact.title.trim() || !artifact.path.trim()) {
      setStatus("Artifact title and local path are required.");
      return;
    }
    await taskPlanRepository.addArtifact(selectedPlan.id, artifact);
    setArtifact({ title: "", kind: "note", path: "", summary: "" });
    setStatus("Artifact reference saved.");
    await refreshPlans(selectedPlan.id);
  }

  async function deletePlan(plan: TaskPlan) {
    await taskPlanRepository.delete(plan.id);
    setStatus("Plan deleted.");
    setSelectedId(null);
    await refreshPlans();
  }

  return (
    <div className="planning-page">
      <aside className="planning-sidebar">
        <section className="planning-panel">
          <h2>Create plan</h2>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Release prep" />
          </label>
          <label>
            Goal
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should Jarvis help plan?" />
          </label>
          <label>
            Steps
            <textarea value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
          </label>
          <label>
            Starting note
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Constraints, assumptions, or requested boundaries" />
          </label>
          <button onClick={() => void createPlan()}>Save plan</button>
          {status && <p className="planning-status">{status}</p>}
        </section>

        <section className="planning-list">
          {plans.length === 0 ? (
            <p className="planning-empty">No task plans saved yet.</p>
          ) : (
            plans.map((plan) => (
              <button key={plan.id} className={selectedPlan?.id === plan.id ? "active" : ""} onClick={() => setSelectedId(plan.id)}>
                <strong>{plan.title}</strong>
                <span>{PLAN_STATUSES.find((statusOption) => statusOption.value === plan.status)?.label}</span>
              </button>
            ))
          )}
        </section>
      </aside>

      <section className="planning-detail">
        {!selectedPlan ? (
          <p className="planning-empty">Create a plan to start tracking assistant work.</p>
        ) : (
          <>
            <div className="planning-detail__header">
              <div>
                <p className="planning-kicker">Local task workspace</p>
                <input
                  className="planning-title-input"
                  value={selectedPlan.title}
                  onChange={(e) => void updatePlan({ title: e.target.value })}
                />
              </div>
              <div className="planning-detail__actions">
                <select value={selectedPlan.status} onChange={(e) => void updatePlan({ status: e.target.value as TaskPlanStatus })}>
                  {PLAN_STATUSES.map((planStatus) => (
                    <option key={planStatus.value} value={planStatus.value}>
                      {planStatus.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => void deletePlan(selectedPlan)}>Delete</button>
              </div>
            </div>

            <label className="planning-wide-label">
              Goal
              <textarea value={selectedPlan.goal} onChange={(e) => void updatePlan({ goal: e.target.value })} />
            </label>

            <p className="planning-boundary">{selectedPlan.permissionBoundary}</p>

            <div className="planning-grid">
              <section className="planning-panel planning-panel--wide">
                <h3>Steps</h3>
                <div className="planning-steps">
                  {selectedPlan.steps.map((step, index) => (
                    <article key={step.id} className={`planning-step planning-step--${step.status}`}>
                      <div className="planning-step__header">
                        <span>{index + 1}</span>
                        <input
                          value={step.title}
                          onChange={(e) => void taskPlanRepository.updateStep(selectedPlan.id, step.id, { title: e.target.value }).then(() => refreshPlans(selectedPlan.id))}
                        />
                        <select
                          value={step.status}
                          onChange={(e) =>
                            void taskPlanRepository
                              .updateStep(selectedPlan.id, step.id, { status: e.target.value as TaskStepStatus })
                              .then(() => refreshPlans(selectedPlan.id))
                          }
                        >
                          {STEP_STATUSES.map((stepStatus) => (
                            <option key={stepStatus.value} value={stepStatus.value}>
                              {stepStatus.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={step.details}
                        onChange={(e) => void taskPlanRepository.updateStep(selectedPlan.id, step.id, { details: e.target.value }).then(() => refreshPlans(selectedPlan.id))}
                        placeholder="Step details, verification, or blocker notes"
                      />
                      {step.notes.length > 0 && (
                        <ul>
                          {step.notes.map((note) => (
                            <li key={note.id}>{note.content}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                </div>
                <div className="planning-add-row">
                  <input value={newStepTitle} onChange={(e) => setNewStepTitle(e.target.value)} placeholder="Add a step" />
                  <input value={newStepDetails} onChange={(e) => setNewStepDetails(e.target.value)} placeholder="Details" />
                  <button onClick={() => void addStep()} disabled={!newStepTitle.trim()}>
                    Add
                  </button>
                </div>
              </section>

              <section className="planning-panel">
                <h3>Notes</h3>
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Progress notes, decisions, or permission records" />
                <button onClick={() => void addPlanNote()} disabled={!newNote.trim()}>
                  Save note
                </button>
                <div className="planning-note-list">
                  {selectedPlan.notes.map((note) => (
                    <p key={note.id}>{note.content}</p>
                  ))}
                </div>
              </section>

              <section className="planning-panel">
                <h3>Generated artifacts</h3>
                <input value={artifact.title} onChange={(e) => setArtifact((prev) => ({ ...prev, title: e.target.value }))} placeholder="Artifact title" />
                <select value={artifact.kind} onChange={(e) => setArtifact((prev) => ({ ...prev, kind: e.target.value as TaskArtifactKind }))}>
                  {ARTIFACT_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
                <input value={artifact.path} onChange={(e) => setArtifact((prev) => ({ ...prev, path: e.target.value }))} placeholder="Local path" />
                <textarea value={artifact.summary} onChange={(e) => setArtifact((prev) => ({ ...prev, summary: e.target.value }))} placeholder="What was generated?" />
                <button onClick={() => void addArtifact()}>Save artifact</button>
                <div className="planning-artifact-list">
                  {selectedPlan.artifacts.map((item) => (
                    <article key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.kind}</span>
                      <p>{item.summary || item.path}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <label className="planning-wide-label">
              Result summary
              <textarea value={selectedPlan.resultSummary} onChange={(e) => void updatePlan({ resultSummary: e.target.value })} placeholder="Final outcome, local files saved, and verification notes" />
            </label>
          </>
        )}
      </section>
    </div>
  );
}
