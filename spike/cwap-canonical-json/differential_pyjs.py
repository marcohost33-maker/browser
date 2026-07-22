#!/usr/bin/env python3
"""Unabhaengige Verifikation (Vero): Python-Referenz vs. JS-Drittimpl.
Reproduziert den differential.py-Korpus (seed 20260719) exakt und vergleicht
gegen js/batch.mjs (ein node-Prozess). Erwartung: 0 Divergenzen +
accept_canon_sha256 == 2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23.
"""
import base64, hashlib, json, os, random, subprocess, sys
import differential as D
from cwap_strict_json import CanonReject, recanonicalize

HERE = os.path.dirname(os.path.abspath(__file__))

def build_corpus():
    """Exakt die Reihenfolge aus differential.main()."""
    D.rng = random.Random(D.SEED)          # reseed identisch
    cases = []
    for name, data in D.HAND:
        cases.append((f"hand_{name}", data))
    for i in range(400):
        cases.append((f"randvalid_{i:03d}", D.serialize_loose(D.gen_random_value(0))))
    seeds = [data for _, data in D.HAND[:20]] + [
        D.serialize_loose(D.gen_random_value(0)) for _ in range(30)]
    for i in range(3000):
        cases.append((f"fuzz_{i:04d}", D.mutate(D.rng.choice(seeds))))
    return cases

def run_python(data):
    try:
        return ("ACCEPT", recanonicalize(data))
    except CanonReject as e:
        return ("REJECT", e.code)

def run_js_batch(cases):
    inp = "".join(base64.b64encode(d).decode() + "\n" for _, d in cases)
    p = subprocess.run(["node", os.path.join(HERE, "js", "batch.mjs")],
                       input=inp.encode(), capture_output=True, timeout=300)
    if p.returncode != 0:
        print("NODE STDERR:", p.stderr.decode()[:500]); sys.exit(2)
    out = []
    for line in p.stdout.decode().splitlines():
        tag, _, rest = line.partition(" ")
        if tag == "A":
            out.append(("ACCEPT", base64.b64decode(rest)))
        else:
            out.append(("REJECT", rest))
    return out

def main():
    cases = build_corpus()
    js = run_js_batch(cases)
    assert len(js) == len(cases), f"len mismatch {len(js)} vs {len(cases)}"
    rep = {"total": 0, "agree": 0, "accept": 0, "reject": 0,
           "reject_codes": {}, "divergences": [], "_h": hashlib.sha256()}
    for (name, data), (js_s, js_v) in zip(cases, js):
        ps, pv = run_python(data)
        rep["total"] += 1
        ok = (ps == js_s) and (pv == js_v)
        if ok:
            rep["agree"] += 1
            if ps == "ACCEPT":
                rep["accept"] += 1
                rep["_h"].update(pv)
            else:
                rep["reject"] += 1
                rep["reject_codes"][pv] = rep["reject_codes"].get(pv, 0) + 1
        else:
            rep["divergences"].append({"case": name, "py": ps,
                "js": js_s, "py_v": str(pv)[:60], "js_v": str(js_v)[:60]})
    sha = rep.pop("_h").hexdigest()
    rep["accept_canon_sha256"] = sha
    n = len(rep["divergences"])
    rep["verdict"] = "GRUEN" if n == 0 else f"ROT ({n})"
    print(json.dumps({k: v for k, v in rep.items() if k != "divergences"},
                     indent=2, ensure_ascii=False))
    for d in rep["divergences"][:10]:
        print(" DIV", d)
    return 0 if n == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
