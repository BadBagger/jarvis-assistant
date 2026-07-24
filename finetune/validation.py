"""Shared validation utilities for Jarvis fine-tuning preparation.

This module intentionally has no GPU or model-training dependencies. It can be
used in CI or a local CPU-only environment to catch bad data and unsafe configs
before starting a long fine-tuning run.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Iterable

VALID_ROLES = {"system", "user", "assistant"}
OPTIONAL_TOP_LEVEL_FIELDS = {"source", "tags", "quality", "notes"}
QUALITY_VALUES = {"gold", "silver", "draft"}
SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9_]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
]


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def dedupe_key(obj: dict) -> str:
    canonical_messages = [
        {"role": msg["role"], "content": normalize_text(msg["content"]).casefold()}
        for msg in obj["messages"]
    ]
    payload = json.dumps(canonical_messages, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_conversation(obj: dict, line_no: int) -> list[str]:
    warnings = []
    if not isinstance(obj, dict):
        raise ValueError(f"line {line_no}: record must be a JSON object")
    if "messages" not in obj or not isinstance(obj["messages"], list) or not obj["messages"]:
        raise ValueError(f"line {line_no}: missing/empty 'messages' list")
    unknown_fields = set(obj) - {"messages"} - OPTIONAL_TOP_LEVEL_FIELDS
    if unknown_fields:
        raise ValueError(
            f"line {line_no}: unknown top-level field(s): {sorted(unknown_fields)}; "
            "allowed optional fields are source, tags, quality, notes"
        )
    if "source" in obj and (not isinstance(obj["source"], str) or not obj["source"].strip()):
        raise ValueError(f"line {line_no}: optional 'source' must be non-empty text")
    if "tags" in obj and (
        not isinstance(obj["tags"], list) or not all(isinstance(tag, str) and tag.strip() for tag in obj["tags"])
    ):
        raise ValueError(f"line {line_no}: optional 'tags' must be a list of non-empty strings")
    if "quality" in obj and obj["quality"] not in QUALITY_VALUES:
        raise ValueError(f"line {line_no}: optional 'quality' must be one of: {sorted(QUALITY_VALUES)}")
    if "notes" in obj and not isinstance(obj["notes"], str):
        raise ValueError(f"line {line_no}: optional 'notes' must be text")
    for i, msg in enumerate(obj["messages"]):
        if not isinstance(msg, dict):
            raise ValueError(f"line {line_no}, message {i}: message must be an object")
        if "role" not in msg or "content" not in msg:
            raise ValueError(f"line {line_no}, message {i}: needs 'role' and 'content'")
        unknown_msg_fields = set(msg) - {"role", "content"}
        if unknown_msg_fields:
            raise ValueError(f"line {line_no}, message {i}: unknown field(s): {sorted(unknown_msg_fields)}")
        if msg["role"] not in VALID_ROLES:
            raise ValueError(f"line {line_no}, message {i}: role must be one of {sorted(VALID_ROLES)}, got {msg['role']!r}")
        if not isinstance(msg["content"], str) or not msg["content"].strip():
            raise ValueError(f"line {line_no}, message {i}: 'content' must be non-empty text")
        for pattern in SECRET_PATTERNS:
            if pattern.search(msg["content"]):
                warnings.append(f"line {line_no}, message {i}: possible secret detected; remove it before training")
                break
    if obj["messages"][0]["role"] == "assistant":
        raise ValueError(f"line {line_no}: first message should not be from 'assistant'")
    if obj["messages"][-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: last message must be from 'assistant' (that's the training target)")
    return warnings


def clean_conversation(obj: dict) -> dict:
    cleaned = dict(obj)
    cleaned["messages"] = [
        {"role": msg["role"], "content": normalize_text(msg["content"])}
        for msg in obj["messages"]
    ]
    if "source" in cleaned:
        cleaned["source"] = normalize_text(cleaned["source"])
    if "tags" in cleaned:
        cleaned["tags"] = sorted({normalize_text(tag).casefold() for tag in cleaned["tags"] if normalize_text(tag)})
    if "notes" in cleaned:
        cleaned["notes"] = normalize_text(cleaned["notes"])
    return cleaned


def split_counts(total: int, val_fraction: float) -> int:
    if val_fraction <= 0 or total < 2:
        return 0
    val_count = round(total * val_fraction)
    val_count = max(1, val_count)
    return min(val_count, total - 1)


def assert_no_split_leakage(train_set: Iterable[dict], val_set: Iterable[dict]) -> None:
    train_keys = {dedupe_key(obj) for obj in train_set}
    leaked_count = sum(1 for obj in val_set if dedupe_key(obj) in train_keys)
    if leaked_count:
        raise ValueError(
            f"train/validation split leakage: {leaked_count} duplicate conversation(s) appear in both files"
        )


def validate_lora_config(lora_cfg: dict) -> list[str]:
    warnings = []
    r = lora_cfg.get("r")
    alpha = lora_cfg.get("alpha")
    dropout = lora_cfg.get("dropout")
    target_modules = lora_cfg.get("target_modules")

    if not isinstance(r, int) or r < 1 or r > 64:
        raise ValueError("lora.r must be an integer from 1 to 64; start with 8 or 16")
    if r > 32:
        warnings.append("lora.r above 32 is usually unnecessary for a first Jarvis adapter")
    if not isinstance(alpha, int) or alpha < r or alpha > r * 4:
        raise ValueError("lora.alpha should be an integer between r and 4*r; 2*r is the normal starting point")
    if alpha != r * 2:
        warnings.append("lora.alpha is not 2*r; treat that as an intentional experiment")
    if not isinstance(dropout, (int, float)) or dropout < 0 or dropout > 0.2:
        raise ValueError("lora.dropout must be between 0 and 0.2; use 0.03-0.1 for small personal datasets")
    if dropout == 0:
        warnings.append("lora.dropout is 0; small datasets are more likely to overfit")
    if not isinstance(target_modules, list) or not target_modules or not all(isinstance(item, str) and item for item in target_modules):
        raise ValueError("lora.target_modules must be a non-empty list of module names")
    return warnings


def validate_finetune_config(cfg: dict) -> list[str]:
    warnings = []
    if not isinstance(cfg, dict):
        raise ValueError("config must be a YAML object")
    for key in ["base_model", "output_dir", "data", "lora", "training"]:
        if key not in cfg:
            raise ValueError(f"config missing required key: {key}")
    data_cfg = cfg["data"]
    train_cfg = cfg["training"]
    if not isinstance(data_cfg.get("train_file"), str) or not data_cfg["train_file"]:
        raise ValueError("data.train_file must point to a prepared train.jsonl file")
    max_seq_length = data_cfg.get("max_seq_length")
    if not isinstance(max_seq_length, int) or max_seq_length < 256 or max_seq_length > 8192:
        raise ValueError("data.max_seq_length must be an integer from 256 to 8192")
    if max_seq_length > 4096:
        warnings.append("data.max_seq_length above 4096 can sharply increase VRAM use")

    warnings.extend(validate_lora_config(cfg["lora"]))

    epochs = train_cfg.get("num_train_epochs")
    if not isinstance(epochs, (int, float)) or epochs <= 0 or epochs > 5:
        raise ValueError("training.num_train_epochs must be > 0 and <= 5 for guarded local prep")
    if epochs > 3:
        warnings.append("training.num_train_epochs above 3 can overfit small Jarvis datasets")
    batch = train_cfg.get("per_device_train_batch_size")
    accum = train_cfg.get("gradient_accumulation_steps")
    if not isinstance(batch, int) or batch < 1 or batch > 4:
        raise ValueError("training.per_device_train_batch_size must be 1-4; use accumulation instead of large batches")
    if not isinstance(accum, int) or accum < 1 or accum > 64:
        raise ValueError("training.gradient_accumulation_steps must be 1-64")
    lr = train_cfg.get("learning_rate")
    if not isinstance(lr, (int, float)) or lr <= 0 or lr > 0.001:
        raise ValueError("training.learning_rate must be > 0 and <= 0.001")
    if train_cfg.get("bf16") and train_cfg.get("fp16"):
        raise ValueError("training.bf16 and training.fp16 cannot both be true")
    return warnings
