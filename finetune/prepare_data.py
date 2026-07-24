"""Cleans, validates, deduplicates, and splits conversation JSONL.

Input: a JSONL file where each line is `{"messages": [...]}`, following the
standard chat format (roles: system/user/assistant, last message must be
from the assistant -- that's the target the model learns to produce). See
data/example_conversations.jsonl and dataset.schema.json for the exact shape.

Usage:
    python prepare_data.py data/my_conversations.raw.jsonl --val-fraction 0.1
"""

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

VALID_ROLES = {"system", "user", "assistant"}
OPTIONAL_TOP_LEVEL_FIELDS = {"source", "tags", "quality", "notes"}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def dedupe_key(obj: dict) -> str:
    canonical_messages = [
        {"role": msg["role"], "content": normalize_text(msg["content"]).casefold()}
        for msg in obj["messages"]
    ]
    payload = json.dumps(canonical_messages, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_conversation(obj: dict, line_no: int) -> None:
    if "messages" not in obj or not isinstance(obj["messages"], list) or not obj["messages"]:
        raise ValueError(f"line {line_no}: missing/empty 'messages' list")
    unknown_fields = set(obj) - {"messages"} - OPTIONAL_TOP_LEVEL_FIELDS
    if unknown_fields:
        raise ValueError(
            f"line {line_no}: unknown top-level field(s): {sorted(unknown_fields)}; "
            "allowed optional fields are source, tags, quality, notes"
        )
    if "tags" in obj and (
        not isinstance(obj["tags"], list) or not all(isinstance(tag, str) and tag.strip() for tag in obj["tags"])
    ):
        raise ValueError(f"line {line_no}: optional 'tags' must be a list of non-empty strings")
    if "quality" in obj and obj["quality"] not in {"gold", "silver", "draft"}:
        raise ValueError(f"line {line_no}: optional 'quality' must be one of: gold, silver, draft")
    for i, msg in enumerate(obj["messages"]):
        if "role" not in msg or "content" not in msg:
            raise ValueError(f"line {line_no}, message {i}: needs 'role' and 'content'")
        unknown_msg_fields = set(msg) - {"role", "content"}
        if unknown_msg_fields:
            raise ValueError(f"line {line_no}, message {i}: unknown field(s): {sorted(unknown_msg_fields)}")
        if msg["role"] not in VALID_ROLES:
            raise ValueError(f"line {line_no}, message {i}: role must be one of {VALID_ROLES}, got {msg['role']!r}")
        if not isinstance(msg["content"], str) or not msg["content"].strip():
            raise ValueError(f"line {line_no}, message {i}: 'content' must be non-empty text")
    if obj["messages"][0]["role"] == "assistant":
        raise ValueError(f"line {line_no}: first message should not be from 'assistant'")
    if obj["messages"][-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: last message must be from 'assistant' (that's the training target)")


def clean_conversation(obj: dict) -> dict:
    cleaned = dict(obj)
    cleaned["messages"] = [
        {"role": msg["role"], "content": normalize_text(msg["content"])}
        for msg in obj["messages"]
    ]
    if "tags" in cleaned:
        cleaned["tags"] = sorted({normalize_text(tag).casefold() for tag in cleaned["tags"] if normalize_text(tag)})
    return cleaned


def split_counts(total: int, val_fraction: float) -> int:
    if val_fraction <= 0 or total < 2:
        return 0
    val_count = round(total * val_fraction)
    val_count = max(1, val_count)
    return min(val_count, total - 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="raw JSONL conversations file")
    parser.add_argument("--out-dir", default="data", help="directory to write train.jsonl/val.jsonl into")
    parser.add_argument("--val-fraction", type=float, default=0.1, help="fraction held out for validation (0 to skip)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--no-clean", action="store_true", help="keep message whitespace exactly as supplied")
    parser.add_argument("--no-dedupe", action="store_true", help="keep exact/case-insensitive duplicate conversations")
    args = parser.parse_args()

    if args.val_fraction < 0 or args.val_fraction >= 1:
        print("error: --val-fraction must be >= 0 and < 1", file=sys.stderr)
        sys.exit(1)

    input_path = Path(args.input_file)
    lines = [line for line in input_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        print(f"error: {input_path} has no non-empty lines", file=sys.stderr)
        sys.exit(1)

    conversations = []
    seen = set()
    duplicate_count = 0
    for i, line in enumerate(lines, start=1):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"error: line {i} is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)
        try:
            validate_conversation(obj, i)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            sys.exit(1)
        if not args.no_clean:
            obj = clean_conversation(obj)
        if not args.no_dedupe:
            key = dedupe_key(obj)
            if key in seen:
                duplicate_count += 1
                continue
            seen.add(key)
        conversations.append(obj)

    if not conversations:
        print("error: no conversations left after filtering/deduplication", file=sys.stderr)
        sys.exit(1)

    random.Random(args.seed).shuffle(conversations)
    val_count = split_counts(len(conversations), args.val_fraction)
    val_set, train_set = conversations[:val_count], conversations[val_count:]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path = out_dir / "train.jsonl"
    with train_path.open("w", encoding="utf-8") as f:
        for obj in train_set:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    print(f"wrote {len(train_set)} conversations to {train_path}")
    if duplicate_count:
        print(f"removed {duplicate_count} duplicate conversation(s)")

    if val_set:
        val_path = out_dir / "val.jsonl"
        with val_path.open("w", encoding="utf-8") as f:
            for obj in val_set:
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        print(f"wrote {len(val_set)} conversations to {val_path}")
    else:
        print("no validation split requested (--val-fraction 0)")


if __name__ == "__main__":
    main()
