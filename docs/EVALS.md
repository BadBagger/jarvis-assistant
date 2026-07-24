# Jarvis Assistant Evals

Jarvis has an offline eval harness in `evals/` for deterministic regression checks. It does not require Ollama, AUTOMATIC1111, Tauri, or network access.

## Coverage

- `chat_quality`: concise, local-first, clarification-first response contracts.
- `coding_help`: grounded diagnosis, narrow patching, and preserving local edits.
- `vision_prompt_handling`: image bytes stay separate from prompts, visible content is not guessed, and screenshots are treated as inspection.
- `image_generation_request_shaping`: bounded `/imagine` payloads, allowed dimensions, step limits, and safer prompt shaping.
- `memory_retrieval`: title/tag ranking, type filtering, recency, confidence, global preferences, and project privacy boundaries.
- `tool_permission_decisions`: approval gates for reversible-write, external-network, and dangerous tools, plus dry-run audit status.
- `hallucination_checks`: responses must admit missing evidence, missing command output, missing documents, and stale routing context.
- `model_routing_choices`: deterministic route selection for chat, coding, vision, image generation, embeddings, and unavailable routes.

## Windows Commands

Run evals only:

```powershell
npm.cmd run eval
```

Run the normal local verification set:

```powershell
npm.cmd run eval
npm.cmd run build
npm.cmd test
Set-Location src-tauri
cargo test
Set-Location ..
```

If PowerShell blocks npm scripts, keep using `npm.cmd` as shown above.

## Exit Behavior

The runner prints one line per case and then a suite summary. It exits nonzero only when a deterministic check fails.

`mode: "model_scored"` fixtures may still be added for future model-based judgment, but model scoring is currently skipped by `evals/adapters/modelScorer.mjs`. Skipped or errored model scoring is reported as non-gating so offline CI and local Windows runs remain deterministic.

## Adding Cases

Add `.json` or `.jsonl` files under `evals/cases/`. Each case must include:

```json
{
  "id": "stable-case-id",
  "suite": "suite_name",
  "mode": "deterministic",
  "task": "What this case protects",
  "input": {},
  "deterministic_expectations": {}
}
```

Prefer deterministic fixtures with explicit `candidate_response`, route metadata, or shaped payload expectations. Use `mode: "model_scored"` only when deterministic checks cannot express the quality bar.
