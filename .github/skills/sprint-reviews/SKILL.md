---
name: sprint-reviews
description: 'Erstellt oder ergänzt CER-Sprint-Review-Seiten in Confluence aus aktuellen Jira-Sprints. Use when: a user asks to prepare, create, or update a CER sprint review.'
---

# Sprint-Reviews

Erstelle oder ergänze genau eine CER-Sprint-Review-Seite unter der Confluence-
Übersicht `Sprint-Reviews` (Seite `100667048`). Verwende die Repository-Skills
[`jira-tickets`](../jira-tickets/SKILL.md) und
[`confluence-pages`](../confluence-pages/SKILL.md); dieser Skill ersetzt deren
Zugriffs- und Freigaberegeln nicht.

## Eingabe und Auflösung

- Benötige die Sprint-Bezeichnung sowie die bestätigte Jira-Sprint-ID des
  abgeschlossenen Sprints. Für einen Ausblick benötige zusätzlich die
  Bezeichnung und Jira-Sprint-ID des Folgesprints. Rate Sprint-IDs nie.
- Lies die Übersichtsseite live und prüfe Space `CER`, Status `current` und
  Seite `100667048`. Prüfe für einen neuen Review-Titel vor dem Preflight, ob
  bereits eine gleichnamige Unterseite existiert.
- Ermittle unter `Sprint-Reviews` die zuletzt angelegte aktuelle direkte
  Unterseite, deren Titel einer Sprint-Review entspricht, und verwende sie als
  verbindliche Vorlage. Ist keine eindeutige letzte Review ermittelbar, stoppe
  und frage nach der Referenzseite.
- Starte den Entwurf als strukturelle Kopie dieser Vorlage. Erhalte Layout,
  Abschnittsreihenfolge, Makro-Parameter, Panels, Tabellen und manuell
  ergänzte Inhalte; ersetze nur sprint-, versions- und ticketbezogene Werte.
  Übernimm keine `ac:macro-id`-Werte.
- Ermittle die Ceroma-Release-Version aus den Fix-Versionen des Sprint-Backlogs
  und bestätige sie mit dem zugehörigen CEROMA-Release-Ticket. Bei keinem oder
  mehreren passenden Kandidaten frage vor dem Preflight nach der Version.
- Suche die Seiten `Ceroma <Release-Version> Changelog` und `Ceroma Releaseplan`
  live in Space `CER`. Stoppe vor dem Entwurf, wenn eine Zielseite fehlt oder
  nicht eindeutig ist.
- Bei einem Update lies den aktuellen Storage-Inhalt. Erhalte alle manuellen
  Anpassungen und ändere ausschließlich die beauftragte Review-Sektion. Ergänze
  das Info-Panel nur, wenn es noch nicht vorhanden ist.

## Inhalt vorbereiten

Lies [Inhaltsformat](references/content-format.md), bevor du Storage-HTML
erstellst.

1. Erstelle die Bereiche `Allgemein`, `Sprint-Übersicht` und bei gewünschtem
   Ausblick `Ausblick Sprint <Folgesprint>` in der etablierten Reihenfolge.
   Ermittele Schwerpunkte und Besonderheiten aus aktuellen Jira- und
   Confluence-Quellen; erfinde keine Inhalte.
2. Erzeuge Jira-Makros für Verzögerungen (`labels = Sprint_Delay`),
   produktionsrelevante Tickets und weitere Tickets. Die Makros müssen die
   bestätigte Sprint-ID verwenden und Stories, Bugs und Tasks unabhängig vom
   Workflow-Status zeigen.
3. Prüfe die kuratierte Tabelle `Weitere Tickets` mit exakt derselben JQL wie
   die Liste der nicht produktionsrelevanten Tickets. Jeder Tabellen-Vorgang
   muss in deren Ergebnis vorkommen; ein Vorgang mit einer produktionsrelevanten
   Rolle darf dort nicht erscheinen. Bitte um Auswahl, wenn mehrere passende
   Vorgänge fachlich gleichwertig sind.
4. Prüfe im übernommenen Vorlage-Layout das Info-Makro `Weiterführende Links`.
   Fehlt es, setze es direkt nach dem TOC und vor `Allgemein` mit genau zwei
   Confluence-Seitenlinks:
   `Ceroma <Release-Version> Changelog` und `Ceroma Releaseplan`. Verwende die
   zuvor live bestätigten Seitentitel, keine hart codierte Version und keine
   `ac:macro-id`-Werte.
5. Vergleiche den Entwurf vor dem Preflight strukturell mit der Vorlage. Nur
   Titel, Sprint-/Release-Versionen, Jira-JQL, Jira-Ticket-Keys und die vom
   Nutzer beauftragten Inhalte dürfen abweichen.
6. Lege den UTF-8-Entwurf ausschließlich unter `.tmp/` ab. Verwende Jira-Makros
   ohne `ac:macro-id`; Confluence ergänzt sie beim Speichern.

## Veröffentlichung und Prüfung

1. Führe mit `npm run confluence-page -- create` beziehungsweise `update` zuerst
   einen read-only Preflight aus.
2. Zeige bei Erstellung Operation, Titel, Elternseite, Inhaltslänge und
   `expectedAbsent`; bei Updates zusätzlich aktuelle und geplante Version sowie
   `expectedVersion`. Wende nur nach frischer ausdrücklicher Freigabe exakt
   diesen Entwurf mit `--apply --expected-absent true` beziehungsweise
   `--apply --expected-version <Wert>` an.
3. Prüfe anschließend Seite, Titel, Parent, Version und die eingefügten
   Abschnitte lesend. Meldet das Werkzeug eine fehlgeschlagene
   Remote-Verifikation, wiederhole keinen Schreibaufruf: lies den Serverstand
   über Suche, Unterseiten und `get --include-body` und berichte ihn präzise.

## Grenzen

- Erstelle keine Jira-Tickets und ändere keine Jira-Vorgänge.
- Lösche oder verschiebe keine Seiten und ändere keine Anhänge, Kommentare,
  Berechtigungen, Restriktionen oder Labels bestehender Seiten.
- Verwende diesen Skill nur für CER-Sprint-Reviews in der angegebenen
  Confluence-Hierarchie.
