"""Merges a trained LoRA adapter into the base model, producing a standalone
model directory ready for GGUF conversion (see finetune/README.md for the
llama.cpp conversion + `ollama create` steps that follow).

Usage:
    python merge_and_export.py --base Qwen/Qwen2.5-7B-Instruct \\
        --adapter ./output/jarvis-lora --out ./output/jarvis-merged
"""

import argparse

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="base model id/path (must match what train.py used)")
    parser.add_argument("--adapter", required=True, help="path to the trained LoRA adapter (config.yaml's output_dir)")
    parser.add_argument("--out", required=True, help="directory to write the merged, standalone model into")
    args = parser.parse_args()

    print(f"loading base model {args.base} at full precision for merging...")
    base_model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.bfloat16, device_map="cpu")
    tokenizer = AutoTokenizer.from_pretrained(args.base)

    print(f"loading adapter from {args.adapter}...")
    model = PeftModel.from_pretrained(base_model, args.adapter)

    print("merging LoRA weights into the base model...")
    merged = model.merge_and_unload()

    merged.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"merged model saved to {args.out} -- convert this to GGUF next (see README.md)")


if __name__ == "__main__":
    main()
