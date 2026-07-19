// CWAP-Strict-JSON v0.1.2-r1 — JS-Drittimplementation (unabhaengig).
//
// ZERO dependencies (nur Node-Std), EIGENER Tokenizer/Parser. Normativ
// zwingend (Addendum F-04): JSON.parse ist fuer den Accept-Pfad VERBOTEN,
// weil es (a) grosse Ganzzahlen still auf Doubles rundet — 2^53+1 wird
// unerkennbar zu 2^53 — und damit INT_OUT_OF_SAFE_RANGE nicht erkennbar
// macht, und (b) 1.0 und 1 nach dem Parsen ununterscheidbar sind, womit
// FLOAT_FORBIDDEN unpruefbar wuerde. Integer-Tokens laufen ueber BigInt.
//
// Vertrag identisch zu cwap_strict_json.py / cwap_strict_json.rs v0.1.2-r1,
// inklusive Fehlerpraezedenz P1-P4:
//   P1 INVALID_UTF8 (TextDecoder fatal)
//   P2 DEPTH_EXCEEDED (strukturelles Pre-Gate > 64)
//   P3 Scan-Ordnung: FLOAT_FORBIDDEN / NONFINITE_FORBIDDEN an Token-
//      Position; DUPLICATE_KEY beim schliessenden '}'; sonst INVALID_JSON.
//   P4 Kanon-Traversierung: LONE_SURROGATE (Keys in Einfuege-Ordnung vor
//      Werten), INT_OUT_OF_SAFE_RANGE (|n| > 2^53-1).
// Interne String-Repraesentation: native JS-Strings = UTF-16-Code-Units
// (lone surrogates zulaessig bis zum Kanon — exakt wie Rust Vec<u16>).
// Key-Sortierung: JS-Default-Stringvergleich ist Code-Unit-Ordnung und
// damit direkt RFC-8785-konform.
//
// CLI: stdin -> Kanonbytes auf stdout (exit 0) oder Reject-Code auf
// stderr (exit 1).
//
// Coworker Research / Coworkerz | 2026-07-19 | cwap_strict_json.mjs v0.1.2-r1

const MAX_SAFE = 9007199254740991n; // 2^53 - 1
const MAX_DEPTH = 64;

class CanonReject extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

// ------------------------------------------------- P2: strukturelles Gate

function structuralDepthGate(text) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") {
      if (++depth > MAX_DEPTH) throw new CanonReject("DEPTH_EXCEEDED", `>${MAX_DEPTH}`);
    } else if (ch === "]" || ch === "}") {
      if (depth > 0) depth--;
    }
  }
}

// ----------------------------------------------------------------- Parser

class Parser {
  constructor(text) { this.t = text; this.i = 0; }
  peek() { return this.i < this.t.length ? this.t[this.i] : undefined; }
  bump() { return this.i < this.t.length ? this.t[this.i++] : undefined; }
  skipWs() {
    while (" \t\n\r".includes(this.peek() ?? "\x00") && this.peek() !== undefined) this.i++;
  }
  expect(lit) {
    if (this.t.startsWith(lit, this.i)) { this.i += lit.length; return; }
    throw new CanonReject("INVALID_JSON");
  }

  parseValue() {
    this.skipWs();
    const c = this.peek();
    if (c === undefined) throw new CanonReject("INVALID_JSON");
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') return { k: "str", v: this.parseString() };
    if (c === "t") { this.expect("true"); return { k: "bool", v: true }; }
    if (c === "f") { this.expect("false"); return { k: "bool", v: false }; }
    if (c === "n") { this.expect("null"); return { k: "null" }; }
    if (c === "N") { this.expect("NaN"); throw new CanonReject("NONFINITE_FORBIDDEN"); }
    if (c === "I") { this.expect("Infinity"); throw new CanonReject("NONFINITE_FORBIDDEN"); }
    if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
    throw new CanonReject("INVALID_JSON");
  }

  parseObject() {
    this.bump(); // '{'
    const pairs = []; // [key, value] in Einfuege-Ordnung
    this.skipWs();
    if (this.peek() === "}") { this.bump(); return { k: "obj", v: pairs }; }
    for (;;) {
      this.skipWs();
      if (this.peek() !== '"') throw new CanonReject("INVALID_JSON");
      const key = this.parseString();
      this.skipWs();
      if (this.bump() !== ":") throw new CanonReject("INVALID_JSON");
      pairs.push([key, this.parseValue()]);
      this.skipWs();
      const d = this.bump();
      if (d === ",") continue;
      if (d === "}") {
        // DUPLICATE_KEY erst beim Objekt-Ende (P3, CPython-Hook-Semantik)
        const seen = new Set();
        for (const [k] of pairs) {
          if (seen.has(k)) throw new CanonReject("DUPLICATE_KEY", k);
          seen.add(k);
        }
        return { k: "obj", v: pairs };
      }
      throw new CanonReject("INVALID_JSON");
    }
  }

  parseArray() {
    this.bump(); // '['
    const out = [];
    this.skipWs();
    if (this.peek() === "]") { this.bump(); return { k: "arr", v: out }; }
    for (;;) {
      out.push(this.parseValue());
      this.skipWs();
      const d = this.bump();
      if (d === ",") continue;
      if (d === "]") return { k: "arr", v: out };
      throw new CanonReject("INVALID_JSON");
    }
  }

  parseNumber() {
    const start = this.i;
    if (this.peek() === "-") {
      this.bump();
      if (this.peek() === "I") { // "-Infinity" wie CPython-Konstante
        this.expect("Infinity");
        throw new CanonReject("NONFINITE_FORBIDDEN");
      }
    }
    const d0 = this.peek();
    if (d0 === "0") {
      this.bump();
      const nx = this.peek();
      if (nx >= "0" && nx <= "9") throw new CanonReject("INVALID_JSON"); // fuehrende Null
    } else if (d0 >= "1" && d0 <= "9") {
      while (this.peek() >= "0" && this.peek() <= "9") this.bump();
    } else {
      throw new CanonReject("INVALID_JSON");
    }
    const nx = this.peek();
    if (nx === "." || nx === "e" || nx === "E") {
      // Float-Token-Gueltigkeit: gueltig -> FLOAT_FORBIDDEN (P3), sonst INVALID_JSON
      let j = this.i, ok = true;
      const t = this.t;
      if (t[j] === ".") {
        j++;
        const s0 = j;
        while (t[j] >= "0" && t[j] <= "9") j++;
        if (j === s0) ok = false;
      }
      if (ok && (t[j] === "e" || t[j] === "E")) {
        j++;
        if (t[j] === "+" || t[j] === "-") j++;
        const s0 = j;
        while (t[j] >= "0" && t[j] <= "9") j++;
        if (j === s0) ok = false;
      }
      throw new CanonReject(ok ? "FLOAT_FORBIDDEN" : "INVALID_JSON");
    }
    // BigInt: verlustfrei, Range-Check erst im Kanon (P4). Der Betrag darf
    // beliebig gross sein — genau der Fall, den JSON.parse still korrumpiert.
    return { k: "int", v: BigInt(this.t.slice(start, this.i)) };
  }

  hex4() {
    let v = 0;
    for (let n = 0; n < 4; n++) {
      const c = this.bump();
      if (c === undefined) throw new CanonReject("INVALID_JSON");
      const d = parseInt(c, 16);
      if (Number.isNaN(d) || !/^[0-9a-fA-F]$/.test(c)) throw new CanonReject("INVALID_JSON");
      v = (v << 4) | d;
    }
    return v;
  }

  parseString() {
    this.bump(); // '"'
    let s = "";
    for (;;) {
      const c = this.bump();
      if (c === undefined) throw new CanonReject("INVALID_JSON");
      if (c === '"') return s;
      if (c === "\\") {
        const e = this.bump();
        switch (e) {
          case '"': s += '"'; break;
          case "\\": s += "\\"; break;
          case "/": s += "/"; break;
          case "b": s += "\b"; break;
          case "f": s += "\f"; break;
          case "n": s += "\n"; break;
          case "r": s += "\r"; break;
          case "t": s += "\t"; break;
          case "u": s += String.fromCharCode(this.hex4()); break; // Unit roh
          default: throw new CanonReject("INVALID_JSON");
        }
        continue;
      }
      const cu = c.charCodeAt(0);
      if (cu <= 0x1f) throw new CanonReject("INVALID_JSON"); // rohe Controls
      s += c; // native UTF-16-Units (Astral-Zeichen = 2 Units, korrekt)
    }
  }
}

function parseStrict(buf) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); // P1 (F-05: ignoreBOM=true PFLICHT — sonst strippt der Host-Decoder U+FEFF still und "\ufeff{}" wuerde faelschlich akzeptiert)
  } catch {
    throw new CanonReject("INVALID_UTF8");
  }
  structuralDepthGate(text); // P2
  const p = new Parser(text);
  const v = p.parseValue(); // P3
  p.skipWs();
  if (p.i !== text.length) throw new CanonReject("INVALID_JSON"); // trailing
  return v;
}

// ----------------------------------------------------------- Kanonisierer

const SHORT = new Map([
  [0x08, "\\b"], [0x09, "\\t"], [0x0a, "\\n"], [0x0c, "\\f"], [0x0d, "\\r"],
  [0x22, '\\"'], [0x5c, "\\\\"],
]);

function assertNoLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      const l = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (l >= 0xdc00 && l <= 0xdfff) { i++; continue; }
      throw new CanonReject("LONE_SURROGATE", `U+${u.toString(16).toUpperCase()}`);
    }
    if (u >= 0xdc00 && u <= 0xdfff) {
      throw new CanonReject("LONE_SURROGATE", `U+${u.toString(16).toUpperCase()}`);
    }
  }
}

function escapeString(s, out) {
  out.push('"');
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    const sh = SHORT.get(u);
    if (sh !== undefined) { out.push(sh); continue; }
    if (u < 0x20) { out.push("\\u" + u.toString(16).padStart(4, "0")); continue; }
    if (u >= 0xd800 && u <= 0xdbff) {
      const l = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (l >= 0xdc00 && l <= 0xdfff) { out.push(s[i] + s[i + 1]); i++; continue; }
      throw new CanonReject("LONE_SURROGATE");
    }
    if (u >= 0xdc00 && u <= 0xdfff) throw new CanonReject("LONE_SURROGATE");
    out.push(s[i]); // unescaped; UTF-8 entsteht beim finalen Encode
  }
  out.push('"');
}

function canon(node, depth, out) {
  if (depth > MAX_DEPTH) throw new CanonReject("DEPTH_EXCEEDED", `>${MAX_DEPTH}`);
  switch (node.k) {
    case "null": out.push("null"); return;
    case "bool": out.push(node.v ? "true" : "false"); return;
    case "int": {
      const n = node.v;
      if (n > MAX_SAFE || n < -MAX_SAFE) {
        throw new CanonReject("INT_OUT_OF_SAFE_RANGE", n.toString());
      }
      out.push(n.toString()); // BigInt.toString: exakt, kein Exponent
      return;
    }
    case "str": escapeString(node.v, out); return;
    case "arr": {
      out.push("[");
      node.v.forEach((e, i) => { if (i) out.push(","); canon(e, depth + 1, out); });
      out.push("]");
      return;
    }
    case "obj": {
      // P4: Surrogat-Pruefung ALLER Keys in Einfuege-Ordnung VOR Sortierung
      for (const [k] of node.v) assertNoLoneSurrogate(k);
      // JS-Default-Vergleich '<' auf Strings = UTF-16-Code-Unit-Ordnung
      const idx = node.v.map((_, i) => i)
        .sort((a, b) => (node.v[a][0] < node.v[b][0] ? -1 : node.v[a][0] > node.v[b][0] ? 1 : 0));
      out.push("{");
      idx.forEach((i, n) => {
        if (n) out.push(",");
        escapeString(node.v[i][0], out);
        out.push(":");
        canon(node.v[i][1], depth + 1, out);
      });
      out.push("}");
      return;
    }
  }
  throw new CanonReject("UNSUPPORTED_TYPE", node.k);
}

export function recanonicalize(buf) {
  const v = parseStrict(buf);
  const out = [];
  canon(v, 0, out);
  return Buffer.from(out.join(""), "utf-8");
}

// ---------------------------------------------------------------- CLI
import { readFileSync } from "node:fs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = readFileSync(0); // stdin als Buffer (Bytes, nicht String)
  try {
    process.stdout.write(recanonicalize(input));
  } catch (e) {
    if (e instanceof CanonReject) {
      process.stderr.write(e.code);
      process.exit(1);
    }
    process.stderr.write("CRASH:" + String(e));
    process.exit(2);
  }
}
