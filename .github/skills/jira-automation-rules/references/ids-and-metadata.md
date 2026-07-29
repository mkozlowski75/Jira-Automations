# IDs und Metadaten

## Grundsatz

IDs niemals aus Namen ableiten oder frei wählen. Fehlende Werte müssen aus Jira
oder einem aktuellen Export derselben Umgebung stammen.

| Wert | Zulässige Quelle |
|---|---|
| Rule-ID | Von Jira angelegte und exportierte Regel |
| Projekt-ID | Top-Level-Scope eines aktuellen Exports oder Jira REST API |
| Status-/Transition-ID | Aktueller Workflow beziehungsweise Jira REST API |
| Feld-/Customfield-ID | Jira-Feldmetadaten oder aktuelle Referenzregel |
| Benutzer-/Actor-ID | Aktuelle Jira-Benutzermetadaten |
| Board-ID | Jira-Boardmetadaten oder aktuelle Referenzregel |
| Secret-Key | Bereits in Jira angelegte Secret-Referenz |
| Component-ID | Repositoryweit freie ID über das Hilfswerkzeug |

## Component-IDs

Bestehende IDs unverändert erhalten. Für genau eine neue Component:

```powershell
npm run next-component-id -- rules/BDR-913.json
```

Das Werkzeug kombiniert alle lokalen Exporte mit der aktuellen read-only
Regelliste des Zielprojekts. Ohne erfolgreichen Serverabruf wird keine ID
ausgegeben. Nach dem Einfügen erneut ausführen, bevor die nächste Component
angelegt wird. Der abschließende Validator prüft zusätzlich die lokale
Eindeutigkeit über alle `BDR-*.json`.

Untergeordnete Elemente benötigen zusätzlich:

- Element in `children`: `parentId` entspricht der direkten Eltern-ID.
- Element in `conditions`: `conditionParentId` entspricht der direkten
  `CONDITION_BLOCK`-ID.
- Top-Level-Components besitzen keine Elternreferenz.

Variable- und Header-IDs dürfen nur nach dem in einer aktuellen Referenzregel
beobachteten Format erzeugt werden. Ein Zeitstempelformat ist keine Erlaubnis,
eine Component-ID frei zu wählen.
