"""CWAP v0.1.2-r1 Differential-Korpus (D4) — Generator, Runner, Fuzzer.

Vergleicht Python-Referenz (cwap_strict_json.recanonicalize) gegen die
unabhaengige Rust-Zweitimplementation (rust/cwap_rs, stdin->stdout) auf:
  (a) Accept/Reject-Entscheid identisch
  (b) bei Accept: Kanonbytes byte-identisch + Idempotenz beidseitig
  (c) bei Reject: Reject-Code identisch

Determinismus: seed=20260719. Output: corpus/ (Einzelfaelle),
results/differential-report.json (Zaehler, Divergenzen, Korpus-SHA-256).

Coworker Research / Coworkerz | 2026-07-19 | differential.py v1.0
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cwap_strict_json import CanonReject, recanonicalize  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RUST = os.path.join(HERE, "rust", "cwap_rs")
CORPUS_DIR = os.path.join(HERE, "corpus")
RESULTS = os.path.join(HERE, "results")
SEED = 20260719
MAX_SAFE = 2**53 - 1

rng = random.Random(SEED)

# --------------------------------------------------------------- Handschrift
# Kuratierte Faelle: (name, bytes)
HAND: list[tuple[str, bytes]] = [
    ("scalar_true", b"true"),
    ("scalar_false", b"false"),
    ("scalar_null", b"null"),
    ("int_zero", b"0"),
    ("int_neg", b"-7"),
    ("int_negzero_token", b"-0"),
    ("int_max_safe", str(MAX_SAFE).encode()),
    ("int_min_safe", ("-" + str(MAX_SAFE)).encode()),
    ("int_2p53", str(2**53).encode()),
    ("int_neg_2p53", ("-" + str(2**53)).encode()),
    ("int_huge", str(10**30).encode()),
    ("float_15", b'{"a":1.5}'),
    ("float_10", b'{"a":1.0}'),
    ("float_exp", b'{"a":1e2}'),
    ("float_exp_neg", b'{"a":5E-3}'),
    ("float_negzero", b'{"a":-0.0}'),
    ("nonfinite_nan", b'{"a":NaN}'),
    ("nonfinite_inf", b'{"a":Infinity}'),
    ("nonfinite_neginf", b'{"a":-Infinity}'),
    ("dup_key", b'{"a":1,"a":2}'),
    ("nested_sort", b'{"z":{"b":1,"a":2},"a":[{"y":1,"x":2}]}'),
    ("utf16_order_astral", '{"\uff01":1,"\U00010000":2}'.encode("utf-8")),
    ("utf16_order_bmp", '{"\u20ac":"e","~":"t","a":"a","\\r":"cr","1":"one"}'.encode("utf-8")),
    ("escapes_short", b'"\\b\\t\\n\\f\\r\\"\\\\"'),
    ("escape_control", b'"\\u001f\\u0000"'),
    ("escape_solidus", b'"a\\/b"'),
    ("unicode_raw", '"\u20ac \u2194 \U0001f642"'.encode("utf-8")),
    ("surrogate_pair_escape", b'"\\ud83d\\ude42"'),
    ("lone_low_surrogate", b'"\\udc00"'),
    ("lone_high_surrogate", b'"\\ud800"'),
    ("reversed_surrogates", b'"\\ude42\\ud83d"'),
    ("high_then_nonlow", b'"\\ud800x"'),
    ("lone_surrogate_key", b'{"\\udc00":1}'),
    ("leading_zero", b"01"),
    ("plus_prefix", b"+1"),
    ("bare_minus", b"-"),
    ("trailing_data", b"1 2"),
    ("trailing_garbage", b'{"a":1}x'),
    ("bom_prefix", "\ufeff{}".encode("utf-8")),
    ("raw_control_in_string", b'"a\x01b"'),
    ("invalid_utf8", b'"\xff\xfe"'),
    ("invalid_utf8_cont", b'{"a":"\xc3("}'),
    ("empty_input", b""),
    ("ws_only", b"   "),
    ("ws_around", b'  {"a" : [ 1 , 2 ] }  \n'),
    ("depth_64_ok", b"[" * 64 + b"1" + b"]" * 64),
    ("depth_65_reject", b"[" * 65 + b"1" + b"]" * 65),
    ("depth_200_reject", b"[" * 200 + b"1" + b"]" * 200),
    ("depth_2000_reject", b"[" * 2000 + b"1" + b"]" * 2000),
    ("empty_obj", b"{}"),
    ("empty_arr", b"[]"),
    ("obj_missing_colon", b'{"a" 1}'),
    ("obj_nonstring_key", b"{1:2}"),
    ("single_quote_str", b"{'a':1}"),
    ("ext_field_passthrough", b'{"ext":{"z":1,"a":2},"v":"cwap-0.1.2"}'),
]


def gen_random_value(depth: int) -> object:
    """Zufaellig gueltige CWAP-Strict-Werte (nur Safe-Ints, keine Floats)."""
    if depth >= 6:
        kinds = ["int", "str", "bool", "null"]
    else:
        kinds = ["int", "str", "bool", "null", "arr", "obj", "obj"]
    k = rng.choice(kinds)
    if k == "int":
        return rng.choice([
            rng.randint(-100, 100),
            rng.randint(-MAX_SAFE, MAX_SAFE),
            0, MAX_SAFE, -MAX_SAFE,
        ])
    if k == "bool":
        return rng.random() < 0.5
    if k == "null":
        return None
    if k == "str":
        n = rng.randint(0, 12)
        chars = []
        for _ in range(n):
            r = rng.random()
            if r < 0.55:
                chars.append(chr(rng.randint(0x20, 0x7E)))
            elif r < 0.75:
                chars.append(chr(rng.randint(0x00, 0x1F)))  # Controls
            elif r < 0.90:
                chars.append(chr(rng.randint(0xA0, 0xFFFD)))
            else:
                chars.append(chr(rng.randint(0x10000, 0x10FFF)))  # astral
        return "".join(c for c in chars if not (0xD800 <= ord(c) <= 0xDFFF))
    if k == "arr":
        return [gen_random_value(depth + 1) for _ in range(rng.randint(0, 5))]
    # obj — auch fiese Keys (leerer Key, Sortier-Grenzfaelle)
    keys = set()
    while len(keys) < rng.randint(0, 5):
        r = rng.random()
        if r < 0.2:
            keys.add(rng.choice(["", "a", "~", "\u20ac", "\U00010000", "\uff01", "\r", "1"]))
        else:
            keys.add("k" + str(rng.randint(0, 9999)))
    return {k2: gen_random_value(depth + 1) for k2 in sorted(keys)}


def serialize_loose(v: object) -> bytes:
    """Nicht-kanonische, aber gueltige Serialisierung (Whitespace-Rauschen)."""
    txt = json.dumps(v, ensure_ascii=rng.random() < 0.5,
                     indent=rng.choice([None, None, 1, 2]),
                     separators=rng.choice([(",", ":"), (", ", ": "), (",", ": ")]))
    return txt.encode("utf-8")


MUTATIONS = [b".", b"e9", b"\\", b'"', b"{", b"}", b"[", b"]", b",", b":",
             b"\x00", b"\xff", b"NaN", b"1.5", b"\\udc00", b"00", b"-", b" "]


def mutate(data: bytes) -> bytes:
    d = bytearray(data)
    for _ in range(rng.randint(1, 3)):
        op = rng.randint(0, 2)
        if not d:
            d.extend(rng.choice(MUTATIONS))
            continue
        pos = rng.randrange(len(d) + 1)
        if op == 0:  # insert
            d[pos:pos] = rng.choice(MUTATIONS)
        elif op == 1 and pos < len(d):  # flip
            d[pos] = rng.randrange(256)
        elif pos < len(d):  # delete
            del d[pos]
    return bytes(d)


# ------------------------------------------------------------------- Runner

def run_python(data: bytes) -> tuple[str, str | bytes]:
    try:
        return ("ACCEPT", recanonicalize(data))
    except CanonReject as e:
        return ("REJECT", e.code)
    except Exception as e:  # Vertragsbruch: kein CanonReject
        return ("CRASH", f"{type(e).__name__}: {e}")


def run_rust(data: bytes) -> tuple[str, str | bytes]:
    p = subprocess.run([RUST], input=data, capture_output=True, timeout=20)
    if p.returncode == 0:
        return ("ACCEPT", p.stdout)
    if p.returncode == 1:
        return ("REJECT", p.stderr.decode("utf-8", "replace"))
    return ("CRASH", f"exit {p.returncode}: {p.stderr[:200]!r}")


def compare(name: str, data: bytes, report: dict) -> None:
    ps, pv = run_python(data)
    rs, rv = run_rust(data)
    entry = {"case": name, "py": ps, "rs": rs}
    ok = False
    if ps == rs == "ACCEPT":
        ok = pv == rv
        entry["bytes_equal"] = ok
        if ok:
            # Idempotenz beidseitig: canon(canon(x)) == canon(x)
            ps2, pv2 = run_python(pv)
            rs2, rv2 = run_rust(rv)
            idem = ps2 == rs2 == "ACCEPT" and pv2 == pv and rv2 == rv
            entry["idempotent"] = idem
            ok = idem
        else:
            entry["py_sha"] = hashlib.sha256(pv).hexdigest()[:16]
            entry["rs_sha"] = hashlib.sha256(rv).hexdigest()[:16]
    elif ps == rs == "REJECT":
        ok = pv == rv
        entry["code_py"] = pv
        entry["code_rs"] = rv
    else:
        entry["detail_py"] = str(pv)[:200] if ps != "ACCEPT" else "<bytes>"
        entry["detail_rs"] = str(rv)[:200] if rs != "ACCEPT" else "<bytes>"
    report["total"] += 1
    if ok:
        report["agree"] += 1
        if ps == "ACCEPT":
            report["accept"] += 1
            report["_hash"].update(pv if isinstance(pv, bytes) else b"")
        else:
            report["reject"] += 1
            report["reject_codes"][pv] = report["reject_codes"].get(pv, 0) + 1
    else:
        report["divergences"].append(entry)


def main() -> int:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    os.makedirs(RESULTS, exist_ok=True)
    report = {"seed": SEED, "total": 0, "agree": 0, "accept": 0, "reject": 0,
              "reject_codes": {}, "divergences": [], "_hash": hashlib.sha256()}

    # 1) Kuratierte Faelle (persistiert als Korpus-Dateien)
    for name, data in HAND:
        with open(os.path.join(CORPUS_DIR, f"hand_{name}.bin"), "wb") as f:
            f.write(data)
        compare(f"hand_{name}", data, report)

    # 2) Zufaellig gueltige Dokumente, loose serialisiert (400 Faelle)
    for i in range(400):
        data = serialize_loose(gen_random_value(0))
        compare(f"randvalid_{i:03d}", data, report)

    # 3) Mutations-Fuzzing der parse_strict-Grenzen (3000 Iterationen)
    seeds = [data for _, data in HAND[:20]] + [
        serialize_loose(gen_random_value(0)) for _ in range(30)]
    for i in range(3000):
        data = mutate(rng.choice(seeds))
        compare(f"fuzz_{i:04d}", data, report)

    corpus_sha = report.pop("_hash").hexdigest()
    report["accept_canon_sha256"] = corpus_sha
    n_div = len(report["divergences"])
    report["verdict"] = "GRUEN" if n_div == 0 else f"ROT ({n_div} Divergenzen)"
    with open(os.path.join(RESULTS, "differential-report.json"), "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: v for k, v in report.items() if k != "divergences"},
                     indent=2, ensure_ascii=False))
    if n_div:
        print(f"\nERSTE DIVERGENZEN ({min(n_div,10)}/{n_div}):")
        for d in report["divergences"][:10]:
            print(" ", d)
    return 0 if n_div == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
