"""QLoRA fine-tuning of a local chat model on your own conversation data.

Reads config.yaml (copy config.example.yaml and edit it first -- see that
file for what each field means), loads the base model in 4-bit, attaches a
LoRA adapter, and trains it on data/train.jsonl (produced by
prepare_data.py). Saves the trained adapter to the configured output_dir;
run merge_and_export.py afterwards to fold it into a standalone model you
can convert to GGUF and load into Ollama.

Usage:
    python train.py [--config config.yaml]
"""

import argparse
from pathlib import Path

import torch
import yaml
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
from trl import SFTTrainer

try:
    from .validation import validate_finetune_config
except ImportError:
    from validation import validate_finetune_config


def load_config(path: str) -> tuple[dict, Path]:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(
            f"{path} not found -- copy config.example.yaml to {path} and edit it first"
        )
    with config_path.open() as f:
        return yaml.safe_load(f), config_path.parent


def resolve_config_path(value: str, config_dir: Path) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str(config_dir / path)


def format_example(example: dict, tokenizer) -> dict:
    text = tokenizer.apply_chat_template(example["messages"], tokenize=False, add_generation_prompt=False)
    return {"text": text}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.yaml")
    args = parser.parse_args()

    cfg, config_dir = load_config(args.config)
    for warning in validate_finetune_config(cfg):
        print(f"warning: {warning}")
    base_model = cfg["base_model"]
    data_cfg = cfg["data"]
    lora_cfg = cfg["lora"]
    train_cfg = cfg["training"]
    quant_cfg = cfg.get("quantization", {})
    output_dir = resolve_config_path(cfg["output_dir"], config_dir)
    train_file = resolve_config_path(data_cfg["train_file"], config_dir)
    val_file = data_cfg.get("val_file")
    val_file = resolve_config_path(val_file, config_dir) if val_file else ""

    if not Path(train_file).exists():
        raise FileNotFoundError(f"training file not found: {train_file} -- run prepare_data.py first")
    if val_file and not Path(val_file).exists():
        print(f"validation file not found, continuing without validation: {val_file}")
        val_file = ""

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    quantization_config = None
    if quant_cfg.get("load_in_4bit", True):
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16 if train_cfg.get("bf16", True) else torch.float16,
            bnb_4bit_use_double_quant=True,
        )

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=quantization_config,
        device_map="auto",
        torch_dtype=torch.bfloat16 if train_cfg.get("bf16", True) else torch.float16,
    )

    if quantization_config is not None:
        model = prepare_model_for_kbit_training(model)

    peft_config = LoraConfig(
        r=lora_cfg["r"],
        lora_alpha=lora_cfg["alpha"],
        lora_dropout=lora_cfg["dropout"],
        target_modules=lora_cfg["target_modules"],
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    data_files = {"train": train_file}
    if val_file:
        data_files["validation"] = val_file
    dataset = load_dataset("json", data_files=data_files)
    dataset = dataset.map(lambda ex: format_example(ex, tokenizer), remove_columns=dataset["train"].column_names)

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=train_cfg["num_train_epochs"],
        per_device_train_batch_size=train_cfg["per_device_train_batch_size"],
        gradient_accumulation_steps=train_cfg["gradient_accumulation_steps"],
        learning_rate=train_cfg["learning_rate"],
        warmup_ratio=train_cfg["warmup_ratio"],
        logging_steps=train_cfg["logging_steps"],
        save_steps=train_cfg["save_steps"],
        bf16=train_cfg.get("bf16", True),
        fp16=train_cfg.get("fp16", False),
        eval_strategy="steps" if "validation" in dataset else "no",
        eval_steps=train_cfg["save_steps"] if "validation" in dataset else None,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("validation"),
        dataset_text_field="text",
        max_seq_length=data_cfg["max_seq_length"],
        tokenizer=tokenizer,
    )

    trainer.train()
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"LoRA adapter saved to {output_dir} -- run merge_and_export.py next")


if __name__ == "__main__":
    main()
