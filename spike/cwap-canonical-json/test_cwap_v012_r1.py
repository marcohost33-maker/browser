"""Anti-Regression v0.1.2 -> r1 + neue r1-Vektoren (31 Tests, plain runner).

Verifiziert 2026-07-19: 31/31 PASS (Python 3.12, Sandbox).
Coworker Research / Coworkerz
"""
import subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
# Der Testblock ist identisch mit dem in der Session gelaufenen Inline-Lauf;
# Ausfuehrung: python3 test_cwap_v012_r1.py  (Exit 0 = GRUEN)
sys.path.insert(0, HERE)
from cwap_strict_json import (CanonReject, MAX_SAFE_INT, canonicalize,
                              parse_strict, recanonicalize)
P = F = 0
def ok(cond, msg=""):
    assert cond, msg
def t(name, fn):
    global P, F
    try:
        fn(); P += 1
    except Exception as e:
        F += 1; print("FAIL", name, type(e).__name__, e)
def rej(fn, code):
    try:
        fn()
    except CanonReject as e:
        ok(e.code == code, f"{e.code} statt {code}"); return
    raise AssertionError(f"kein Reject ({code})")

t("skalare", lambda: ok(canonicalize(True) == b"true" and canonicalize(None) == b"null" and canonicalize(-7) == b"-7"))
t("separatoren", lambda: ok(canonicalize({"b": [1, 2], "a": {"x": None}}) == b'{"a":{"x":null},"b":[1,2]}'))
t("safe_int_grenzen", lambda: ok(canonicalize(MAX_SAFE_INT) == str(MAX_SAFE_INT).encode()))
t("2p53_reject", lambda: rej(lambda: canonicalize(2**53), "INT_OUT_OF_SAFE_RANGE"))
t("float_reject", lambda: rej(lambda: canonicalize(1.0), "FLOAT_FORBIDDEN"))
t("bool_nicht_int", lambda: ok(canonicalize({"a": True, "b": 1}) == b'{"a":true,"b":1}'))
t("kurz_escapes", lambda: ok(canonicalize("\b\t\n\f\r\"\\") == b'"\\b\\t\\n\\f\\r\\"\\\\"'))
t("controls_lowercase", lambda: ok(canonicalize("\x1f\x00") == b'"\\u001f\\u0000"'))
t("nonascii_unescaped", lambda: ok(canonicalize("\u20ac \u2194 \U0001f642") == '"\u20ac \u2194 \U0001f642"'.encode()))
def _u16():
    out = canonicalize({"\uff01": 1, "\U00010000": 2}).decode()
    ok(out.index("\U00010000") < out.index("\uff01"), out)
t("utf16_astral_order", _u16)
def _bmp():
    out = canonicalize({"\u20ac": "e", "~": "t", "a": "a", "\r": "cr", "1": "one"})
    ok(out == '{"\\r":"cr","1":"one","a":"a","~":"t","\u20ac":"e"}'.encode(), out)
t("utf16_bmp_order", _bmp)
t("rekursive_sortierung", lambda: ok(canonicalize({"z": {"b": 1, "a": 2}, "a": [{"y": 1, "x": 2}]}) == b'{"a":[{"x":2,"y":1}],"z":{"a":2,"b":1}}'))
t("nonstring_key", lambda: rej(lambda: canonicalize({1: "a"}), "NON_STRING_KEY"))
def _deep():
    d = cur = {}
    for _ in range(70):
        nxt = {}; cur["k"] = nxt; cur = nxt
    rej(lambda: canonicalize(d), "DEPTH_EXCEEDED")
t("tiefe_65plus", _deep)
t("set_unsupported", lambda: rej(lambda: canonicalize({"a": {1, 2}}), "UNSUPPORTED_TYPE"))
t("parse_dup", lambda: rej(lambda: parse_strict('{"a":1,"a":2}'), "DUPLICATE_KEY"))
t("parse_float_tokens", lambda: [rej(lambda x=x: parse_strict(x), "FLOAT_FORBIDDEN") for x in ('{"a":1.5}', '{"a":1.0}', '{"a":1e2}')])
t("parse_nonfinite", lambda: [rej(lambda x=x: parse_strict(x), "NONFINITE_FORBIDDEN") for x in ('{"a":NaN}', '{"a":Infinity}', '{"a":-Infinity}')])
t("parse_invalid_utf8", lambda: rej(lambda: parse_strict(b'"\xff"'), "INVALID_UTF8"))
t("recanon_idempotent", lambda: ok(recanonicalize(recanonicalize(b' {"b":2, "a":1} ')) == b'{"a":1,"b":2}'))
t("recanon_format_invariant", lambda: ok(recanonicalize(b'{"a" : [ 1 ,2 ]}') == recanonicalize(b'{"a":[1,2]}')))
t("negzero_token", lambda: ok(recanonicalize(b'-0') == b'0'))
t("r1_lone_low_escape", lambda: rej(lambda: recanonicalize(b'"\\udc00"'), "LONE_SURROGATE"))
t("r1_lone_high_escape", lambda: rej(lambda: recanonicalize(b'"\\ud800"'), "LONE_SURROGATE"))
t("r1_lone_in_key", lambda: rej(lambda: recanonicalize(b'{"\\udc00":1}'), "LONE_SURROGATE"))
t("r1_paired_ok", lambda: ok(recanonicalize(b'"\\ud83d\\ude42"') == '"\U0001f642"'.encode()))
t("r1_pyobj_surrogate", lambda: rej(lambda: canonicalize("\udc00"), "LONE_SURROGATE"))
t("r1_depth2000_gate", lambda: rej(lambda: parse_strict("[" * 2000 + "1" + "]" * 2000), "DEPTH_EXCEEDED"))
t("r1_depth65_gate", lambda: rej(lambda: parse_strict("[" * 65 + "1" + "]" * 65), "DEPTH_EXCEEDED"))
t("r1_depth64_ok", lambda: ok(recanonicalize("[" * 64 + "1" + "]" * 64) == ("[" * 64 + "1" + "]" * 64).encode()))
t("r1_depth_gate_stringsafe", lambda: ok(recanonicalize(b'{"a":"[[[[["}') == b'{"a":"[[[[["}'))

print(f"{P}/{P+F} PASS" + (" — GRUEN" if F == 0 else f" — {F} FAIL"))
sys.exit(0 if F == 0 else 1)
