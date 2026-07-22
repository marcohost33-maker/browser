//! CWAP-Strict-JSON v0.1.2-r1 — Rust-Zweitimplementation (unabhaengig).
//!
//! ZERO dependencies (nur std), eigener strikter JSON-Parser + Kanonisierer.
//! Absichtlich KEIN serde/serde_json: die Zweitimplementation dient dem
//! Differentialtest (D4) — geteilte Bibliotheken bedeuten geteilte Fehler
//! (N-Version-Prinzip).
//!
//! Vertrag identisch zur Python-Referenz cwap_strict_json.py v0.1.2-r1,
//! inklusive normativer FEHLERPRAEZEDENZ (Spec-Addendum F-03):
//!   P1 INVALID_UTF8 (ganzheitliche Dekodierung)
//!   P2 DEPTH_EXCEEDED (strukturelles Pre-Gate, > 64)
//!   P3 Scan-Reihenfolge: FLOAT_FORBIDDEN / NONFINITE_FORBIDDEN an der
//!      Token-Position; DUPLICATE_KEY beim schliessenden '}' des Objekts;
//!      jede Syntaxverletzung an ihrer Position -> INVALID_JSON.
//!   P4 Post-Parse (Kanon-Traversierung, Objekte in sortierter Key-Ordnung,
//!      Sort-Key-Berechnung in Einfuege-Ordnung): LONE_SURROGATE (Keys vor
//!      Werten), INT_OUT_OF_SAFE_RANGE.
//! Strings werden intern als UTF-16-Code-Units gefuehrt (lone surrogates
//! passieren den Parser wie in CPython und werden erst im Kanon rejected);
//! Ganzzahlen als i128+Overflow-Marker (Range-Check erst im Kanon).
//!
//! CLI: stdin -> Kanonbytes auf stdout (exit 0) oder Reject-Code auf
//! stderr (exit 1).
//!
//! Coworker Research / Coworkerz | 2026-07-19 | cwap_strict_json.rs v0.1.2-r1

use std::io::{Read, Write};

const MAX_SAFE_INT: i128 = (1i128 << 53) - 1;
const MAX_DEPTH: usize = 64;

#[derive(Debug)]
struct Reject(&'static str);

#[derive(Debug, Clone, Copy, PartialEq)]
enum Num { Small(i128), Overflow }

#[derive(Debug)]
enum Value {
    Null,
    Bool(bool),
    Int(Num),
    Str(Vec<u16>),                  // UTF-16-Units, lone surrogates erlaubt
    Arr(Vec<Value>),
    Obj(Vec<(Vec<u16>, Value)>),    // Einfuege-Reihenfolge
}

// -------------------------------------------------- P2: strukturelles Gate

fn structural_depth_gate(text: &str) -> Result<(), Reject> {
    let (mut depth, mut in_str, mut esc) = (0usize, false, false);
    for ch in text.chars() {
        if in_str {
            if esc { esc = false; }
            else if ch == '\\' { esc = true; }
            else if ch == '"' { in_str = false; }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '[' | '{' => {
                depth += 1;
                if depth > MAX_DEPTH { return Err(Reject("DEPTH_EXCEEDED")); }
            }
            ']' | '}' => { if depth > 0 { depth -= 1; } }
            _ => {}
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ Parser

struct Parser<'a> { b: &'a [u8], i: usize }

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> { self.b.get(self.i).copied() }
    fn bump(&mut self) -> Option<u8> { let c = self.peek(); if c.is_some() { self.i += 1; } c }
    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) { self.i += 1; }
    }
    fn expect(&mut self, lit: &[u8]) -> Result<(), Reject> {
        if self.b.len() >= self.i + lit.len() && &self.b[self.i..self.i + lit.len()] == lit {
            self.i += lit.len(); Ok(())
        } else { Err(Reject("INVALID_JSON")) }
    }

    fn parse_value(&mut self) -> Result<Value, Reject> {
        self.skip_ws();
        match self.peek() {
            None => Err(Reject("INVALID_JSON")),
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => Ok(Value::Str(self.parse_string()?)),
            Some(b't') => { self.expect(b"true")?; Ok(Value::Bool(true)) }
            Some(b'f') => { self.expect(b"false")?; Ok(Value::Bool(false)) }
            Some(b'n') => { self.expect(b"null")?; Ok(Value::Null) }
            Some(b'N') => { self.expect(b"NaN")?; Err(Reject("NONFINITE_FORBIDDEN")) }
            Some(b'I') => { self.expect(b"Infinity")?; Err(Reject("NONFINITE_FORBIDDEN")) }
            Some(b'-') | Some(b'0'..=b'9') => self.parse_number(),
            _ => Err(Reject("INVALID_JSON")),
        }
    }

    fn parse_object(&mut self) -> Result<Value, Reject> {
        self.bump(); // '{'
        let mut out: Vec<(Vec<u16>, Value)> = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.bump();
            return Ok(Value::Obj(out));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') { return Err(Reject("INVALID_JSON")); }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.bump() != Some(b':') { return Err(Reject("INVALID_JSON")); }
            let val = self.parse_value()?;
            out.push((key, val));
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b'}') => {
                    // DUPLICATE_KEY erst beim Objekt-Ende (Praezedenz P3,
                    // entspricht CPythons object_pairs_hook).
                    // F-06: sortbasiert O(n log n) statt O(n^2) — der
                    // urspruengliche Doppel-Loop war ein DoS-Vektor
                    // (60k Keys: 5.3s, empirisch 2026-07-19).
                    if out.len() > 1 {
                        let mut refs: Vec<&Vec<u16>> =
                            out.iter().map(|(k, _)| k).collect();
                        refs.sort_unstable();
                        for w in refs.windows(2) {
                            if w[0] == w[1] {
                                return Err(Reject("DUPLICATE_KEY"));
                            }
                        }
                    }
                    return Ok(Value::Obj(out));
                }
                _ => return Err(Reject("INVALID_JSON")),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, Reject> {
        self.bump(); // '['
        let mut out = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') { self.bump(); return Ok(Value::Arr(out)); }
        loop {
            out.push(self.parse_value()?);
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b']') => return Ok(Value::Arr(out)),
                _ => return Err(Reject("INVALID_JSON")),
            }
        }
    }

    fn parse_number(&mut self) -> Result<Value, Reject> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.bump();
            if self.peek() == Some(b'I') { // "-Infinity" wie CPython-Konstante
                self.expect(b"Infinity")?;
                return Err(Reject("NONFINITE_FORBIDDEN"));
            }
        }
        match self.peek() {
            Some(b'0') => {
                self.bump();
                if let Some(b'0'..=b'9') = self.peek() {
                    return Err(Reject("INVALID_JSON")); // fuehrende Null
                }
            }
            Some(b'1'..=b'9') => {
                while let Some(b'0'..=b'9') = self.peek() { self.bump(); }
            }
            _ => return Err(Reject("INVALID_JSON")),
        }
        if matches!(self.peek(), Some(b'.') | Some(b'e') | Some(b'E')) {
            // F-07 (JSONTestSuite n_number_0.3e+ u.a.): maximal-munch wie
            // CPythons NUMBER_RE — ein gueltiger FRAKTIONSTEIL ('.'+Ziffer)
            // ergibt FLOAT_FORBIDDEN unabhaengig davon, ob ein nachfolgender
            // Exponent vollstaendig ist (der wird dann zu Trailing-Garbage,
            // aber parse_float feuert zuerst). Ein Exponent OHNE Fraktion
            // braucht >= 1 Ziffer, sonst INVALID_JSON.
            let (bs, mut j) = (self.b, self.i);
            if bs.get(j) == Some(&b'.') {
                j += 1;
                let d0 = j;
                while matches!(bs.get(j), Some(b'0'..=b'9')) { j += 1; }
                return Err(if j > d0 { Reject("FLOAT_FORBIDDEN") }
                           else { Reject("INVALID_JSON") });
            }
            // 'e'/'E' direkt nach Integer-Teil
            j += 1;
            if matches!(bs.get(j), Some(b'+') | Some(b'-')) { j += 1; }
            let d0 = j;
            while matches!(bs.get(j), Some(b'0'..=b'9')) { j += 1; }
            return Err(if j > d0 { Reject("FLOAT_FORBIDDEN") }
                       else { Reject("INVALID_JSON") });
        }
        let tok = std::str::from_utf8(&self.b[start..self.i]).unwrap();
        Ok(Value::Int(match tok.parse::<i128>() {
            Ok(n) => Num::Small(n),        // Range-Check erst im Kanon (P4)
            Err(_) => Num::Overflow,       // jenseits i128: erst recht out-of-range
        }))
    }

    fn hex4(&mut self) -> Result<u16, Reject> {
        let mut v: u16 = 0;
        for _ in 0..4 {
            let c = self.bump().ok_or(Reject("INVALID_JSON"))?;
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                b'A'..=b'F' => c - b'A' + 10,
                _ => return Err(Reject("INVALID_JSON")),
            };
            v = (v << 4) | d as u16;
        }
        Ok(v)
    }

    fn parse_string(&mut self) -> Result<Vec<u16>, Reject> {
        self.bump(); // '"'
        let mut s: Vec<u16> = Vec::new();
        loop {
            let c = self.bump().ok_or(Reject("INVALID_JSON"))?;
            match c {
                b'"' => return Ok(s),
                b'\\' => {
                    let e = self.bump().ok_or(Reject("INVALID_JSON"))?;
                    match e {
                        b'"' => s.push(0x22),
                        b'\\' => s.push(0x5C),
                        b'/' => s.push(0x2F),
                        b'b' => s.push(0x08),
                        b'f' => s.push(0x0C),
                        b'n' => s.push(0x0A),
                        b'r' => s.push(0x0D),
                        b't' => s.push(0x09),
                        b'u' => s.push(self.hex4()?), // Units roh, wie CPython
                        _ => return Err(Reject("INVALID_JSON")),
                    }
                }
                0x00..=0x1F => return Err(Reject("INVALID_JSON")),
                _ => {
                    let need = match c {
                        0x00..=0x7F => 0usize,
                        0xC0..=0xDF => 1,
                        0xE0..=0xEF => 2,
                        0xF0..=0xF7 => 3,
                        _ => return Err(Reject("INVALID_UTF8")),
                    };
                    let mut buf = vec![c];
                    for _ in 0..need {
                        buf.push(self.bump().ok_or(Reject("INVALID_UTF8"))?);
                    }
                    match std::str::from_utf8(&buf) {
                        Ok(part) => {
                            for u in part.encode_utf16() { s.push(u); }
                        }
                        Err(_) => return Err(Reject("INVALID_UTF8")),
                    }
                }
            }
        }
    }
}

fn parse_strict(input: &[u8]) -> Result<Value, Reject> {
    let text = match std::str::from_utf8(input) {
        Ok(t) => t,
        Err(_) => return Err(Reject("INVALID_UTF8")),  // P1
    };
    structural_depth_gate(text)?;                       // P2
    let mut p = Parser { b: input, i: 0 };
    let v = p.parse_value()?;                           // P3
    p.skip_ws();
    if p.i != p.b.len() { return Err(Reject("INVALID_JSON")); }
    Ok(v)
}

// ------------------------------------------------------------- Kanonisierer

/// UTF-16-Units -> ES-escaped UTF-8; LONE_SURROGATE fail-closed (P4).
fn escape_units(units: &[u16], out: &mut Vec<u8>) -> Result<(), Reject> {
    out.push(b'"');
    let mut i = 0usize;
    while i < units.len() {
        let u = units[i];
        match u {
            0x08 => out.extend_from_slice(b"\\b"),
            0x09 => out.extend_from_slice(b"\\t"),
            0x0A => out.extend_from_slice(b"\\n"),
            0x0C => out.extend_from_slice(b"\\f"),
            0x0D => out.extend_from_slice(b"\\r"),
            0x22 => out.extend_from_slice(b"\\\""),
            0x5C => out.extend_from_slice(b"\\\\"),
            0x00..=0x1F => out.extend_from_slice(format!("\\u{:04x}", u).as_bytes()),
            0xD800..=0xDBFF => {
                let low = units.get(i + 1).copied();
                match low {
                    Some(l) if (0xDC00..=0xDFFF).contains(&l) => {
                        let cp = 0x10000 + (((u as u32) - 0xD800) << 10) + ((l as u32) - 0xDC00);
                        let ch = char::from_u32(cp).unwrap();
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        i += 1;
                    }
                    _ => return Err(Reject("LONE_SURROGATE")),
                }
            }
            0xDC00..=0xDFFF => return Err(Reject("LONE_SURROGATE")),
            _ => {
                let ch = char::from_u32(u as u32).unwrap();
                let mut buf = [0u8; 4];
                out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
            }
        }
        i += 1;
    }
    out.push(b'"');
    Ok(())
}

/// Sort-Key = die Unit-Folge selbst; Berechnung "in Einfuege-Ordnung" heisst
/// hier: Surrogat-Pruefung der KEYS in Einfuege-Ordnung VOR der Sortierung
/// (entspricht CPythons sorted(key=utf16_encode), das beim ersten
/// Surrogat-Key in Iterationsordnung wirft).
fn check_keys_insertion_order(pairs: &[(Vec<u16>, Value)]) -> Result<(), Reject> {
    for (k, _) in pairs {
        for &u in k {
            if (0xD800..=0xDFFF).contains(&u) {
                // Nur LONE zaehlt: gepaarte Surrogate sind gueltig
                // -> vollstaendige Paarpruefung
                return check_units_paired(k);
            }
        }
    }
    Ok(())
}

fn check_units_paired(units: &[u16]) -> Result<(), Reject> {
    let mut i = 0usize;
    while i < units.len() {
        let u = units[i];
        if (0xD800..=0xDBFF).contains(&u) {
            match units.get(i + 1) {
                Some(l) if (0xDC00..=0xDFFF).contains(l) => { i += 2; continue; }
                _ => return Err(Reject("LONE_SURROGATE")),
            }
        }
        if (0xDC00..=0xDFFF).contains(&u) {
            return Err(Reject("LONE_SURROGATE"));
        }
        i += 1;
    }
    Ok(())
}

fn canon(v: &Value, depth: usize, out: &mut Vec<u8>) -> Result<(), Reject> {
    if depth > MAX_DEPTH { return Err(Reject("DEPTH_EXCEEDED")); }
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Int(Num::Overflow) => return Err(Reject("INT_OUT_OF_SAFE_RANGE")),
        Value::Int(Num::Small(n)) => {
            if !(-MAX_SAFE_INT..=MAX_SAFE_INT).contains(n) {
                return Err(Reject("INT_OUT_OF_SAFE_RANGE"));
            }
            out.extend_from_slice(n.to_string().as_bytes());
        }
        Value::Str(s) => escape_units(s, out)?,
        Value::Arr(a) => {
            out.push(b'[');
            for (i, e) in a.iter().enumerate() {
                if i > 0 { out.push(b','); }
                canon(e, depth + 1, out)?;
            }
            out.push(b']');
        }
        Value::Obj(pairs) => {
            check_keys_insertion_order(pairs)?;          // P4: Keys zuerst
            let mut idx: Vec<usize> = (0..pairs.len()).collect();
            idx.sort_by(|&a, &b| pairs[a].0.cmp(&pairs[b].0));
            out.push(b'{');
            for (n, &i) in idx.iter().enumerate() {
                if n > 0 { out.push(b','); }
                escape_units(&pairs[i].0, out)?;
                out.push(b':');
                canon(&pairs[i].1, depth + 1, out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

fn recanonicalize(input: &[u8]) -> Result<Vec<u8>, Reject> {
    let v = parse_strict(input)?;
    let mut out = Vec::new();
    canon(&v, 0, &mut out)?;
    Ok(out)
}

fn main() {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).expect("stdin");
    match recanonicalize(&input) {
        Ok(bytes) => { std::io::stdout().write_all(&bytes).expect("stdout"); }
        Err(Reject(code)) => { eprint!("{}", code); std::process::exit(1); }
    }
}
