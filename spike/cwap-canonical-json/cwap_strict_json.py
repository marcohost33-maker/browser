"""CWAP-Strict-JSON v0.1.2-r1 — deterministische Kanonisierung fuer CWAP-Manifeste.

Referenzimplementation (Python, nur Standardbibliothek). Fail-closed: jede
Regelverletzung wirft CanonReject mit maschinenlesbarem Code.

Kanon (D1-D4, siehe CWAP_CANONICAL_JSON_v0.1.2_DRAFT.md):
  D1 RFC-8785-(JCS)-kompatible Serialisierung: Schluesselsortierung ueber
     UTF-16-Code-Units, ES-konformes String-Escaping, keine Whitespaces.
  D2 Zahlenraum nur Ganzzahlen |n| <= 2^53-1; Floats/NaN/Infinity REJECT.
  D3 Extensions nur unter "ext" (Verifier-Ebene, nicht diese Schicht).
  D4 Aequivalenz via Differential-Korpus (Python vs. Rust), kein NAR.

r1-Haertungen gegenueber v0.1.2 (Fuzzing-Befunde F-01/F-02, 2026-07-19):
  F-01 Lone Surrogates (z.B. via \\udc00-Escape im Eingabetext) fuehrten zu
       UnicodeEncodeError statt CanonReject -> jetzt LONE_SURROGATE (fail-closed
       im Vertragstyp, nicht nur im Effekt).
  F-02 parse_strict verliess sich bei extremer Verschachtelung auf
       RecursionError des CPython-Parsers -> jetzt strukturelles Depth-Gate
       VOR json.loads (DEPTH_EXCEEDED, deterministisch, DoS-gehaertet).

Coworker Research / Coworkerz | 2026-07-19 | cwap_strict_json.py v0.1.2-r1
"""
from __future__ import annotations

import json

MAX_SAFE_INT = 2**53 - 1
MAX_DEPTH = 64


class CanonReject(ValueError):
    """Kanonisierung abgelehnt. args[0] ist ein maschinenlesbarer Code."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code, detail)
        self.code = code
        self.detail = detail


# Zwei-Zeichen-Escapes gemaess ECMAScript JSON.stringify / RFC 8785 3.2.2.2
_SHORT_ESCAPES = {
    0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r",
    0x22: '\\"', 0x5C: "\\\\",
}


def _escape_string(s: str) -> str:
    out = ['"']
    for ch in s:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:  # F-01: lone surrogate fail-closed
            raise CanonReject("LONE_SURROGATE", f"U+{cp:04X}")
        esc = _SHORT_ESCAPES.get(cp)
        if esc is not None:
            out.append(esc)
        elif cp < 0x20:
            out.append(f"\\u{cp:04x}")  # Lowercase-Hex gemaess RFC 8785
        else:
            out.append(ch)  # unescaped, UTF-8 im Output
    out.append('"')
    return "".join(out)


def _utf16_sort_key(s: str) -> bytes:
    """RFC 8785 3.2.3: Sortierung ueber UTF-16-Code-Units, nicht Codepoints."""
    try:
        return s.encode("utf-16-be")
    except UnicodeEncodeError as e:  # lone surrogate im Key
        raise CanonReject("LONE_SURROGATE", str(e)) from e


def _canon(value: object, depth: int) -> str:
    if depth > MAX_DEPTH:
        raise CanonReject("DEPTH_EXCEEDED", f">{MAX_DEPTH}")
    # bool VOR int pruefen (bool ist int-Subklasse in Python)
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        if not (-MAX_SAFE_INT <= value <= MAX_SAFE_INT):
            raise CanonReject("INT_OUT_OF_SAFE_RANGE", str(value))
        return str(value)
    if isinstance(value, float):
        raise CanonReject("FLOAT_FORBIDDEN", repr(value))
    if isinstance(value, str):
        return _escape_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canon(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        items = []
        seen: set[str] = set()
        for k in value:
            if not isinstance(k, str):
                raise CanonReject("NON_STRING_KEY", repr(k))
            if k in seen:  # defensiv; dict dedupliziert bereits
                raise CanonReject("DUPLICATE_KEY", k)
            seen.add(k)
        for k in sorted(value.keys(), key=_utf16_sort_key):
            items.append(_escape_string(k) + ":" + _canon(value[k], depth + 1))
        return "{" + ",".join(items) + "}"
    raise CanonReject("UNSUPPORTED_TYPE", type(value).__name__)


def canonicalize(value: object) -> bytes:
    """Kanonische UTF-8-Bytes eines CWAP-Strict-JSON-Werts (fail-closed)."""
    return _canon(value, 0).encode("utf-8")


def _structural_depth_gate(text: str) -> None:
    """F-02: strukturelle Tiefe VOR json.loads pruefen (kein RecursionError).

    Zaehlt [/{-Nesting ausserhalb von String-Literalen. Bewusst tolerant
    gegenueber sonstiger Syntax (das entscheidet json.loads); nur die Tiefe
    wird hier deterministisch gedeckelt.
    """
    depth = 0
    in_str = False
    esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "[{":
            depth += 1
            if depth > MAX_DEPTH:
                raise CanonReject("DEPTH_EXCEEDED", f">{MAX_DEPTH}")
        elif ch in "]}":
            if depth > 0:
                depth -= 1


def _reject_float(_: str) -> float:
    raise CanonReject("FLOAT_FORBIDDEN", "float token im Eingabetext")


def _pairs_hook(pairs: list[tuple[str, object]]) -> dict[str, object]:
    d: dict[str, object] = {}
    for k, v in pairs:
        if k in d:
            raise CanonReject("DUPLICATE_KEY", k)
        d[k] = v
    return d


def parse_strict(text: str | bytes) -> object:
    """JSON-Text streng parsen: Duplikat-Keys, Floats, NaN/Inf, Tiefe -> REJECT."""
    if isinstance(text, bytes):
        try:
            text = text.decode("utf-8", errors="strict")
        except UnicodeDecodeError as e:
            raise CanonReject("INVALID_UTF8", str(e)) from e
    _structural_depth_gate(text)
    try:
        return json.loads(
            text,
            parse_float=_reject_float,
            parse_constant=lambda tok: (_ for _ in ()).throw(
                CanonReject("NONFINITE_FORBIDDEN", tok)),
            object_pairs_hook=_pairs_hook,
        )
    except CanonReject:
        raise
    except (json.JSONDecodeError, RecursionError) as e:
        raise CanonReject("INVALID_JSON", str(e)) from e


def recanonicalize(text: str | bytes) -> bytes:
    """Strenges Parsen + Kanonisieren in einem Schritt (Verifier-Eingang)."""
    return canonicalize(parse_strict(text))


if __name__ == "__main__":  # CLI fuer Differential-Runner: stdin -> stdout
    import sys
    data = sys.stdin.buffer.read()
    try:
        sys.stdout.buffer.write(recanonicalize(data))
    except CanonReject as e:
        sys.stderr.write(e.code)
        sys.exit(1)
