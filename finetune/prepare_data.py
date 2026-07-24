"""Cleans, validates, deduplicates, and splits conversation JSONL.

Input: a JSONL file where each line is `{"messages": [...]}`, following the
standard chat format (roles: system/user/assistant, last message must be
from the assistant -- that's the target the model learns to produce). See
data/example_conversations.jsonl and dataset.schema.json for the exact shape.

Usage:
    python prepare_data.py data/my_conversations.raw.jsonl --val-fraction 0.1
"""

import argparse
import json
import random
import sys
from pathlib import Path

try:
    from .validation import assert_no_split_leakage, clean_conversation, dedupe_key, split_counts, validate_conversation
except ImportError:
    from validation import assert_no_split_leakage, clean_conversation, dedupe_key, split_counts, validate_conversation


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="raw JSONL conversations file")
    parser.add_argument("--out-dir", default="data", help="directory to write train.jsonl/val.jsonl into")
    parser.add_argument("--val-fraction", type=float, default=0.1, help="fraction held out for validation (0 to skip)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--no-clean", action="store_true", help="keep message whitespace exactly as supplied")
    parser.add_argument("--no-dedupe", action="store_true", help="keep exact/case-insensitive duplicate conversations")
    parser.add_argument("--min-train", type=int, default=1, help="fail if fewer training conversations remain")
    parser.add_argument("--min-val", type=int, default=0, help="fail if validation is requested but fewer validation conversations remain")
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
    warning_count = 0
    for i, line in enumerate(lines, start=1):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"error: line {i} is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)
        try:
            warnings = validate_conversation(obj, i)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            sys.exit(1)
        for warning in warnings:
            warning_count += 1
            print(f"warning: {warning}", file=sys.stderr)
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
    try:
        assert_no_split_leakage(train_set, val_set)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    if len(train_set) < args.min_train:
        print(f"error: only {len(train_set)} training conversation(s); --min-train requires {args.min_train}", file=sys.stderr)
        sys.exit(1)
    if args.val_fraction > 0 and len(val_set) < args.min_val:
        print(f"error: only {len(val_set)} validation conversation(s); --min-val requires {args.min_val}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path = out_dir / "train.jsonl"
    with train_path.open("w", encoding="utf-8") as f:
        for obj in train_set:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    print(f"wrote {len(train_set)} conversations to {train_path}")
    if duplicate_count:
        print(f"removed {duplicate_count} duplicate conversation(s)")
    if warning_count:
        print(f"emitted {warning_count} safety warning(s)")

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
