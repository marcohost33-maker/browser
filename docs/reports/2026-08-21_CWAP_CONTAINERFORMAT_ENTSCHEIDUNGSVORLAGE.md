# CWAP-Containerformat — Entscheidungsvorlage

- Status: ENTSCHEIDUNGSVORLAGE (kein Entscheid)
- Datum: 2026-08-21
- Entscheider: Marco
- Betrifft: Issue #24, ADR-007 (PROPOSED), Registereintrag D4 (PARTIAL)
- Verfasser: Codie (Coworkerz), auf Marcos Auftrag „erst Vergleich, dann Entscheid"

## Worum es geht, in einfachen Worten

Ein **Containerformat** ist die Art und Weise, wie viele einzelne Dateien einer App
(HTML, Bilder, Programmcode) zu **einer** Datei zusammengepackt werden — so wie ein
Umzugskarton viele Gegenstände zu einem Packstück macht. Wir brauchen so einen
Karton, weil eine Offline-App als ein einziges, **signiertes** Stück ausgeliefert
werden soll.

**Signieren** heisst hier: der Absender rechnet mit einem geheimen Schlüssel eine
Prüfzahl über den Karton aus. Wer den Karton bekommt, kann mit dem öffentlichen
Gegenstück nachrechnen, ob auch nur ein Byte verändert wurde. Das Programm, das
diese Nachrechnung macht, heisst hier **Prüfer** (englisch *verifier*).

Entschieden ist bei uns bisher nur, wie der **Beipackzettel** im Karton geschrieben
wird: CWAP-Strict-JSON v0.1.2 (angenommen 2026-07-19/22). Der Beipackzettel listet
auf, welche Dateien drin sein müssen und welche Prüfsumme jede hat. **Welcher Karton
das ist, ist offen.** Genau das blockiert alles Weitere: ohne Karton kein Prüfer,
kein Installationsweg und kein Update-Weg.

## Die drei Kandidaten in je zwei Sätzen

### `.swbn` / IWA — der Karton von Google Chrome

Ein *Signed Web Bundle* (`.swbn`) ist Googles Karton für sogenannte **Isolated Web
Apps** (IWA): alle Dateien der App werden in einem Bündel zusammengefasst und mit
einem vorangestellten **Integrity Block** signiert, aus dem sich zugleich die
Identität der App ableitet. Chrome kann dieses Format öffnen und gibt solchen Apps
ein eigenes, besonders abgeschottetes Sicherheitsmodell
([WICG isolated-web-apps, Scheme.md](https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md);
[Chrome for Developers, IWA-Einführung](https://developer.chrome.com/docs/iwa/introduction), 2025).

### NAR — der Karton aus der Nix-Welt

**NAR** (*Nix Archive*) ist ein bewusst minimales Archivformat aus dem
Paketmanager Nix, entworfen als deterministische Alternative zu `tar`: gleiche
Dateien ergeben immer exakt dieselben Bytes, weil Zeitstempel, Besitzer und
Rechte-Bits (ausser „ausführbar") gar nicht erst gespeichert werden und
Verzeichniseinträge zwingend sortiert sind. Das Format kennt nur drei Bausteine —
reguläre Datei, Verzeichnis, symbolischer Link — und eine einzige
Zeichenketten-Kodierung mit Längenpräfix
([Nix Reference Manual, Nix Archive (NAR) Format](https://nix.dev/manual/nix/2.34/protocols/nix-archive/), 2025).

### ZIP-minimal — der bekannte Karton, streng zugeschnitten

**ZIP** ist das Archivformat, das jeder kennt. „ZIP-minimal" heisst: wir benutzen
nur einen winzigen, streng definierten Ausschnitt davon und lehnen alles andere ab.
Wie dieser Ausschnitt aussehen müsste, steht bereits in unserem eigenen Bestand —
ADR-007a Abschnitt 4 zählt **elf Klassen** auf, die ein akzeptiertes ZIP-Profil
mindestens zurückweisen muss (unter anderem Kommentare, Verschlüsselung,
Mehrfach-Datenträger, vorangestellte und angehängte Daten, Widerspruch zwischen
Zentralverzeichnis und lokalem Kopf, Pfad-Ausbrüche, Symlinks,
Dekomprimierungs-Bomben).

## Vergleich

### Aufwand für uns

Die Zahlen unten sind eine **Schätzung, keine Messung**. Eine Arbeitseinheit (AE)
meint einen konzentrierten Arbeitsblock, nicht eine Stundenzahl. Die Reihenfolge
ist belastbarer als der Absolutwert; sie stützt sich auf abzählbare Dinge — drei
Knotentypen bei NAR gegenüber elf Zurückweisungsklassen bei ZIP (ADR-007a §4)
gegenüber einem CBOR-Parser plus Bündel-Grammatik plus Integrity Block bei `.swbn`.

| | Prüfer | Installer | Update-Weg | Summe |
|---|---|---|---|---|
| `.swbn`/IWA | 8 AE | 3 AE | 3 AE | **14 AE** |
| NAR | 3 AE | 3 AE | 3 AE | **9 AE** |
| ZIP-minimal | 8 AE | 3 AE | 3 AE | **14 AE** |

Die Spalten Installer und Update-Weg sind bewusst gleich gesetzt: beide hängen
kaum vom Containerformat ab, sondern am Entpacken, am atomaren Aktivieren und an
ADR-009 (TUF). Der Unterschied steckt praktisch vollständig im **Prüfer**.

- **`.swbn` hoch**, weil ein Prüfer **CBOR** verstehen muss (ein binäres
  Datenformat, ähnlich JSON, aber in Bytes statt Text) — und CBOR bringt seine
  eigene Klasse von Mehrdeutigkeiten mit, dazu die Bündel-Grammatik und den
  Integrity Block in Version 2.
- **NAR niedrig**, weil die Grammatik auf eine Seite passt: Längenpräfix,
  Auffüllung auf 8 Byte, drei Knotentypen, sortierte Verzeichnisse.
- **ZIP-minimal hoch**, weil der Aufwand nicht im Lesen steckt, sondern im
  **Ablehnen**: die elf Klassen aus ADR-007a §4 sind elf Angriffsflächen, und
  jede braucht Regel, Test und Gegenprobe.

### Risiko und Bindung — woran binden wir uns?

| | Bindung | Preis eines späteren Wechsels |
|---|---|---|
| `.swbn`/IWA | an Googles Fahrplan | hoch |
| NAR | an eine Grammatik, die wir selbst lesen | niedrig |
| ZIP-minimal | an unser eigenes Profil | mittel |

- **`.swbn`:** Die Bindung ist die schärfste der drei, und zwar nicht wegen des
  Dateiformats, sondern wegen der Erwartungshaltung. Der Integrity Block wurde
  bereits einmal umgestellt: **Version 1 ist seit Chrome M129 abgekündigt**, der
  Signierer erzeugt standardmässig Version 2
  ([WICG/isolated-web-apps](https://github.com/WICG/isolated-web-apps), 2024/2025).
  Wer diesem Format folgt, folgt fremden Versionswechseln. Zusätzlich warnt
  ADR-007 ausdrücklich davor, Chromes Garantien (`isolated-app://`-Ursprung,
  Speicher, CSP, Isolation, Berechtigungen, Update) zu behaupten, ohne sie
  selbst gebaut und getestet zu haben — ein eigener Host erbt sie **nicht**.
- **NAR:** Die Bindung ist am schwächsten. Das Format ist so klein, dass wir es
  vollständig besitzen; ein Wechsel weg davon kostet im Wesentlichen einen neuen
  Packer, nicht ein neues Sicherheitsmodell.
- **ZIP-minimal:** Wir binden uns an ein selbst geschnittenes Profil. Der Preis
  eines Wechsels ist mittel, das **laufende** Risiko aber das unangenehmste der
  drei: ZIP-Mehrdeutigkeiten sind keine Theorie. Im August 2025 hat PyPI
  Wheel-Pakete zurückzuweisen begonnen, bei denen lokaler Dateikopf und
  Zentralverzeichnis nicht übereinstimmen, nachdem gezeigt wurde, dass zwei
  verbreitete Installer aus derselben Datei **verschiedene** Inhalte auspacken
  ([PyPI-Blog, 2025-08-07](https://blog.pypi.org/posts/2025-08-07-wheel-archive-confusion-attacks/)).
  Dieselbe Klasse ist wissenschaftlich aufgearbeitet
  ([USENIX Security 2025, „Semantic Gaps between ZIP implementations"](https://www.usenix.org/system/files/usenixsecurity25-you.pdf)).
  Das ist genau die Falle, gegen die ADR-007a §4 geschrieben wurde — sie ist
  beherrschbar, aber sie ist Dauerarbeit.

### Interoperabilität — versteht das ausser uns noch jemand?

| | Wer versteht es | Spezifikation | Wer pflegt sie |
|---|---|---|---|
| `.swbn`/IWA | Chrome, enterprise-beschränkt | Explainer, kein Standard | Google/WICG |
| NAR | Nix-Ökosystem | vollständig, im Nix-Handbuch | Nix-Projekt |
| ZIP-minimal | alles — und das ist das Problem | APPNOTE, plus unser Profil | PKWARE, faktisch niemand |

Drei Punkte, die den Reflex „Standard ist besser als Eigenbau" hier verschieben:

1. **Der IETF-Entwurf für Web Bundles ist abgelaufen.** `draft-ietf-wpack-bundled-responses`
   steht auf **„Expired & archived"**, letzte Revision 01 vom 23.06.2021; ein RFC
   ist daraus nie geworden
   ([IETF Datatracker](https://datatracker.ietf.org/doc/draft-ietf-wpack-bundled-responses/)).
   Das Format ist damit **kein offener Standard**, sondern eine von einem
   Hersteller gepflegte Spezifikation. Die IWA-Beschreibung bezeichnet auch das
   `isolated-app:`-Schema noch als „tentative" (vorläufig).
2. **IWA ist heute nicht allgemein verfügbar.** Laut Google-Dokumentation ist die
   erste Auslieferung auf **von Chrome Enterprise verwaltete ChromeOS-Geräte und
   ausgewählte Entwicklungspartner** beschränkt, Chrome/ChromeOS ab Version 120;
   eine Ausweitung ist angekündigt, aber nicht erfolgt
   ([Chrome for Developers](https://developer.chrome.com/docs/iwa/introduction), 2025).
   Der Interoperabilitätsgewinn, wegen dessen man `.swbn` wählen würde, ist also
   heute weitgehend **nicht einlösbar** — ausser man zielt genau auf verwaltete
   ChromeOS-Flotten.
3. **Bei ZIP ist Verbreitung kein Vorteil, sondern die Schwachstelle.** Dass
   jedes Werkzeug ZIP liest, heisst gerade, dass jedes Werkzeug es *etwas anders*
   liest. Ein signierter Karton, den zwei Leser verschieden auspacken, ist ein
   Widerspruch in sich. Genau deshalb verlangt ADR-007a §4, dass die ZIP-
   Akzeptanzmenge eine Teilmenge ist, über die **alle** gepinnten Parser
   übereinstimmen, und hält fest: keine einzelne Archivbibliothek ist ein
   Korrektheits-Orakel.

### Reifegrad der Werkzeuge

- **`.swbn`:** Am besten ausgestattet. Es gibt gepflegte Node.js-Pakete `wbn` und
  `wbn-sign` (Signatur mit Ed25519 oder ECDSA P-256), Plugins für Webpack und
  Rollup sowie Kommandozeilenwerkzeuge in Go
  ([Chrome for Developers](https://developer.chrome.com/docs/iwa/introduction), 2025).
  Einschränkung: Diese Werkzeuge **erzeugen** Bündel. Sie ersetzen keinen
  eigenen strengen Prüfer — und einen fremden Parser als Prüfer zu verwenden,
  verbietet unsere eigene Norm F-04 (Host-Parser-Verbot) aus gutem Grund.
- **NAR:** Ausreichend, aber dünner. Es existiert eine gepflegte Rust-Bibliothek
  `nix-nar` (Version 0.4.0, dual lizenziert Apache-2.0 / LGPL-2.1-or-later) samt
  Kommandozeilenwerkzeug ([crates.io/crates/nix-nar](https://crates.io/crates/nix-nar), 2025).
  *Unsicher:* wie viele voneinander unabhängige, aktiv gepflegte NAR-Leser es
  ausserhalb des Nix-Projekts gibt, habe ich nicht belastbar feststellen können;
  eine Suche nach einer Go-Implementierung blieb ohne verwertbares Ergebnis. Für
  ein Differential mit zwei unabhängigen Lesern wäre das zu prüfen.
- **ZIP-minimal:** Werkzeuge im Überfluss — aber keines davon implementiert
  *unser* Profil, und die verbreiteten Bibliotheken sind für Bequemlichkeit
  gebaut, nicht für Fail-Closed. Faktisch bedeutet ZIP-minimal einen Eigenbau
  mit dem Nachteil, dass die Umgebung voller Werkzeuge ist, die den Karton
  anders lesen als wir.

## Empfehlung (Vorschlag an Marco, kein Entscheid)

**Vorschlag: NAR als Container, `.swbn` bewusst als späteren Export-Weg offenhalten,
ZIP-minimal fallenlassen.**

Begründung in einem Satz: Der Aufwand steckt fast vollständig im Prüfer, und der
Prüfer ist genau dort am kleinsten, wo die Grammatik am kleinsten ist — bei einem
Format mit drei Knotentypen statt elf Zurückweisungsklassen oder einem
CBOR-Stapel. Dazu passt NAR als einziger der drei Kandidaten zu dem, was CWAP
bereits ist: eine bewusst enge, deterministische Teilmenge, deren Wert daher
kommt, dass sie Mehrdeutigkeit **ausschliesst**, statt sie zu behandeln.

**Der Preis dieses Vorschlags, ehrlich benannt:**

1. **Wir geben Chrome-Interoperabilität auf** — auf absehbare Zeit allerdings
   eine, die wir ohnehin nicht hätten, weil IWA enterprise-beschränkt ist. Sollte
   sich das ändern und ChromeOS-Flotten je ein Ziel werden, kostet das einen
   zusätzlichen Export-Weg, nicht eine Neuentscheidung des Fundaments.
2. **NAR ist ausserhalb der Nix-Welt kaum verbreitet.** Wer unser Paket auspacken
   will, braucht unser Werkzeug. Für einen offline ausgelieferten,
   eigenkontrollierten Karton ist das vertretbar; als allgemeines Austauschformat
   wäre es das nicht.
3. **Die Zweit-Implementierung ist noch nicht gesichert.** Unser Verfahren lebt
   davon, dass zwei unabhängig gebaute Leser auf demselben Korpus dieselbe
   Antwort geben. Ob es genügend unabhängige NAR-Leser gibt, ist oben
   ausdrücklich als **unsicher** markiert und wäre vor einer endgültigen Zusage
   zu klären.
4. **„Einfacher von Bauart" bleibt bis zur Messung eine Behauptung.** Das steht
   so in ADR-007a §4, und es gilt auch gegen diesen Vorschlag: die 9 gegenüber
   14 Arbeitseinheiten sind geschätzt, nicht gemessen. Der Vergleich, der das
   entscheiden würde, ist derselbe Angriffskorpus gegen beide Kandidaten — und
   der ist noch nicht gefahren.

**Was der Entscheid nicht ist.** Ein Containerformat zu wählen, akzeptiert kein
Paketformat und keinen produktiven Prüfer: ADR-007 verlangt dafür eine
Liefer-Liste, von der heute ein Punkt abgehakt ist. Der Entscheid schaltet nur den
Blocker ab, damit Prüfer, Installer und Update-Weg überhaupt gebaut werden können.

## Quellen

Alle Aussagen oben, die eine Zahl, ein Datum oder einen Status tragen, stützen sich
auf diese Belege. Nichts davon ist Marketing-Material; wo eine Herstellerseite
zitiert wird (Google zu IWA), ist sie als Herstellerangabe kenntlich gemacht.

- [WICG/isolated-web-apps — Scheme.md](https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md)
  — Explainer, `isolated-app:` als „tentative" bezeichnet.
- [WICG/isolated-web-apps — Repository](https://github.com/WICG/isolated-web-apps)
  — Integrity Block v2, v1 abgekündigt seit Chrome M129.
- [Chrome for Developers — Isolated Web Apps](https://developer.chrome.com/docs/iwa/introduction)
  (Herstellerangabe Google, 2025) — Verfügbarkeit auf verwaltete ChromeOS-Geräte
  und ausgewählte Partner beschränkt, ab Chrome 120; Werkzeuge `wbn`/`wbn-sign`.
- [IETF Datatracker — draft-ietf-wpack-bundled-responses](https://datatracker.ietf.org/doc/draft-ietf-wpack-bundled-responses/)
  — Status „Expired & archived", letzte Revision 01 vom 2021-06-23.
- [Nix Reference Manual 2.34 — Nix Archive (NAR) Format](https://nix.dev/manual/nix/2.34/protocols/nix-archive/)
  (2025) — vollständige Grammatik, Magic `nix-archive-1`, sortierte Einträge,
  verworfene Metadaten.
- [crates.io — nix-nar 0.4.0](https://crates.io/crates/nix-nar) (2025) — Rust-Leser
  und -Schreiber, Apache-2.0 / LGPL-2.1-or-later.
- [PyPI-Blog — Preventing ZIP parser confusion attacks](https://blog.pypi.org/posts/2025-08-07-wheel-archive-confusion-attacks/)
  (2025-08-07) — abweichende Auspack-Ergebnisse zwischen Installern; PyPI weist
  seither Wheels mit Kopf-/Verzeichnis-Widerspruch zurück.
- [USENIX Security 2025 — Semantic Gaps between ZIP implementations](https://www.usenix.org/system/files/usenixsecurity25-you.pdf)
  — wissenschaftliche Aufarbeitung derselben Klasse.
- Repo-intern: `docs/adr/ADR-007-signed-package-evaluation.md` (Track A/B,
  Chrome-Garantien nicht erbbar), `docs/adr/ADR-007a-signed-package-verifier-hardening.md`
  §4 (elf ZIP-Zurückweisungsklassen, „simpler by design is a hypothesis until
  measured"), `spike/cwap-canonical-json/SPEC_v0.1.2_DRAFT.md` (F-04
  Host-Parser-Verbot).

## Grenzen dieser Vorlage

- Die Aufwandszahlen sind geschätzt. Gemessen ist keine einzige davon.
- Kein Kandidat wurde gegen den gemeinsamen Angriffskorpus gefahren; ADR-007
  verlangt genau das, bevor ein Paketpfad angenommen wird. Diese Vorlage ersetzt
  das nicht — sie soll den Entscheid ermöglichen, mit welchem Kandidaten dieser
  Aufwand überhaupt getrieben wird.
- Die Zahl unabhängiger NAR-Implementierungen ist offen (siehe oben, „unsicher").
- Diese Vorlage ist nicht cross-family gegengelesen.
