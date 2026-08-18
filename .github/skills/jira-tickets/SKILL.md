---
name: jira-tickets
description: 'Jira-Data-Center-Tickets über die vorhandene REST-API sicher suchen, lesen, zusammenfassen, kommentieren, editierbare Felder ändern und Workflow-Transitionen ausführen. Use when: Jira-Ticket oder Issue per Key öffnen, JQL-Suche ausführen, Ticketinhalt analysieren, Kommentar vorbereiten, Felder aktualisieren oder Statusübergang nach ausdrücklicher Freigabe durchführen.'
---

# Jira Tickets

## Grundregeln

Verwende das gebündelte Skript `scripts/jira-ticket.mjs`. Es nutzt die vorhandene
PAT-, mTLS- und CA-Konfiguration des Jira-Automations-Repositorys. Öffne weder
`config/.env` noch Zertifikatsdateien. Zeige niemals Tokens, Passphrasen,
Authorization-Header oder ungefilterte Jira-Antworten.

Führe Such- und Leseaufträge direkt read-only aus. Führe bei Kommentar-, Feld-
oder Statusänderungen immer zuerst den Preflight ohne `--apply` aus. Verwende
`--apply` nur nach ausdrücklicher Freigabe des konkret angezeigten Preflights in
der aktuellen Unterhaltung.

Lies [REST-API und Payloads](references/rest-api.md), wenn du Felddateien,
Transition-Pflichtfelder oder die Ausgabeformate beurteilen musst.

## Lesen und suchen

Rufe das Skript über seinen absoluten Pfad im Skill-Verzeichnis oder aus dem
Repository so auf:

```powershell
npm run jira-ticket -- get BDR-123
npm run jira-ticket -- get BDR-123 --fields summary,status,assignee,updated
npm run jira-ticket -- search --jql "project = BDR ORDER BY updated DESC"
npm run jira-ticket -- transitions BDR-123
```

Begrenze Suchergebnisse auf den benötigten Umfang. Standard sind 20, erlaubt
sind höchstens 100 Ergebnisse. Formuliere JQL aus dem Benutzerauftrag; erfinde
keine Projekt-, Benutzer-, Feld- oder Status-IDs.

## Änderungen vorbereiten

Lege Kommentar- und Felddateien ausschließlich mit den vom Benutzer verlangten
Inhalten in einem geeigneten temporären Arbeitsbereich an. Nimm keine
zusätzlichen fachlichen Änderungen vor.

```powershell
npm run jira-ticket -- comment BDR-123 --body-file <comment.txt>
npm run jira-ticket -- edit BDR-123 --fields-file <fields.json>
npm run jira-ticket -- transition BDR-123 --transition-id 31
```

Zeige dem Benutzer aus dem Preflight:

- Ticket-Key und Summary,
- Operation und konkrete Alt-/Neu-Werte,
- Zielstatus beziehungsweise Kommentarvorschau,
- den Wert `expectedUpdated`.

Ein Preflight ist read-only. Er berechtigt nicht selbst zum Schreiben.

## Freigegebene Änderung ausführen

Verwende nach ausdrücklicher Freigabe exakt dieselbe Payload und ergänze
`--apply --expected-updated <Wert-aus-Preflight>`.

```powershell
npm run jira-ticket -- edit BDR-123 --fields-file <fields.json> `
  --apply --expected-updated 2026-07-30T08:00:00.000+0000
```

Das Skript liest das Ticket erneut, blockiert bei verändertem `updated`, führt
genau eine Mutation aus und liest den Serverstand zur Verifikation erneut.
Melde das Ergebnis einschließlich Verifikationsstatus, aber keine ungefilterte
Response.

Wenn der Preflight nach der Freigabe abweicht, führe nicht `--apply` aus.
Zeige den neuen Preflight und hole eine neue Freigabe ein.

## Harte Grenzen

- Erstelle oder lösche keine Tickets.
- Ticketanlagen sind ausschließlich über die eigenständigen Workflows
  [`cer-jira-tickets`](../cer-jira-tickets/SKILL.md) und
  [`cve-ticket-factory`](../cve-ticket-factory/SKILL.md) erlaubt. Sie verwenden
  jeweils einen eigenen Preflight und eine konkrete Freigabe; `jira-ticket.mjs`
  selbst erstellt keine Tickets.
- Lade keine Anhänge hoch und lösche keine Anhänge.
- Ändere oder lösche keine bestehenden Kommentare.
- Ändere `project`, `issuetype`, `reporter`, `security`, `key` oder `status`
  niemals über eine Felddatei.
- Ändere Status ausschließlich über eine aktuell von Jira angebotene
  Transition-ID.
- Verwende nur Felder aus `editmeta` und nur Transition-Felder aus der aktuellen
  Transition-Antwort.
- Rate niemals IDs oder erlaubte Werte.
- Verwende `--apply` niemals für Tests, Smoke-Tests oder Forward-Tests.
- Stoppe bei HTTP-, Berechtigungs-, Drift- oder Remote-Verifikationsfehlern.
