#!/usr/bin/env python3
"""External-oracle conformance: ALL THREE CWAP impls (Python, Rust, JS) vs. the
OFFICIAL RFC 8785 (JCS) reference test vectors
(github.com/cyberphone/json-canonicalization, testdata/, authored by the JCS
spec author Anders Rundgren — an INDEPENDENT ground truth, not written by us).

Addresses self-review F1/F4/F7: the three impls share one author, so 3-way
agreement proves consistency, not correctness. These vectors are external.

CWAP is a strict *subset* of JCS (integers only; floats/NaN/Infinity banned):
  - ACCEPT vectors (no float tokens): every impl's output MUST be byte-identical
    to the JCS reference output. weird.json is the discriminating case — it holds
    a supplementary-plane key (😂 U+1F602) that must sort BEFORE a BMP key
    (דּ U+FB33) by UTF-16 code units (NOT code points); getting it right proves
    JCS-correct sorting.
  - REJECT vectors (contain float syntax): every impl MUST reject FLOAT_FORBIDDEN,
    documenting the subset boundary precisely.

Run (Rust binary + node required):
    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs   # or cwap_rs.exe on Windows
    py test_rfc8785_vectors.py
"""
import base64, json, os, subprocess, sys
from cwap_strict_json import CanonReject, recanonicalize

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(HERE, "testdata-rfc8785")
RUST = os.path.join(HERE, "rust", "cwap_rs")
if not os.path.exists(RUST) and os.path.exists(RUST + ".exe"):
    RUST += ".exe"
JS_BATCH = os.path.join(HERE, "js", "batch.mjs")

# want: ("ACCEPT", None) | ("REJECT", "<CODE>")
EXPECT = {
    "arrays.json":     ("ACCEPT", None),
    "french.json":     ("ACCEPT", None),
    "unicode.json":    ("ACCEPT", None),
    "weird.json":      ("ACCEPT", None),   # UTF-16 supplementary-plane sort case
    "structures.json": ("REJECT", "FLOAT_FORBIDDEN"),   # 56.0
    "values.json":     ("REJECT", "FLOAT_FORBIDDEN"),   # 1E30, 4.50, 2e-3, ...
}


def run_python(raw):
    try:
        return ("ACCEPT", recanonicalize(raw))
    except CanonReject as e:
        return ("REJECT", e.code)


def run_rust(raw):
    p = subprocess.run([RUST], input=raw, capture_output=True, timeout=20)
    if p.returncode == 0:
        return ("ACCEPT", p.stdout)
    return ("REJECT", p.stderr.decode().strip())


def run_js(raw):
    inp = base64.b64encode(raw).decode() + "\n"
    p = subprocess.run(["node", JS_BATCH], input=inp.encode(), capture_output=True, timeout=30)
    tag, _, rest = p.stdout.decode().strip().partition(" ")
    return ("ACCEPT", base64.b64decode(rest)) if tag == "A" else ("REJECT", rest)


IMPLS = [("python", run_python), ("rust", run_rust), ("js", run_js)]


def main():
    if not os.path.exists(RUST):
        print(f"ERROR: Rust binary missing ({RUST}); compile it first."); return 2
    failed = 0
    for name, (want, code) in EXPECT.items():
        raw = open(os.path.join(TD, "input", name), "rb").read()
        exp_out = open(os.path.join(TD, "output", name), "rb").read() if want == "ACCEPT" else None
        row = []
        for impl_name, fn in IMPLS:
            got_kind, got_val = fn(raw)
            if want == "ACCEPT":
                ok = got_kind == "ACCEPT" and got_val == exp_out
            else:
                ok = got_kind == "REJECT" and got_val == code
            row.append(f"{impl_name}={'ok' if ok else 'FAIL'}")
            if not ok:
                failed += 1
                print(f"  MISMATCH {name}/{impl_name}: kind={got_kind} val={got_val!r}")
        verdict = "ACCEPT==JCS" if want == "ACCEPT" else f"REJECT {code}"
        print(f"{'PASS' if all('ok' in c for c in row) else 'FAIL'} {name:16} [{verdict}]  " + "  ".join(row))
    print(f"\n{'GRUEN' if failed == 0 else f'ROT ({failed} mismatches)'} — "
          f"3 impls x {len(EXPECT)} official JCS vectors")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
