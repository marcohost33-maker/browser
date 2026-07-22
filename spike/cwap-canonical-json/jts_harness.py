"""JSONTestSuite (nst, 'Parsing JSON is a Minefield') — 3-Wege-Konformitaet.

Regeln:
  y_*  (muss-gueltig per RFC 8259): 3-Wege-Agreement; ACCEPT oder REJECT
       ausschliesslich mit CWAP-SEMANTIK-Codes (FLOAT_FORBIDDEN,
       INT_OUT_OF_SAFE_RANGE, NONFINITE_FORBIDDEN, DUPLICATE_KEY,
       LONE_SURROGATE, DEPTH_EXCEEDED). INVALID_JSON/INVALID_UTF8 auf
       einem y_-File waere ein Parser-BUG -> FAIL.
  n_*  (muss-ungueltig): 3-Wege-Agreement + REJECT (beliebiger Code).
  i_*  (implementierungsdefiniert): 3-Wege-Agreement genuegt.

Coworker Research / Coworkerz | 2026-07-19 | jts_harness.py v1.0
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from differential3 import NodeBatch, run_python, run_rust

JTS = os.environ.get("JTS_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "testdata-jsontestsuite", "test_parsing"))
SEMANTIC = {"FLOAT_FORBIDDEN", "INT_OUT_OF_SAFE_RANGE", "NONFINITE_FORBIDDEN",
            "DUPLICATE_KEY", "LONE_SURROGATE", "DEPTH_EXCEEDED"}

def main() -> int:
    node = NodeBatch()
    stats = {"files": 0, "agree": 0, "y_ok": 0, "y_bug": [], "n_ok": 0,
             "n_bug": [], "i_ok": 0, "divergences": [], "y_reject_codes": {}}
    for fn in sorted(os.listdir(JTS)):
        if not fn.endswith(".json"):
            continue
        data = open(os.path.join(JTS, fn), "rb").read()
        py, rs, js = run_python(data), run_rust(data), node.run(data)
        stats["files"] += 1
        if not (py == rs == js):
            stats["divergences"].append({"file": fn,
                "py": [py[0], str(py[1])[:60]], "rs": [rs[0], str(rs[1])[:60]],
                "js": [js[0], str(js[1])[:60]]})
            continue
        stats["agree"] += 1
        s, v = py
        if fn.startswith("y_"):
            if s == "A" or (s == "R" and v in SEMANTIC):
                stats["y_ok"] += 1
                if s == "R":
                    stats["y_reject_codes"][v] = stats["y_reject_codes"].get(v, 0) + 1
            else:
                stats["y_bug"].append({"file": fn, "res": [s, str(v)[:60]]})
        elif fn.startswith("n_"):
            if s == "R":
                stats["n_ok"] += 1
            else:
                stats["n_bug"].append({"file": fn, "res": [s, str(v)[:80]]})
        else:
            stats["i_ok"] += 1
    nd = len(stats["divergences"]); nyb = len(stats["y_bug"]); nnb = len(stats["n_bug"])
    stats["verdict"] = "GRUEN" if nd == nyb == nnb == 0 else f"ROT (div={nd} ybug={nyb} nbug={nnb})"
    json.dump(stats, open("results/jsontestsuite-report.json", "w"), indent=2)
    print(json.dumps({k: v for k, v in stats.items()
                      if k not in ("divergences", "y_bug", "n_bug")}, indent=2))
    for k in ("divergences", "y_bug", "n_bug"):
        for e in stats[k][:8]:
            print(f" {k}:", e)
    return 0 if stats["verdict"] == "GRUEN" else 1

if __name__ == "__main__":
    sys.exit(main())
