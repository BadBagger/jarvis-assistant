# Jarvis Assistant Evals

Jarvis has a small eval harness in `evals/` for regression checks that do not require Ollama, AUTOMATIC1111, Tauri, or network access.

## What It Covers

- `chat_quality`: model-scored fixtures for concise, local-first assistant behavior.
- `coding_help`: model-scored fixtures for grounded coding help.
- `vision_prompt_handling`: deterministic prompt and image payload checks, plus a model-scored visibility case.
- `image_generation_request_shaping`: deterministic checks for shaped `/imagine` payloads.
- `memory_retrieval`: deterministic retrieval checks using the same keyword, title, tag, type-filter, and recency scoring shape as the app memory store.
- `hallucination_checks`: deterministic response fixtures that must admit missing evidence.
- `tool_permission_decisions`: deterministic checks for read-only, reversible-write, external-network, and dangerous tool policy.

## Run

```powershell
npm.cmd run eval
```

For a normal verification pass:

```powershell
npm.cmd run build
npm.cmd run eval
```

The current harness prints one line per case and exits non-zero if any deterministic check fails.

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

Use `mode: "model_scored"` when the fixture needs a model quality judgment later. Model-scored cases still run deterministic schema checks now, then report the model score as skipped.

## Model Scorer Adapter

`evals/adapters/modelScorer.mjs` is intentionally a no-op adapter. A future scorer should keep the same `score(testCase)` method and return a structured result such as:

```json
{
  "status": "scored",
  "score": 4,
  "reason": "Meets the local-first and groundedness rubric."
}
```

Keep model scoring separate from deterministic checks so CI can continue running the harness offline.
