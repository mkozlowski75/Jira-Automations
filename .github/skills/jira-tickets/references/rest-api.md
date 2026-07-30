# REST-API und Payloads

## Endpunkte

Das Skript verwendet ausschließlich Jira Data Center REST API 2:

| Operation | Methode und Endpunkt |
|---|---|
| Ticket lesen | `GET /issue/{key}` |
| JQL-Suche | `GET /search` |
| Editierbare Felder | `GET /issue/{key}/editmeta` |
| Transitionen | `GET /issue/{key}/transitions?expand=transitions.fields` |
| Kommentar anlegen | `POST /issue/{key}/comment` |
| Felder ändern | `PUT /issue/{key}` |
| Transition ausführen | `POST /issue/{key}/transitions` |

Ticketanlage, Löschung, Anhänge und das Ändern oder Löschen vorhandener
Kommentare sind absichtlich nicht implementiert.

## Felddateien

Verwende für `edit --fields-file` ein JSON-Objekt, dessen Schlüssel Jira-Feld-IDs
aus der aktuellen `editmeta`-Antwort sind:

```json
{
  "summary": "Bereinigte Beispiel-Zusammenfassung",
  "labels": ["beispiel"]
}
```

Verwende für Transition-Felder dasselbe direkte Objektformat. Alle angegebenen
Felder müssen in `transitions.fields` der gewählten Transition vorkommen; dort
als erforderlich markierte Felder müssen enthalten sein.

Übernimm komplexe Werte wie Benutzer, Prioritäten, Komponenten oder Versionen
in der von Jira angegebenen Struktur. Rate weder IDs noch Kontonamen.

## Preflight und Drift

Ohne `--apply` lesen Änderungsbefehle nur Jira-Metadaten und den aktuellen
Ticketstand. Die Ausgabe enthält `expectedUpdated`. Bei der Ausführung muss
dieser Wert über `--expected-updated` unverändert zurückgegeben werden.

Eine Änderung von `updated` zwischen Preflight und Ausführung blockiert den
Schreibzugriff. Führe dann einen neuen Preflight aus und hole für dessen Inhalt
eine neue Benutzerfreigabe ein.

## Remote-Verifikation

- Kommentar: Erzeugte Kommentar-ID erneut abrufen und Text vergleichen.
- Felder: Geänderte Felder erneut abrufen und die angeforderten Werte prüfen.
- Transition: Ticket erneut abrufen und Zielstatus-ID prüfen.

Jira darf Antworten um Anzeigenamen oder andere abgeleitete Metadaten
anreichern. Die Verifikation vergleicht deshalb angeforderte IDs und
Teilmengen, ohne ungefilterte Responses auszugeben.
