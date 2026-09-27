#!/usr/bin/env python3
import argparse
import base64
import json
from datetime import datetime
from pathlib import Path

import tuf
from tuf.ngclient._internal.trusted_metadata_set import TrustedMetadataSet
from tuf.ngclient.config import EnvelopeType


def decode(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def iso_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def decide(case: dict) -> dict:
    try:
        trusted = TrustedMetadataSet(
            decode(case["trusted_root_b64"]),
            EnvelopeType.METADATA,
        )
        trusted.reference_time = iso_time(case["now"])

        for root in case["roots_b64"]:
            trusted.update_root(decode(root))

        trusted.update_timestamp(decode(case["timestamp_b64"]))
        trusted.update_snapshot(decode(case["snapshot_b64"]))
        trusted.update_targets(decode(case["targets_b64"]))

        return {
            "name": case["name"],
            "decision": "accept",
            "error": None,
        }
    except Exception as exc:  # Oracle records the precise upstream rejection class.
        return {
            "name": case["name"],
            "decision": "reject",
            "error": {
                "name": type(exc).__name__,
                "message": str(exc),
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus")
    parser.add_argument("output")
    args = parser.parse_args()

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    results = [decide(case) for case in corpus["cases"]]

    payload = {
        "oracle": "python-tuf",
        "version": tuf.__version__,
        "results": results,
    }
    Path(args.output).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
