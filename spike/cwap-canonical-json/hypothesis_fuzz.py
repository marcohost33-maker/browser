"""Property-Based-Fuzzing (Hypothesis) — 3-Wege-Agreement als Invariante.

P-1  Jeder gueltige CWAP-Strict-Wert, beliebig (nicht-kanonisch) serialisiert,
     wird von Python/Rust/JS akzeptiert, byte-identisch kanonisiert und ist
     idempotent.
P-2  Beliebige Bytes (inkl. mutierter gueltiger Dokumente, BOM-Prefixe,
     Surrogat-Escapes, Grenzzahlen) fuehren in allen drei Implementationen
     zum identischen Resultat (Entscheid + Code bzw. Bytes).
Derandomisiert (reproduzierbar); Shrinking liefert Minimal-Gegenbeispiele.

Coworker Research / Coworkerz | 2026-07-19 | hypothesis_fuzz.py v1.0
"""
from __future__ import annotations
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hypothesis import given, settings, strategies as st, HealthCheck
from differential3 import NodeBatch, run_python, run_rust

MAX_SAFE = 2**53 - 1
node = NodeBatch()

def tri(data: bytes):
    return run_python(data), run_rust(data), node.run(data)

# ---- Strategien -----------------------------------------------------------
safe_ints = st.one_of(
    st.integers(-100, 100),
    st.integers(-MAX_SAFE, MAX_SAFE),
    st.sampled_from([0, 1, -1, MAX_SAFE, -MAX_SAFE, MAX_SAFE - 1]),
)
# Strings ohne lone surrogates (gueltige Werte), inkl. Controls + Astral
clean_text = st.text(
    alphabet=st.characters(blacklist_categories=("Cs",)), max_size=24)
json_values = st.recursive(
    st.one_of(st.none(), st.booleans(), safe_ints, clean_text),
    lambda ch: st.one_of(
        st.lists(ch, max_size=5),
        st.dictionaries(clean_text, ch, max_size=5)),
    max_leaves=25)

def loose(v, draw_ascii: bool, indent) -> bytes:
    return json.dumps(v, ensure_ascii=draw_ascii, indent=indent).encode()

FAILS = []

@settings(max_examples=500, derandomize=True, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(v=json_values, asc=st.booleans(), ind=st.sampled_from([None, 1, 2]))
def test_p1_valid_roundtrip(v, asc, ind):
    data = loose(v, asc, ind)
    py, rs, js = tri(data)
    assert py == rs == js, (data, py, rs, js)
    assert py[0] == "A", (data, py)
    c = py[1]
    assert tri(c) == (("A", c), ("A", c), ("A", c)), "Idempotenz"

# P-2: adversariale Textfragmente + rohe Bytes
frag = st.sampled_from([
    b"", b"\xef\xbb\xbf", b"NaN", b"Infinity", b"-Infinity", b"1.5", b"1.0",
    b"1e2", b"-0", b"-0.0", b"01", str(2**53).encode(), str(2**53 - 1).encode(),
    b'"\\udc00"', b'"\\ud800\\udc00"', b'"\\ud800"', b'{"a":1,"a":2}',
    b"[" * 70 + b"1" + b"]" * 70, b'"\\', b'{', b'}', b'[', b']', b',', b':',
    b'"a\x01"', b'\xff', b'{"\\udc00":1}', b'true', b'null', b'  ',
])
@settings(max_examples=500, derandomize=True, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(parts=st.lists(st.one_of(frag, st.binary(max_size=12)), min_size=1, max_size=6))
def test_p2_agreement_arbitrary(parts):
    data = b"".join(parts)
    py, rs, js = tri(data)
    assert py == rs == js, (data, py, rs, js)
    assert py[0] in ("A", "R"), f"CRASH: {py}"  # nie unkontrolliert

if __name__ == "__main__":
    import traceback
    ok = True
    for name, fn in [("P-1 valid-roundtrip (500 Bsp.)", test_p1_valid_roundtrip),
                     ("P-2 arbitrary-agreement (500 Bsp.)", test_p2_agreement_arbitrary)]:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception:
            ok = False
            print(f"FAIL  {name}")
            traceback.print_exc(limit=3)
    sys.exit(0 if ok else 1)
