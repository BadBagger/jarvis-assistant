import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from finetune.validation import assert_no_split_leakage, validate_finetune_config


def record(user_text: str, assistant_text: str = "Done.") -> dict:
    return {
        "messages": [
            {"role": "system", "content": "You are Jarvis."},
            {"role": "user", "content": user_text},
            {"role": "assistant", "content": assistant_text},
        ],
        "source": "unit-test",
        "tags": ["prep"],
        "quality": "gold",
    }


class FineTuneValidationTests(unittest.TestCase):
    def test_prepare_data_cleans_dedupes_and_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw_path = tmp_path / "raw.jsonl"
            out_dir = tmp_path / "out"
            rows = [
                record("  Create a reminder.  "),
                record("create a reminder."),
                record("Summarize this note.", "Short summary."),
                record("Ask before sending email.", "I will draft it for review first."),
            ]
            raw_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "finetune.prepare_data",
                    str(raw_path),
                    "--out-dir",
                    str(out_dir),
                    "--val-fraction",
                    "0.34",
                    "--seed",
                    "7",
                    "--min-train",
                    "2",
                    "--min-val",
                    "1",
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("removed 1 duplicate", result.stdout)
            self.assertEqual(len((out_dir / "train.jsonl").read_text(encoding="utf-8").splitlines()), 2)
            self.assertEqual(len((out_dir / "val.jsonl").read_text(encoding="utf-8").splitlines()), 1)

    def test_split_leakage_rejects_duplicate_across_files(self):
        duplicate = record("Same prompt.")
        with self.assertRaisesRegex(ValueError, "split leakage"):
            assert_no_split_leakage([duplicate], [duplicate])

    def test_lora_guardrails_reject_extreme_rank(self):
        cfg = {
            "base_model": "Qwen/Qwen2.5-7B-Instruct",
            "output_dir": "./output/jarvis-lora",
            "data": {"train_file": "./data/train.jsonl", "max_seq_length": 2048},
            "lora": {"r": 128, "alpha": 256, "dropout": 0.05, "target_modules": ["q_proj"]},
            "training": {
                "num_train_epochs": 3,
                "per_device_train_batch_size": 1,
                "gradient_accumulation_steps": 8,
                "learning_rate": 2.0e-4,
                "bf16": True,
                "fp16": False,
            },
        }
        with self.assertRaisesRegex(ValueError, "lora.r"):
            validate_finetune_config(cfg)


if __name__ == "__main__":
    unittest.main()
