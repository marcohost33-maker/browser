#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
from datetime import datetime
from pathlib import Path

import tuf
from securesystemslib.formats import encode_canonical
from tuf.ngclient._internal.trusted_metadata_set import TrustedMetadataSet
from tuf.ngclient.config import EnvelopeType


def decode(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def iso_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def keyid_mismatches(case: dict) -> list:
    """Recompute every root keyid independently of the code under test (#56).

    TUF: a KEYID is the hex SHA-256 of the canonical JSON of the public key
    object. python-tuf does not check a keyid against its key, and the corpus
    generator uses the Browser's own keyIdFor()/canonicalBytes(), so a drift in
    that formula would be invisible to both decision paths. Here the canonical
    form comes from securesystemslib instead.
    """
    mismatches = []
    roots = [case["trusted_root_b64"], *case["roots_b64"]]
    for index, raw in enumerate(roots):
        signed = json.loads(decode(raw))["signed"]
        for keyid, key in signed["keys"].items():
            expected = hashlib.sha256(encode_canonical(key).encode("utf-8")).hexdigest()
            if expected != keyid:
                mismatches.append({
                    "case": case["name"],
                    "root_index": index,
                    "keyid": keyid,
                    "independent_keyid": expected,
                })
    return mismatches


def decide(case: dict) -> dict:
    try:
        trusted = TrustedMetadataSet(
            decode(case["trusted_root_b64"]),
            EnvelopeType.METADATA,
        )
        trusted.reference_time = iso_time(case["now"])

        for root in case["roots_b64"]:
            trusted.update_root(decode(root))

        preload_timestamp = case.get("preload_timestamp_b64")
        if preload_timestamp is not None:
            trusted.update_timestamp(decode(preload_timestamp))

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
    mismatches = [m for case in corpus["cases"] for m in keyid_mismatches(case)]

    payload = {
        "oracle": "python-tuf",
        "version": tuf.__version__,
        "keyid_check": {
            "method": "sha256(securesystemslib.formats.encode_canonical(key))",
            "roots_checked": sum(1 + len(case["roots_b64"]) for case in corpus["cases"]),
            "mismatches": mismatches,
        },
        "results": results,
    }
    Path(args.output).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
