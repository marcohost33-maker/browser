# PR: Aequivalenzbeweis statt unbeweisbarer Sicherheitsbehauptung

- **Datum:** 2026-11-03
- **Befund:** P2-BR59-01 (Cross-Family-Runde 2026-10-13): der lokale, unsignierte
  Reset-Marker kann Rollback-Floors zuruecksetzen.

## Was funktioniert hat

Statt einen lokalen Marker "manipulationssicher" zu machen (ohne extern verankerte
Monotonie nicht moeglich, siehe TUF-Spezifikations-Issue #107), wurde die Grenze in
zwei pruefbare Teile zerlegt:

1. **Andere Konten:** erzwungen. Link, fremder Besitzer oder Gruppen-/Weltschreibrecht
   auf Verzeichnis oder Datei ergibt `INSECURE_LOCAL_STATE` vor jedem Lesen.
2. **Eigenes Konto:** nicht abgewehrt, aber belegt begrenzt. Ein gefaelschter Marker
   bewirkt ueber alle 18 Korpusfaelle genau dasselbe wie das Loeschen der drei
   Rollendateien (Ergebnis, Anfragen, effektiver Zustand), das ohnehin moeglich ist.
   Die drei Faelle, in denen beide Manipulationen eine aeltere gueltige Kette
   durchlassen, sind namentlich fixiert.

## Warum wiederverwendbar

"X kann nicht mehr als Y, und Y ist bereits ausserhalb des Bedrohungsmodells" ist
eine falsifizierbare Aussage mit Differentialtest. Das Muster passt auf jeden lokalen
Hilfszustand (Journale, Marker, Caches) neben einem Vertrauensanker.
