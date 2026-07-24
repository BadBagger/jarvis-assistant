# Fine-tuning Jarvis's chat model

This folder is the "actually trained, not just prompted" path for Jarvis:
LoRA/QLoRA fine-tuning of an open-weight chat model on your own conversation
data, followed by merge, GGUF conversion, and Ollama import.

The desktop app does not train models. It talks to Ollama by model name. After
you export a tuned model to Ollama, point Jarvis Settings at that model name.

## Hardware target

Use a local Windows machine with an NVIDIA GPU.

Recommended starting points:

| GPU VRAM | Practical target |
| --- | --- |
| 8 GB | 1.5B-3B instruct model, 4-bit QLoRA, short context |
| 12 GB | 3B-7B instruct model, 4-bit QLoRA |
| 16-24 GB | 7B instruct model with longer context or larger batches |

CPU-only training is useful for syntax and smoke tests, but it is not practical
for a real run.

## When to fine-tune

Fine-tuning is best for:

- consistent voice, tone, formatting, and response structure
- repeated workflows with stable input/output patterns
- approval/refusal behavior you want the model to internalize
- short task examples where the ideal answer is known

Use RAG or Jarvis memory instead when the model needs:

- private facts that change, such as contacts, appointments, projects, or device state
- long documents, notes, PDFs, codebases, email threads, or knowledge bases
- source-grounded answers with citations
- information you may want to edit or delete later

Do not fine-tune private facts into the model just because they are useful.
If the data should be inspectable, revocable, or current, store it in memory or
retrieve it at answer time.

## Safety boundaries

Do not train on:

- passwords, API keys, tokens, cookies, private keys, recovery phrases, or `.env` files
- raw financial, medical, legal, government ID, or employment records
- other people's private messages unless you have clear permission and a reason
- copyrighted books/articles/manuals copied wholesale
- chat logs that contain accidental secrets or unreviewed attachments
- examples where the assistant takes irreversible actions without user approval
- tool outputs that include unsafe commands, destructive file operations, or credential leaks

Prefer training on approved, edited examples. Keep a raw archive outside this
repo if needed, but only place cleaned `.raw.jsonl` files under `finetune/data/`.

## Environment setup on Windows

From `finetune/`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If PowerShell script execution blocks activation, use:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Check CUDA visibility before training:

```powershell
nvidia-smi
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
```

## Dataset schema

Each JSONL line is one conversation:

```json
{"messages":[{"role":"system","content":"You are Jarvis, a helpful local assistant."},{"role":"user","content":"Draft a short reminder to submit mileage."},{"role":"assistant","content":"Submit mileage by Friday. Include the trip date, destination, purpose, and receipt photo if you have one."}],"source":"handwritten-example","tags":["reminders","style"],"quality":"gold"}
```

Required:

- `messages`: non-empty list of chat messages
- every message has `role` and `content`
- allowed roles are `system`, `user`, and `assistant`
- the final message must be `assistant`, because that is the target response

Optional:

- `source`: short note about where the example came from
- `tags`: list of lowercase-ish labels for review and filtering
- `quality`: `gold`, `silver`, or `draft`
- `notes`: reviewer comments that will be carried through the split files

See `dataset.schema.json` for a machine-readable schema and
`data/example_conversations.jsonl` for practical examples.

`prepare_data.py` enforces the same schema shape before it writes train/val
files. It rejects unknown fields, empty content, assistant-first records, and
records whose final message is not an assistant target. It also emits warnings
for common secret-looking strings; warnings are not a sanitizer, so review the
raw data yourself before committing or training on it.

Good fine-tuning records look like edited target behavior, not raw transcripts:

```json
{"messages":[{"role":"system","content":"You are Jarvis, a helpful local assistant. Ask before external actions."},{"role":"user","content":"Send a text that I am running 10 minutes late."},{"role":"assistant","content":"I can draft it, but I need your approval before sending: \"Running about 10 minutes late. I will update you if that changes.\""}],"source":"handwritten-approval-example","tags":["approval","messaging"],"quality":"gold"}
```

Avoid records that only teach facts:

```json
{"messages":[{"role":"user","content":"My garage code is 1234. Remember it."},{"role":"assistant","content":"Stored."}],"source":"bad-example","quality":"draft"}
```

That belongs in neither fine-tuning nor memory as written. Remove the secret and
keep only the durable behavior: Jarvis should refuse to store sensitive codes.

## Data cleaning and dedup

Before splitting, review the raw data manually:

1. Remove secrets, personal records, and unapproved third-party content.
2. Rewrite low-quality assistant answers into the answer you actually want.
3. Keep examples focused. One durable behavior per record is usually better than a long wandering chat.
4. Remove stale facts. Put those in Jarvis memory/RAG instead.
5. Balance the dataset. Do not make 90% of examples one task unless that is the only task you care about.
6. Include negative/guardrail examples where Jarvis asks for confirmation before actions.

`prepare_data.py` does lightweight cleaning by default:

- trims and collapses whitespace inside message content
- rejects unknown fields so schema drift is visible
- validates every record against the Jarvis conversation contract
- warns on common secret patterns so you can stop and scrub the source data
- removes duplicate conversations using normalized, case-insensitive message text
- shuffles with a fixed seed before splitting
- checks that no normalized duplicate appears in both train and validation
- can enforce minimum train/validation counts with `--min-train` and `--min-val`

Run it:

```powershell
python prepare_data.py .\data\my_conversations.raw.jsonl --val-fraction 0.1 --seed 42
```

Outputs:

- `data/train.jsonl`
- `data/val.jsonl`

Useful options:

```powershell
python prepare_data.py .\data\my_conversations.raw.jsonl --out-dir .\data --val-fraction 0.15
python prepare_data.py .\data\my_conversations.raw.jsonl --val-fraction 0.15 --min-train 100 --min-val 20
python prepare_data.py .\data\my_conversations.raw.jsonl --no-clean
python prepare_data.py .\data\my_conversations.raw.jsonl --no-dedupe
python prepare_data.py .\data\my_conversations.raw.jsonl --val-fraction 0
```

For small datasets, use at least 20-30 examples before trusting validation
loss. The script keeps at least one training record when validation is enabled.
If `--no-dedupe` is used, split-leakage checks still fail when the same
normalized conversation lands in both train and validation.

## Configure LoRA/QLoRA

Copy the example config:

```powershell
Copy-Item .\config.example.yaml .\config.yaml
```

Start conservative:

- `base_model`: use an instruct model that already follows chat templates well.
  `Qwen/Qwen2.5-7B-Instruct` is the default; use `Qwen/Qwen2.5-3B-Instruct`
  when VRAM is tight.
- `max_seq_length`: 1024-2048 for first runs. Increase only if your examples
  really need longer context.
- `r`: 8 or 16 for style/task tuning. Try 32 only after you have enough data.
- `alpha`: usually 2x `r`.
- `dropout`: 0.03-0.1. Keep some dropout for small datasets.
- `target_modules`: the provided Qwen module list is a normal full-attention
  plus MLP target set. For other model families, confirm module names first.
- `learning_rate`: `2.0e-4` is a reasonable QLoRA start. Lower it if outputs
  become unstable or overfit.
- `num_train_epochs`: 1-3 for small/medium datasets. More epochs are not a
  substitute for better examples.
- `bf16`: true for Ampere/Ada/Lovelace-class NVIDIA GPUs. For older cards, set
  `bf16: false` and `fp16: true`.

Run the guardrail check before training:

```powershell
python check_config.py --config .\config.yaml
```

The check does not load the model or touch the GPU. It fails early for risky or
accidental settings such as extreme LoRA rank, both `bf16` and `fp16` enabled,
oversized batches, invalid sequence lengths, or more than five local prep
epochs. Treat warnings as deliberate experiments, not defaults.

If you hit out-of-memory errors:

1. use a smaller base model
2. lower `max_seq_length`
3. keep `per_device_train_batch_size: 1`
4. increase `gradient_accumulation_steps` instead of batch size
5. keep `quantization.load_in_4bit: true`

## Train

```powershell
python train.py --config .\config.yaml
```

The adapter is saved to `output_dir`, defaulting to `./output/jarvis-lora`.

Watch for:

- training loss decreasing without validation loss exploding
- outputs becoming more consistent in the target format
- the model copying exact training examples too often, which means overfit

## Merge the adapter

```powershell
python merge_and_export.py --base Qwen/Qwen2.5-7B-Instruct --adapter .\output\jarvis-lora --out .\output\jarvis-merged
```

The base model must match the model used in `config.yaml`.

Merging can need substantial system RAM because it loads the base model on CPU.
Close memory-heavy apps first.

## Convert to GGUF and import into Ollama

Clone llama.cpp beside this repo or somewhere stable:

```powershell
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
python -m pip install -r requirements.txt
python .\convert_hf_to_gguf.py ..\jarvis-assistant\finetune\output\jarvis-merged --outfile ..\jarvis-assistant\finetune\output\jarvis.gguf --outtype q4_k_m
```

Create `finetune/output/Modelfile`:

```text
FROM ./jarvis.gguf
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
{{ end }}{{ .Response }}"""
PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 2048
```

Register it:

```powershell
cd ..\jarvis-assistant\finetune\output
ollama create jarvis-custom -f .\Modelfile
ollama run jarvis-custom
```

Then open Jarvis Assistant -> Settings -> set Chat model to `jarvis-custom`.

Keep the Ollama model name versioned when comparing adapters, for example
`jarvis-custom-v1`, `jarvis-custom-v2`, and keep the previous model installed
until evals show the new one is better. Match `PARAMETER num_ctx` to the
sequence length you actually trained for; a much larger context window does not
make the adapter understand long examples it never saw.

## Lightweight checks

These checks are safe on a CPU-only machine and do not start training:

```powershell
python -m compileall finetune
python -m unittest finetune.test_validation
python prepare_data.py .\data\example_conversations.jsonl --out-dir .\output\prep-check --val-fraction 0.2 --seed 42 --min-train 4 --min-val 1
python check_config.py --config .\config.example.yaml
```

Use them before every real training run and again before committing fine-tuning
workflow changes.

## Iteration loop

1. Train a small adapter.
2. Chat with it in Jarvis and save failures.
3. Turn failures into corrected `gold` examples.
4. Re-run `prepare_data.py` with the same seed.
5. Retrain and compare against the previous model.

A few dozen carefully edited examples usually beat hundreds of noisy logs.
