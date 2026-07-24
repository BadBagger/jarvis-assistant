"""Validate a Jarvis fine-tuning config without loading model libraries.

Usage:
    python check_config.py --config config.yaml
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

try:
    from .validation import validate_finetune_config
except ImportError:
    from validation import validate_finetune_config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.yaml")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"error: {config_path} not found -- copy config.example.yaml first", file=sys.stderr)
        sys.exit(1)

    with config_path.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    try:
        warnings = validate_finetune_config(cfg)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    print(f"config ok: {config_path}")


if __name__ == "__main__":
    main()
