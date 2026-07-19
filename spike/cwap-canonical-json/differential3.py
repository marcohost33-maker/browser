"""CWAP v0.1.2-r1 — 3-Wege-Differential: Python vs. Rust vs. JS (D4).

Gleicher deterministischer Korpus wie differential.py (seed 20260719).
Anforderung: alle drei Implementationen muessen in Entscheid, Kanonbytes,
Reject-Code und Idempotenz uebereinstimmen.

Coworker Research / Coworkerz | 2026-07-19 | differential3.py v1.0
"""
from __future__ import annotations
import base64, hashlib, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cwap_strict_json import CanonReject, recanonicalize
import differential as D  # Korpus-Generator wiederverwenden (seed-identisch)

HERE = os.path.dirname(os.path.abspath(__file__))
RUST = os.path.join(HERE, "rust", "cwap_rs")
NODE_BATCH = os.path.join(HERE, "js", "batch.mjs")

def run_python(data: bytes):
    try:
        return ("A", recanonicalize(data))
    except CanonReject as e:
        return ("R", e.code)
    except Exception as e:
        return ("C", f"{type(e).__name__}: {e}")

def run_rust(data: bytes):
    p = subprocess.run([RUST], input=data, capture_output=True, timeout=20)
    if p.returncode == 0:
        return ("A", p.stdout)
    if p.returncode == 1:
        return ("R", p.stderr.decode())
    return ("C", f"exit {p.returncode}")

class NodeBatch:
    def __init__(self):
        self.p = subprocess.Popen(["node", NODE_BATCH], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=False)
    def run(self, data: bytes):
        self.p.stdin.write(base64.b64encode(data) + b"\n"); self.p.stdin.flush()
        line = self.p.stdout.readline().decode().rstrip("\n")
        if not line:  # Node-Prozess tot -> harter Fehler statt Fehlklassifikation
            raise RuntimeError(f"NodeBatch: Prozess beendet (rc={self.p.poll()})")
        tag, _, rest = line.partition(" ")
        if tag == "A":
            return ("A", base64.b64decode(rest))
        if tag == "R":
            return ("R", rest)
        return ("C", rest)

def main() -> int:
    node = NodeBatch()
    report = {"seed": D.SEED, "total": 0, "agree": 0, "accept": 0, "reject": 0,
              "reject_codes": {}, "divergences": []}
    h = hashlib.sha256()
    cases: list[tuple[str, bytes]] = []
    for name, data in D.HAND:
        cases.append((f"hand_{name}", data))
    for i in range(400):
        cases.append((f"randvalid_{i:03d}", D.serialize_loose(D.gen_random_value(0))))
    seeds = [d for _, d in D.HAND[:20]] + [D.serialize_loose(D.gen_random_value(0)) for _ in range(30)]
    for i in range(3000):
        cases.append((f"fuzz_{i:04d}", D.mutate(D.rng.choice(seeds))))

    for name, data in cases:
        py, rs, js = run_python(data), run_rust(data), node.run(data)
        report["total"] += 1
        ok = py == rs == js
        if ok and py[0] == "A":
            # 3-seitige Idempotenz
            c = py[1]
            ok = run_python(c) == run_rust(c) == node.run(c) == ("A", c)
        if ok:
            report["agree"] += 1
            if py[0] == "A":
                report["accept"] += 1; h.update(py[1])
            else:
                report["reject"] += 1
                report["reject_codes"][py[1]] = report["reject_codes"].get(py[1], 0) + 1
        else:
            report["divergences"].append({
                "case": name,
                "py": [py[0], py[1].hex()[:32] if isinstance(py[1], bytes) else py[1]],
                "rs": [rs[0], rs[1].hex()[:32] if isinstance(rs[1], bytes) else rs[1]],
                "js": [js[0], js[1].hex()[:32] if isinstance(js[1], bytes) else js[1]],
                "input_b64": base64.b64encode(data).decode()[:120],
            })
    report["accept_canon_sha256"] = h.hexdigest()
    nd = len(report["divergences"])
    report["verdict"] = "GRUEN" if nd == 0 else f"ROT ({nd} Divergenzen)"
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(os.path.join(HERE, "results", "differential3-report.json"), "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: v for k, v in report.items() if k != "divergences"},
                     indent=2, ensure_ascii=False))
    for d in report["divergences"][:10]:
        print(" DIV:", d)
    return 0 if nd == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
