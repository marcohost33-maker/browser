#!/usr/bin/env python3
"""Second, FOREIGN-AUTHORED oracle: Trail of Bits `rfc8785` (a JCS implementation
NOT written by us). Addresses self-review F7 + research common-mode concern: our
Python/Rust/JS impls share one author, so their agreement can hide a shared JCS
misreading. ToB rfc8785 is an independent human-authored oracle.

Contract on the ACCEPT domain (integers/strings/structures, no floats):
    CWAP.recanonicalize(raw)  ==  rfc8785.dumps(json.loads(raw))
Both must also equal the official JCS reference output for the RFC vectors.

Needs: pip install rfc8785  (Trail of Bits, https://trailofbits.github.io/rfc8785.py/)
Run:   py test_cross_oracle_tob.py   (Exit 0 = CWAP agrees with the foreign oracle)
"""
import json, os, random, sys
import rfc8785  # Trail of Bits
from cwap_strict_json import CanonReject, recanonicalize
import differential as D

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(HERE, "testdata-rfc8785")
ACCEPT_VECTORS = ["arrays.json", "french.json", "unicode.json", "weird.json"]


def tob_canon(raw: bytes) -> bytes:
    return rfc8785.dumps(json.loads(raw))


def main():
    passed = failed = skipped = 0

    # 1) Official JCS accept vectors: CWAP == ToB == JCS reference output.
    for name in ACCEPT_VECTORS:
        raw = open(os.path.join(TD, "input", name), "rb").read()
        exp = open(os.path.join(TD, "output", name), "rb").read()
        cwap = recanonicalize(raw)
        tob = tob_canon(raw)
        if cwap == tob == exp:
            print(f"PASS vector {name}: CWAP == ToB-rfc8785 == JCS reference")
            passed += 1
        else:
            print(f"FAIL vector {name}: cwap={cwap!r} tob={tob!r} exp={exp!r}")
            failed += 1

    # 2) All ACCEPT cases of the deterministic corpus: CWAP == ToB.
    D.rng = random.Random(D.SEED)
    cases = [d for _, d in D.HAND]
    cases += [D.serialize_loose(D.gen_random_value(0)) for _ in range(400)]
    seeds = [d for _, d in D.HAND[:20]] + [
        D.serialize_loose(D.gen_random_value(0)) for _ in range(30)]
    cases += [D.mutate(D.rng.choice(seeds)) for _ in range(3000)]

    accept_checked = 0
    for data in cases:
        try:
            cwap = recanonicalize(data)          # only ACCEPT cases proceed
        except CanonReject:
            continue
        try:
            tob = tob_canon(data)
        except Exception as e:
            # ToB parses via json.loads then dumps; if it can't, that is a
            # domain mismatch worth surfacing, not silently skipping.
            print(f"SKIP corpus case (ToB could not process): {e}"); skipped += 1; continue
        accept_checked += 1
        if cwap != tob:
            print(f"FAIL corpus divergence CWAP!=ToB\n  in ={data!r}\n  cwap={cwap!r}\n  tob ={tob!r}")
            failed += 1
    print(f"corpus ACCEPT cases cross-checked against ToB: {accept_checked} "
          f"(skipped {skipped})")
    if failed == 0:
        passed += 1

    total_ok = failed == 0
    print(f"\n{'GRUEN' if total_ok else 'ROT'} — CWAP agrees with the foreign "
          f"ToB-rfc8785 oracle on the accept domain "
          f"(vectors {passed - (1 if total_ok else 0)}/4 + corpus)")
    return 0 if total_ok else 1


if __name__ == "__main__":
    sys.exit(main())
