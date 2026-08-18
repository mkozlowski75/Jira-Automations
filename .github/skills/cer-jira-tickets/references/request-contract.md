# Request- und CLI-Vertrag

## Ticket-Request

Verwende UTF-8-JSON mit genau zwei Top-Level-Feldern:

```json
{
  "fields": {
    "summary": "VollstÃ¤ndige Summary",
    "description": "VollstÃ¤ndige Beschreibung im Jira-Wiki-Markup",
    "components": [{ "id": "ID-aus-Live-Metadaten" }]
  },
  "sources": [
    { "id": "ID-der-passenden-Vorlage", "version": 1 },
    { "id": "93492170", "version": 1 }
  ]
}
```

- Verwende Feld- und Options-IDs ausschlieÃŸlich aus dem unmittelbar zuvor
  ausgefÃ¼hrten `metadata`-Befehl.
- Nimm in `sources` die passende Story-/Bug-Vorlage, die Nutzerrollen und jede
  fachlich verwendete Ceroma-Unterseite mit ihrer aktuellen Version auf.
- FÃ¼ge weder `project`, `issuetype`, `reporter`, `status`, `security`, `key` noch
  `attachment` zu `fields` hinzu. Projekt und Vorgangstyp sind durch den Befehl
  festgelegt; die CLI setzt den aktuellen Jira-Benutzer als Reporter.
- Verwende fÃ¼r Create alle nach Live-Metadaten erforderlichen Felder. Verwende
  fÃ¼r Edit ausschlieÃŸlich wirklich zu Ã¤ndernde Felder.

Die CLI validiert FeldverfÃ¼gbarkeit, Pflichtfelder und Optionswerte erneut. Eine
Request-Datei enthÃ¤lt keine Kopie der Confluence-Regeln.

## Bildmanifest

```json
{
  "files": [
    "C:\\Pfad\\mockup.png",
    "C:\\Pfad\\fehlerbild.jpg"
  ]
}
```

Jeder Pfad darf nur einmal vorkommen. Die CLI akzeptiert ausschlieÃŸlich Dateien,
deren Endung und binÃ¤re Signatur PNG, JPEG oder WebP Ã¼bereinstimmend ausweisen.
Sie prÃ¼ft das aktuelle Jira-Upload-Limit und bindet Dateiname, Typ, GrÃ¶ÃŸe und
SHA-256 an den Preflight.

## Schutzmodell

- Preflights sind 15 Minuten gÃ¼ltig und nur einmal verwendbar.
- Die ID ist an Operation, Ziel, normalisierte Eingabe und aktuelle
  Confluence-Seitenversionen gebunden.
- Create und Edit fÃ¼hren jeweils genau einen Jira-Schreibrequest aus.
- Mehrere Bilder werden in genau einem Multipart-Request hochgeladen.
- Nach jeder Mutation liest die CLI den Serverstand erneut und verifiziert die
  angeforderten Werte beziehungsweise die erzeugten BildanhÃ¤nge.
