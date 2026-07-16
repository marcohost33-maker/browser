#!/usr/bin/env python3
"""repo_standard14_detektor.py -- Existenz-/Content-SIGNAL-Detektor fuer REPO_STANDARD_14.

Misst EXISTENZ + Content-Signal je Standard-Element, NICHT Qualitaet. Gibt je Element
ein SIGNAL aus (present_nonempty | present_empty | absent), NIE ein Verdikt: kein
"PASS/gruen/erfuellt/OK". "erfuellt" ist Equalitas Domaene; dies ist Monitoring.
Reuse-Muster: coworkerz-validator/scripts/forschungswissen_validate.py (stdlib + PyYAML).

Modi:
  (default)  Monitoring -> JSON(stdout) + 1-Zeilen-Summary(stderr). Exit 0 (Score-
             unabhaengig; !=0 NUR bei echtem Fehler, z.B. kaputte YAML).
  --gate     Hook-Enforcement (lefthook pre-push) -> Exit-Code nach yaml `hook`-Politik.
             Der Gate URTEILT (advisory); der Detektor selbst nicht.

YAML-Standard-Pfad: --standard ARG > $REPO_STANDARD14_YAML > Vero-Meta-Default.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("FEHLER: PyYAML noetig (py -m pip install pyyaml)\n")
    sys.exit(2)

DEFAULT_YAML = os.environ.get(
    "REPO_STANDARD14_YAML",
    r"G:/Meine Ablage/Vero/Vero Meta/REPO_STANDARD_14.yaml",
)
REIF_ORDER = ["scaffold", "jung", "aktiv", "stabil"]
GITKEEP = {".gitkeep", ".keep"}
PFLICHT_KERN = {1, 2, 3, 14}


# --------------------------------------------------------------------------- #
# Repo-Zugriff + Grammatik-Primitive (detektor_grammar aus dem Standard)
# --------------------------------------------------------------------------- #
class Repo:
    def __init__(self, root: Path):
        self.root = root
        self.files = [
            p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts
        ]
        self._text: dict[Path, str] = {}

    def _read(self, p: Path) -> str:
        if p not in self._text:
            try:
                self._text[p] = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                self._text[p] = ""
        return self._text[p]

    def exists(self, path: str) -> bool:
        return (self.root / path).exists()

    def non_empty(self, path: str) -> bool:
        if path.startswith("glob:"):
            return any(self._read(p).strip() for p in self._glob(path[5:]))
        p = self.root / path
        return p.is_file() and bool(self._read(p).strip())

    def non_empty_nongitkeep(self, d: str) -> bool:
        base = self.root / d
        if not base.is_dir():
            return False
        return any(
            p.is_file() and ".git" not in p.parts and p.name not in GITKEEP
            for p in base.rglob("*")
        )

    def _glob(self, pattern: str) -> list[Path]:
        return [p for p in self.root.glob(pattern) if p.is_file()]

    def count(self, pattern: str) -> int:
        return len(self._glob(pattern))

    def _scope_text(self, scope: str) -> str:
        if scope in ("README", "readme"):
            p = self.root / "README.md"
            return self._read(p) if p.is_file() else ""
        if scope == "any":
            return "\n".join(self._read(p) for p in self.files)
        p = self.root / scope  # scope ist ein konkreter Pfad (z.B. path_ctx)
        return self._read(p) if p.is_file() else ""

    def contains(self, needle: str, scope: str, n: int = 1) -> bool:
        return len(re.findall(needle, self._scope_text(scope))) >= n


# --------------------------------------------------------------------------- #
# Mini-Interpreter fuer die boolesche Detektor-DSL
# --------------------------------------------------------------------------- #
def split_top(s: str, op: str) -> list[str]:
    """Splitte s bei `op` (&&/||) auf Klammer-/Quote-Tiefe 0."""
    parts, depth, last, i, q = [], 0, 0, 0, None
    while i < len(s):
        c = s[i]
        if q:
            if c == q:
                q = None
        elif c in "'\"":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and s[i : i + len(op)] == op:
            parts.append(s[last:i])
            i += len(op)
            last = i
            continue
        i += 1
    parts.append(s[last:])
    return [p.strip() for p in parts]


def split_args(arg: str) -> list[str]:
    """Splitte Funktions-Argumente bei Top-Level-Komma (Quotes/Klammern schuetzen)."""
    return [a for a in split_top(arg, ",")] if arg else []


def parse_call(a: str) -> tuple[str, str | None]:
    m = re.match(r"^(\w+)\((.*)\)$", a, re.S)
    if m:
        return m.group(1), m.group(2).strip()
    return a, None  # bare Wort (exists / non_empty)


def as_regex(needle: str) -> str:
    n = needle.strip()
    if len(n) >= 2 and n[0] == n[-1] and n[0] in "'\"":
        return n[1:-1]          # gequotet
    if len(n) >= 2 and n[0] == "/" and n[-1] == "/":
        return n[1:-1]          # /regex/
    return n                     # bare (build|test|run, Zweck, Non-Goal, ...)


def unglob(arg: str) -> str:
    m = re.search(r"glob\(\s*['\"](.+?)['\"]\s*\)", arg)
    return m.group(1) if m else arg


def primary_path(ort: str) -> str:
    return ort.split("|")[0].strip().split()[0]


def eval_atom(atom: str, repo: Repo, ort: str, path_ctx: str) -> tuple[bool, str]:
    a = atom.strip()
    neg = a.startswith("!")
    if neg:
        a = a[1:].strip()
    cmp = re.match(r"^(.*?)\s*>=\s*(\d+)$", a)
    if cmp:
        fn, arg = parse_call(cmp.group(1).strip())
        n = int(cmp.group(2))
        if fn == "count":
            res = repo.count(unglob(arg)) >= n
        else:
            raise ValueError(f"Vergleich nur fuer count(): {atom}")
    else:
        fn, arg = parse_call(a)
        if fn == "exists":
            if arg is None:
                path_ctx = primary_path(ort)
                res = repo.exists(path_ctx)
            elif arg.startswith("glob"):
                res = repo.count(unglob(arg)) > 0
            else:
                path_ctx = as_regex(arg)
                res = repo.exists(path_ctx)
        elif fn == "non_empty":
            if arg is None:
                res = repo.non_empty(path_ctx)
            elif arg.startswith("glob"):
                res = repo.non_empty("glob:" + unglob(arg))
            else:
                res = repo.non_empty(as_regex(arg))
        elif fn == "non_empty_nongitkeep":
            res = repo.non_empty_nongitkeep(as_regex(arg))
        elif fn == "contains":
            args = split_args(arg)
            if len(args) == 1:
                scope, needle = path_ctx, args[0]  # 1-arg: aktuelles Element-File
            else:
                scope, needle = as_regex(args[0]), args[1]
            res = repo.contains(as_regex(needle), scope)
        elif fn == "contains_min":
            args = split_args(arg)
            res = repo.contains(as_regex(args[1]), as_regex(args[0]), int(args[2]))
        else:
            raise ValueError(f"Unbekannter Detektor-Atom: {atom!r}")
    return ((not res) if neg else res), path_ctx


def eval_rule(rule: str, repo: Repo, ort: str) -> bool:
    for term in split_top(rule, "||"):          # || bindet loser als &&
        path_ctx = primary_path(ort)
        ok = True
        for atom in split_top(term, "&&"):
            val, path_ctx = eval_atom(atom, repo, ort, path_ctx)
            if not val:
                ok = False
                break
        if ok:
            return True
    return False


# --------------------------------------------------------------------------- #
# Existenz-Sonde (fuer 3-Wert-Signal) + Typ/Reifegrad-Heuristik
# --------------------------------------------------------------------------- #
def artifact_present(ort: str, repo: Repo) -> bool:
    """Existiert ein konkretes Artefakt des Elements (Datei da / Dir non-gitkeep)?"""
    for raw in re.split(r"[|+]", ort):
        for tok in raw.split():
            if not ("/" in tok or tok.endswith(".md") or "*" in tok):
                continue
            if "*" in tok:
                if repo.count(tok) > 0:
                    return True
            elif tok.endswith("/"):
                if repo.non_empty_nongitkeep(tok):
                    return True
            elif (repo.root / tok).exists():
                return True
    return False


def determine_typ(repo: Repo, std: dict) -> tuple[str, str | None]:
    ca = repo.root / ".copier-answers.yml"
    if not ca.is_file():
        return "software", "typ_unbekannt"
    ans = yaml.safe_load(repo._read(ca)) or {}
    rt = ans.get("repo_type")
    mapping = std.get("typ_mapping_copier_to_yaml", {})
    if rt in mapping:
        return mapping[rt], None
    return "software", "typ_unbekannt"


def determine_reifegrad(repo: Repo) -> str:
    # Heuristik: `reifegrad: <wert>` in README.md oder 00_landkarte/README.md
    # (Frontmatter ODER Fliesstext); sonst Default 'jung'.
    for rel in ("README.md", "00_landkarte/README.md"):
        p = repo.root / rel
        if p.is_file():
            m = re.search(
                r"reifegrad\s*[:=]\s*['\"]?(scaffold|jung|aktiv|stabil)", repo._read(p)
            )
            if m:
                return m.group(1)
    return "jung"


def required(code: str, reif: str, reif_ab: str) -> bool:
    if code == "na":
        return False
    if REIF_ORDER.index(reif) < REIF_ORDER.index(reif_ab):
        return False          # Element ab diesem Reifegrad noch nicht erwartet
    if code == "G":
        return REIF_ORDER.index(reif) >= REIF_ORDER.index("aktiv")
    return True               # P oder Ps


# --------------------------------------------------------------------------- #
# Analyse + Ausgabe
# --------------------------------------------------------------------------- #
def analyze(repo_path: str, yaml_path: str) -> dict:
    root = Path(repo_path).resolve()
    if not root.is_dir():
        raise ValueError(f"Repo-Pfad ist kein Verzeichnis: {repo_path}")
    std = yaml.safe_load(Path(yaml_path).read_text(encoding="utf-8"))
    repo = Repo(root)
    typ, typ_signal = determine_typ(repo, std)
    reif = determine_reifegrad(repo)
    records = []
    for el in std["elements"]:
        rule_ok = eval_rule(el["detektor"], repo, el["ort"])
        present = artifact_present(el["ort"], repo)
        signal = "present_nonempty" if rule_ok else (
            "present_empty" if present else "absent"
        )
        code = el["typ_pflicht"].get(typ, "na")
        req = required(code, reif, el["reifegrad_ab"])
        records.append(
            {
                "repo": repo.root.name,
                "element": el["name"],
                "signal": signal,
                "wert": {
                    "id": el["id"],
                    "rule_true": rule_ok,
                    "typ_pflicht": code,
                    "required": req,
                    "reifegrad_ab": el["reifegrad_ab"],
                },
            }
        )
    req_recs = [r for r in records if r["wert"]["required"]]
    n = len(req_recs)
    x = sum(1 for r in req_recs if r["signal"] == "present_nonempty")
    return {
        "repo": repo.root.name,
        "typ": typ,
        "typ_signal": typ_signal,
        "reifegrad": reif,
        "summary": f"{x}/{n} typ-pflicht present_nonempty",
        "records": records,
    }


def gate(repo_path: str, result: dict) -> int:
    """Hook-Politik aus yaml `hook`. Exit 1 = block, 0 = ok (WARN nicht-blockend)."""
    root = Path(repo_path)
    rc = 0
    # 1) copier-Konflikt-Marker im Tree (Bundle-Dir .repostandard14 ausgeschlossen:
    #    enthaelt Detektor+Standard, die den Marker legitim als String fuehren -> Self-Collision)
    for p in root.rglob("*"):
        if p.is_file() and ".git" not in p.parts and ".repostandard14" not in p.parts:
            try:
                if "<" * 7 in p.read_text(encoding="utf-8", errors="ignore"):
                    sys.stderr.write(f"[GATE-BLOCK] Konflikt-Marker in {p}\n")
                    rc = 1
            except OSError:
                pass
    by_id = {r["wert"]["id"]: r for r in result["records"]}
    # 2) Pflicht-Kern #1/#2/#3/#14 == absent -> hard fail
    for i in sorted(PFLICHT_KERN):
        r = by_id.get(i)
        if r and r["signal"] == "absent":
            sys.stderr.write(
                f"[GATE-BLOCK] Pflicht-Kern #{i} ({r['element']}) == absent\n"
            )
            rc = 1
    # 3) WARN (nicht-blockend): aktiv/stabil & required != present_nonempty
    if result["reifegrad"] in ("aktiv", "stabil"):
        for r in result["records"]:
            if r["wert"]["required"] and r["signal"] != "present_nonempty":
                sys.stderr.write(
                    f"[GATE-WARN] {r['element']} = {r['signal']} "
                    f"(reifegrad={result['reifegrad']})\n"
                )
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("repo", nargs="?", default=".", help="Pfad zum Repo-Verzeichnis")
    ap.add_argument("--standard", default=DEFAULT_YAML, help="Pfad zu REPO_STANDARD_14.yaml")
    ap.add_argument("--gate", action="store_true", help="Hook-Enforcement-Modus")
    args = ap.parse_args(argv)
    try:
        result = analyze(args.repo, args.standard)
    except (yaml.YAMLError, OSError, ValueError, KeyError) as e:
        sys.stderr.write(f"FEHLER (Detektor-Lauf): {e}\n")
        return 2
    if args.gate:
        return gate(args.repo, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    extra = f" [{result['typ_signal']}]" if result["typ_signal"] else ""
    sys.stderr.write(
        f"{result['repo']}: {result['summary']} "
        f"(typ={result['typ']}{extra}, reifegrad={result['reifegrad']})\n"
    )
    return 0  # Monitoring urteilt nicht -> immer 0 (ausser echter Fehler oben)


if __name__ == "__main__":
    raise SystemExit(main())
