# Changelog

Alle nennenswerten Aenderungen an diesem Projekt werden hier dokumentiert.

Format nach [Keep a Changelog 1.1](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Added

- Scaffold aus `code-factory` Copier-Template (14-Element-Struktur).

### Security

- Origin-Allowlist (`src/security/header-values.js`): eingebettete IPv4-Adressen
  werden jetzt auch aus Teredo- (`2001:0000::/32`, XOR-verschleierte
  Client-IPv4) und ISATAP-Literalen (`..:5efe:a.b.c.d`) dekodiert und gegen den
  Non-Public-Filter geprueft; `192.88.99.0/24` (6to4-Relay-Anycast, RFC 7526)
  ergaenzt den reservierten IPv4-Bereich. Schliesst die zuvor als "residual"
  dokumentierte Luecke, ueber die eine private/link-local IPv4 als
  Uebergangs-IPv6-Origin an der Allowlist vorbeigeschmuggelt werden konnte.
  Regressionstests in `tests/security/production-boundary.test.js`.
- Supply-Chain / `audit:ci`-Gate: vier Advisories im Markdown-Dev-Tooling
  geschlossen (0 high/critical). `markdownlint-cli2` auf `0.23.2` angehoben
  (gepatchtes `js-yaml` 5.2.2 gegen die YAML-DoS-CVEs) und `overrides` fuer
  `ip-address@10.4.0` (u. a. GHSA-22jq-vg5j-6vgg — IPv4-mapped/NAT64-SSRF-
  Fehlklassifikation), `undici@7.29.0` und `xmlbuilder2 > js-yaml@4.3.1`
  ergaenzt. `package-lock.json` deterministisch regeneriert und registry-agnostisch
  gehalten (nur `integrity`, keine `resolved`-URLs); `npm ci`, `lockfile:check`
  und `docs:lint` weiterhin gruen.

<!-- Leere Sektionen weglassen. Verfuegbar: Added, Changed, Deprecated, Removed, Fixed, Security. -->
