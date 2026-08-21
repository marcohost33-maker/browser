"""Ist-Zustands-Tests fuer die Owner-Entscheide E5 und E7 (2026-08-21).

Kontext: Der 007-Antwortbrief vom 2026-07-19 ("ANTWORT R4 BROWSER CWAP 3WEGE
KONFORMITAET") stellte acht Owner-Entscheide E1-E8. E1-E4 wurden am 2026-07-19
bzw. 2026-07-22 entschieden; **E5, E6 und E7 blieben offen**, waehrend die
Implementation sie faktisch schon faehrt. Diese Datei pinnt den GEMESSENEN
Ist-Zustand, damit "Praxis ohne Regel" nicht stillschweigend driftet.

Abgrenzung -- was hier NICHT steht:

* **E6 (Maximal-Eingabegroesse)** hat KEINEN Test, weil es keinen Ist-Zustand
  gibt, den man pinnen koennte: keine der drei Implementationen kennt eine
  Groessengrenze (gemessen 2026-08-21: 8-MiB-Eingabe -> ACCEPT). Der im Brief
  vorgeschlagene Wert 4 MiB ist ein VORSCHLAG, kein Ist-Zustand. Ein Test waere
  hier eine erfundene Norm. Siehe SPEC_v0.1.2_DRAFT.md, Abschnitt E5/E6/E7.
* **Die Zeit-/Komplexitaetsschranke aus E5** ist bewusst NICHT als Assertion
  formuliert. Wanduhr-Zeiten sind maschinen- und lastabhaengig; ein
  Zeitbudget-Assert im CI waere ein Flake-Generator und wuerde eine
  Sicherheitsaussage vortaeuschen, die er nicht traegt. Getestet wird die
  KORREKTHEIT der Duplikatpruefung bei grossem n (der Teil, der bei einer
  Optimierung tatsaechlich brechen kann); die Komplexitaet selbst ist im
  Spec-Abschnitt mit Datei:Zeile belegt.

Ausfuehrung:  py -m pytest test_ist_zustand_e5_e7.py
Coworker Research / Coworkerz | 2026-08-21
"""
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from cwap_strict_json import CanonReject, recanonicalize  # noqa: E402

BS = chr(92)  # Backslash ohne Literal-Escaping-Fallen


# --------------------------------------------------------------------------- #
# E7 -- Unicode-Nichtzeichen: Ist-Zustand ist DURCHREICHEN (kein Reject).
#
# Nichtzeichen ("noncharacters") sind die 66 Codepunkte U+FDD0..U+FDEF und
# U+xFFFE/U+xFFFF jeder Ebene. Sie sind gueltiges Unicode und gueltiges UTF-8;
# I-JSON (RFC 7493) empfiehlt, sie zu meiden. CWAP rejectet sie NICHT.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("cp_name,ch", [
    ("U+FFFE", "￾"),
    ("U+FFFF", "￿"),
    ("U+FDD0", "﷐"),
    ("U+FDEF", "﷯"),
    ("U+1FFFE", "\U0001fffe"),
    ("U+10FFFF", "\U0010ffff"),
])
def test_e7_nichtzeichen_im_wert_werden_durchgereicht(cp_name, ch):
    """Nichtzeichen im String-WERT: ACCEPT, literale UTF-8-Bytes, kein Escape."""
    doc = ('{"a":"' + ch + '"}').encode("utf-8")
    assert recanonicalize(doc) == doc, cp_name


@pytest.mark.parametrize("cp_name,ch", [
    ("U+FFFE", "￾"),
    ("U+FDD0", "﷐"),
    ("U+1FFFE", "\U0001fffe"),
])
def test_e7_nichtzeichen_im_key_werden_durchgereicht(cp_name, ch):
    """Nichtzeichen im KEY: ebenfalls ACCEPT -- der Sortier-/Duplikatpfad
    (UTF-16-Code-Units) behandelt sie wie jedes andere Zeichen."""
    doc = ('{"' + ch + '":1}').encode("utf-8")
    assert recanonicalize(doc) == doc, cp_name


def test_e7_nichtzeichen_als_escape_wird_zu_literalen_bytes():
    """`\ufffe` im Eingabetext kanonisiert zum literalen UTF-8-Nichtzeichen --
    die Escape-Form ueberlebt die Kanonisierung NICHT (nur C0-Controls bleiben
    escaped). Das ist die Naht, an der ein Reject-Entscheid sichtbar wuerde."""
    doc = ('{"a":"' + BS + 'ufffe"}').encode("ascii")
    assert recanonicalize(doc) == '{"a":"￾"}'.encode("utf-8")


def test_e7_positivkontrolle_lone_surrogate_rejectet_weiterhin():
    """Positiv-Kontrolle: der Reject-Pfad im selben Escape-Code ist scharf.
    Ohne diesen Fall koennte ein generell toter Reject-Pfad die
    Durchreich-Tests oben gruen faerben, ohne dass sie etwas beweisen."""
    doc = ('{"a":"' + BS + 'udc00"}').encode("ascii")
    with pytest.raises(CanonReject) as exc:
        recanonicalize(doc)
    assert exc.value.code == "LONE_SURROGATE"


# --------------------------------------------------------------------------- #
# E5 -- Duplikatpruefung: Korrektheit bei grossem n.
# --------------------------------------------------------------------------- #

N_GROSS = 60_000  # der im Brief genannte DoS-Messpunkt (F-06, 2026-07-19)


def _obj(n, mit_duplikat=False):
    teile = ['"k%d":1' % i for i in range(n)]
    if mit_duplikat:
        teile.append('"k0":2')
    return ("{" + ",".join(teile) + "}").encode("ascii")


def test_e5_duplikat_wird_auch_bei_60k_keys_gefunden():
    """Der sortier-/mengenbasierte Duplikatcheck darf bei grossem n nicht
    stillschweigend aufhoeren zu pruefen -- genau das waere die teure
    Regression einer Performance-Optimierung."""
    with pytest.raises(CanonReject) as exc:
        recanonicalize(_obj(N_GROSS, mit_duplikat=True))
    assert exc.value.code == "DUPLICATE_KEY"


def test_e5_60k_eindeutige_keys_werden_akzeptiert():
    """Gegenstueck: ohne Duplikat muss dasselbe Objekt akzeptiert werden
    (sonst wuerde der Test oben auch bei einem kaputten Check gruen sein)."""
    out = recanonicalize(_obj(N_GROSS))
    assert out.startswith(b'{"k0":1,')
    assert out.endswith(b"}")
