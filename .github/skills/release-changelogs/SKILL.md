---
name: release-changelogs
description: 'Erstellt Changelog-Seiten für Ceroma, Mediator, PostidentService und Contracts unter der CER-Changelog-Übersicht aus einem Release-Ticket und den Tickets einer Fix Version. Use when: a user asks to create a component release changelog in the CER Confluence hierarchy.'
---

# Release-Changelogs

Erstelle genau eine neue Changelog-Seite für eine Komponente unter der
Confluence-Übersicht `Changelogs` (Seite `106044496`). Verwende dafür die
Repository-Skills [`jira-tickets`](../jira-tickets/SKILL.md) und
[`confluence-pages`](../confluence-pages/SKILL.md); dieser Skill ersetzt deren
Zugriffs- und Freigaberegeln nicht.

## Eingabe und Auflösung

- Benötige Komponente und Release-Version. Akzeptiere optional einen
  Release-Ticket-Key. Alle betroffenen Vorgänge liegen im Projekt `CER`.
- Lies die Übersichtsseite live und ermittle die passende Komponente über die
  direkte Unterseite `<Komponente> Changelogs`. Prüfe Space `CER`, Status
  `current` und Parent `106044496`; rate keine Elternseiten-ID.
- Ist kein Key gegeben, suche Release-Tickets im Projekt `CER` und akzeptiere
  genau eine Summary, die ohne Beachtung der Groß-/Kleinschreibung
  `<Komponente> Release <Version>` entspricht. Bei keinem oder mehreren
  Treffern frage nach dem Ticket-Key.
- Lies das Release-Ticket mit Summary, Description, Fix Version und Vorgangstyp.
  Es muss ein Release-Ticket mit der gewünschten Fix Version sein. Stoppe bei
  Abweichungen statt Informationen aus einem ähnlichen Ticket zu übernehmen.

## Inhalt vorbereiten

Lies [Inhaltsformat](references/content-format.md), bevor du Storage-HTML
erstellst.

1. Übernimm ausschließlich die Tabelle direkt unter `h1. Release Summary` aus
   der Jira-Beschreibung. Beende die Übernahme am nächsten Heading; nimm weder
   Test- noch Installationsabschnitte ungefragt auf.
2. Suche je eine Liste mit `fixVersion = "<Version>"` für `Story`, `Task` und
   `Bug`, jeweils nach Key aufsteigend. Nimm alle gefundenen Tickets unabhängig
   vom Workflow-Status auf und verwende Key sowie Summary unverändert.
3. Verwende den Seitentitel `<Komponente> <Version> Changelog`, oben ein Jira-
   Makro zum Release-Ticket und darunter `Release Summary` sowie
   `Release-Inhalt` mit den drei Vorgangstyp-Abschnitten. Erfinde keine
   Makro-IDs, Release-Daten oder Tabellenzeilen.
4. Lege den UTF-8-Entwurf ausschließlich unter `.tmp/` ab. Lies bei Bedarf eine
   bestehende Changelog-Unterseite derselben Komponente als Formatreferenz,
   ohne deren Inhalte oder Makro-IDs zu kopieren.

## Veröffentlichung und Prüfung

1. Erstelle mit `npm run confluence-page -- create` zuerst den read-only
   Preflight. Übergib `--labels release-protokoll`, damit die Seite in den
   vorhandenen Details-Summary-Makros erscheint.
2. Zeige nur Operation, Titel, Elternseite, Inhaltslänge, Labels und
   `expectedAbsent`. Führe `--apply --expected-absent true` erst nach einer
   frischen ausdrücklichen Freigabe für diesen Preflight aus.
3. Prüfe anschließend lesend Seite, Parent, Jira-Makro, Release-Summary,
   Ticketanzahlen und das globale Label `release-protokoll`.
4. Meldet Confluence nach dem Create eine fehlgeschlagene Verifikation oder ein
   fehlendes Label, wiederhole keinen Create-Aufruf. Ermittle den Seitenstand
   über Suche, Unterseiten und `get --include-body` und berichte die bereits
   entstandene Seite präzise.

## Grenzen

- Erstelle keine Jira-Tickets, ändere keine Release-Tickets und aktualisiere
  keine bestehenden Changelogs mit diesem Skill.
- Lösche, verschiebe oder bearbeite keine Anhänge, Kommentare, Berechtigungen
  oder Labels bestehender Confluence-Seiten.
- Verwende keine Changelog-Hierarchien außerhalb der angegebenen CER-
  Übersichtsseite.
