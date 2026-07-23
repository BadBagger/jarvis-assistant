# Fine-tuning Jarvis's chat model

This is the "actually trained, not just prompted" path: LoRA/QLoRA
fine-tuning of an open-weight chat model on your own conversation data,
producing a real custom model file. It's a separate Python workflow from
the desktop app in `../src` — the two connect at the end, when you point
the app's Settings at the model you've trained.

**This needs an NVIDIA GPU with real VRAM.** 8GB+ for a 3B model, 12GB+ for
7B, using 4-bit QLoRA. CPU-only training works but is orders of magnitude
slower — fine for verifying the pipeline runs, not for a real training run.
None of this runs in a cloud dev sandbox; do it on your own machine.

## What this is (and isn't)

Fine-tuning adapts an existing pretrained model's behavior/style/knowledge
using LoRA adapters — small, efficiently-trained weight deltas layered on
top of the frozen base model. It is **not** training a foundation model
from scratch (that needs institutional-scale compute) — it's how virtually
all "custom" open models are actually made, and it's a legitimate, real
training process that produces a genuinely different model.

## Steps

### 0. Set up the environment

```
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 1. Write your training data

Create a JSONL file (one conversation per line) in the chat format shown in
`data/example_conversations.jsonl`:

```json
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

The last message in every conversation must be from `assistant` — that's
what the model learns to produce. More real examples (dozens to
thousands) covering how you actually want Jarvis to respond will matter far
more than training-hyperparameter tuning.

### 2. Split into train/val

```
python prepare_data.py path/to/your_conversations.jsonl --val-fraction 0.1
```

Writes `data/train.jsonl` and `data/val.jsonl`.

### 3. Configure

```
cp config.example.yaml config.yaml
```

Edit `config.yaml`: pick a base model (default `Qwen/Qwen2.5-7B-Instruct` —
ungated, no HF access request needed; drop to `Qwen/Qwen2.5-3B-Instruct` for
less VRAM), adjust `training.bf16`/`fp16` for your GPU generation, and
review the LoRA/training hyperparameters.

### 4. Train

```
python train.py
```

Saves a LoRA adapter to `config.yaml`'s `output_dir` (default
`./output/jarvis-lora`).

### 5. Merge the adapter into a standalone model

```
python merge_and_export.py --base Qwen/Qwen2.5-7B-Instruct \
    --adapter ./output/jarvis-lora --out ./output/jarvis-merged
```

### 6. Convert to GGUF and import into Ollama

Ollama (which the app already talks to) runs GGUF-format models. Convert
with [llama.cpp](https://github.com/ggml-org/llama.cpp)'s conversion script:

```
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp && pip install -r requirements.txt
python convert_hf_to_gguf.py ../output/jarvis-merged \
    --outfile ../output/jarvis.gguf --outtype q4_k_m
```

Then create a `Modelfile` next to `jarvis.gguf`:

```
FROM ./jarvis.gguf
```

And register it with Ollama:

```
ollama create jarvis-custom -f Modelfile
```

### 7. Use it in the app

Open Jarvis Assistant → Settings → set **Chat model** to `jarvis-custom`.
No app code changes needed — it's just another Ollama model name.

## Iterating

Fine-tuning is a loop, not a one-shot: train, chat with it in the app,
notice where it's off, add/fix training examples that cover those cases,
retrain. A few dozen well-chosen examples usually beat a few hundred sloppy
ones.
