"""Validates a raw conversations file and splits it into train/val JSONL.

Input: a JSONL file where each line is `{"messages": [...]}`, following the
standard chat format (roles: system/user/assistant, last message must be
from the assistant -- that's the target the model learns to produce). See
data/example_conversations.jsonl for the exact shape.

Usage:
    python prepare_data.py data/my_conversations.raw.jsonl --val-fraction 0.1
"""

import argparse
import json
import random
import sys
from pathlib import Path

VALID_ROLES = {"system", "user", "assistant"}


def validate_conversation(obj: dict, line_no: int) -> None:
    if "messages" not in obj or not isinstance(obj["messages"], list) or not obj["messages"]:
        raise ValueError(f"line {line_no}: missing/empty 'messages' list")
    for i, msg in enumerate(obj["messages"]):
        if "role" not in msg or "content" not in msg:
            raise ValueError(f"line {line_no}, message {i}: needs 'role' and 'content'")
        if msg["role"] not in VALID_ROLES:
            raise ValueError(f"line {line_no}, message {i}: role must be one of {VALID_ROLES}, got {msg['role']!r}")
        if not isinstance(msg["content"], str) or not msg["content"].strip():
            raise ValueError(f"line {line_no}, message {i}: 'content' must be non-empty text")
    if obj["messages"][-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: last message must be from 'assistant' (that's the training target)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="raw JSONL conversations file")
    parser.add_argument("--out-dir", default="data", help="directory to write train.jsonl/val.jsonl into")
    parser.add_argument("--val-fraction", type=float, default=0.1, help="fraction held out for validation (0 to skip)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    input_path = Path(args.input_file)
    lines = [line for line in input_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        print(f"error: {input_path} has no non-empty lines", file=sys.stderr)
        sys.exit(1)

    conversations = []
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
        conversations.append(obj)

    random.Random(args.seed).shuffle(conversations)
    val_count = round(len(conversations) * args.val_fraction) if args.val_fraction > 0 else 0
    val_set, train_set = conversations[:val_count], conversations[val_count:]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path = out_dir / "train.jsonl"
    with train_path.open("w", encoding="utf-8") as f:
        for obj in train_set:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    print(f"wrote {len(train_set)} conversations to {train_path}")

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
