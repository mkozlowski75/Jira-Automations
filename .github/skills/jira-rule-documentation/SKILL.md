---
name: jira-rule-documentation
description: 'BDR Jira-Data-Center-Automatisierungsregeln aus aktuellen Jira-Exporten konsistent als Confluence-Unterseiten dokumentieren und bestehende Regel-Dokumentationen sicher mit Jira abgleichen. Use when: a user asks to document a BDR rule, create documentation for a rule ID, add/update rule documentation in Confluence, or synchronize a rule page with current Jira changes.'
---

# Jira-Regeldokumentation

Dokumentiere genau eine BDR-Regel als Confluence-Unterseite oder gleiche deren
bestehende Dokumentation mit dem aktuellen Jira-Export ab. Verwende die
Repository-Skills `jira-automation-rules` und `confluence-pages` für Zugriff,
Validierung und Schreibschutz; dieser Skill ersetzt sie nicht.

## Workflow

1. Ermittle die Zielregel als `rules/BDR-{id}.json`. Lies die aktuelle Regel
   mit `npm run pull-rule -- rules/BDR-{id}.json`.
2. Übernimm den Serverexport lokal nur auf ausdrücklichen Nutzerauftrag mit
   `npm run pull-rule -- rules/BDR-{id}.json --apply`. Prüfe danach den Diff
   und führe `npm run verify` aus.
3. Lies die Dokumentationsübersicht und vorhandene Zielseite über
   `npm run confluence-page -- get` beziehungsweise `children`. Bestätige
   dabei die aktuelle Elternseite der Übersicht; rate ihre Position nicht.
4. Löse im Export verwendete Status- und Issue-Typ-IDs vor dem Schreiben
   lesend über die Jira-REST-API in aktuelle Bezeichnungen auf. Verwende dafür
   gezielte `npm run jira-ticket -- search`-Abfragen mit dem jeweiligen Status
   oder Issue-Typ und gib in der Dokumentation nur die verifizierten
   Bezeichnungen aus, nicht die IDs.
5. Leite die Dokumentation ausschließlich aus dem aktuellen Regel-Export ab:
   Trigger, Bedingungen, Variablen, Web Requests, Ergebnisse und Folgeregeln.
   Erfinde keine Projekte, Zeitpläne, IDs, Berechtigungen oder Abläufe.
6. Verwende die Gliederung aus [Dokumentationsvorlage](references/documentation-template.md).
   Seitentitel und Regelname im Überblick müssen exakt dem aktuellen Jira-Namen
   entsprechen; übersetze sie nicht.
7. Lege den Storage-HTML-Entwurf in einem ignorierten temporären Arbeitsordner
   ab. Bei Updates erhalte alle bestehenden Makros, Links und Inhalte außerhalb
   der beauftragten Änderung unverändert.
8. Führe für jede Erstellung oder Aktualisierung zuerst den Confluence-Preflight
   ohne `--apply` aus. Zeige Operation, Titel, Elternseite, Versionen oder
   `expectedAbsent` sowie nur die Inhaltslängen. Nutze beim Update den vom
   Preflight gelieferten Schutzwert `--expected-version`.
9. Verwende `--apply` erst nach ausdrücklicher Freigabe des konkret angezeigten
   Preflights in der aktuellen Unterhaltung. Prüfe danach die Seite erneut
   lesend auf Titel, Elternseite, Version und Inhalt.

## Dokumentationsregeln

- Bei neuen Seiten: Übernimm den aktuellen Jira-Regelnamen als Seitentitel.
- Bei vorhandenen Seiten: Aktualisiere den Titel und den Namen im Überblick,
  wenn sie vom aktuellen Jira-Export abweichen.
- Beschreibe tatsächliches Verhalten, nicht nur den Regel- oder Ticketnamen.
  Benenne bei einer Mehrtreffer-Abfrage präzise, ob die Regel alle oder nur
  einen zurückgegebenen Eintrag weiterverarbeitet.
- Verwende Status- und Issue-Typ-Bezeichnungen statt technischer IDs. Ist eine
  Bezeichnung nicht lesend verifizierbar, halte die Dokumentation an und
  berichte den fehlenden Abgleich statt eine ID zu veröffentlichen.
- Nutze für Prüfketten die Tabelle `Eingangsbedingungen` mit den Spalten
  `Eingangsbedingung`, `Prüfung durch die Regel` und `Bei Nichterfüllung`.
- Dokumentiere Secrets, Webhook-Tokens, Headerwerte, Zertifikate und rohe
  API-Antworten niemals. Formuliere nur, dass eine hinterlegte geheime
  Zugriffskonfiguration erforderlich ist.
- Wenn Confluence nach einem Schreibvorgang die Storage-Verifikation meldet,
  wiederhole keinen Schreibvorgang. Lies stattdessen die Seite und prüfe die
  fachlichen Metadaten sowie den gespeicherten Inhalt.

## Grenzen

- Keine Regel nach Jira pushen, um Dokumentation zu erzeugen oder zu testen.
- Keine Seiten löschen, verschieben, Berechtigungen, Labels, Anhänge oder
  Kommentare ändern.
- Bei Import aus Jira ohne fachlichen Diff darf die Confluence-Seite unverändert
  bleiben. Berichte diese Deckungsgleichheit.
