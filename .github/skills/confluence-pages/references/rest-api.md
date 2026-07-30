# REST-API und Payloads

## Endpunkte

Das Skript verwendet ausschließlich die Confluence Data Center REST API:

| Operation | Methode und Endpunkt |
|---|---|
| Seite lesen | `GET /content/{id}` |
| CQL-Suche | `GET /content/search` |
| Unterseiten | `GET /content/{id}/child/page` |
| Space prüfen | `GET /space/{key}` |
| Titelkonflikt prüfen | `GET /content?spaceKey=...&title=...` |
| Seite erstellen | `POST /content` |
| Seite aktualisieren | `PUT /content/{id}` |

Löschen, Verschieben, Anhänge, Kommentare, Labels und Berechtigungen sind
absichtlich nicht implementiert. `/rest/api/2` ist ein Cloud-Pfad und wird für
die Data-Center-Instanz nicht verwendet.

## Storage Format

Übergebe den Inhalt einer Seite als UTF-8-Datei im Confluence Storage Format.
Das Skript erzeugt daraus:

```json
{
  "body": {
    "storage": {
      "value": "<p>Beispiel</p>",
      "representation": "storage"
    }
  }
}
```

Behalte vorhandene Makros, Parameter, Links und strukturierende Elemente bei,
wenn der Benutzer nicht ausdrücklich eine Änderung daran verlangt. Erfinde
keine Makro-IDs oder Space-spezifischen Referenzen.

## Preflight und Drift

Ohne `--apply` führen `create` und `update` nur Lesezugriffe aus.

Bei Erstellung prüft das Skript Space, optionale Elternseite und bestehende
aktuelle Seiten mit demselben Titel im Space. Die Ausführung verlangt
`--expected-absent true` und wiederholt die Prüfung unmittelbar vor dem POST.

Bei Aktualisierung liest das Skript Seite, Version und Storage-Inhalt. Die
Ausführung verlangt die unveränderte `expectedVersion` aus dem Preflight. Ein
abweichender Versionsstand blockiert den PUT. Die neue Version ist immer die
aktuelle Version plus eins.

## Remote-Verifikation

- Erstellung: Erzeugte Seite erneut laden und Space, Titel, Elternseite sowie
  Storage-Inhalt vergleichen.
- Aktualisierung: Seite erneut laden und neue Version, Titel sowie Storage-Inhalt
  vergleichen.

Confluence darf abgeleitete Links und Metadaten ergänzen. Das Skript gibt nur
normalisierte Seitendaten aus und verwirft die ungefilterte API-Antwort.
