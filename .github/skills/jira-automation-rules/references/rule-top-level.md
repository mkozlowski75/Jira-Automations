# Top-Level-Felder einer Regel

Die vollständige maschinenlesbare Definition steht in `rules/rule-schema.json`.
Zusätzliche Exportfelder müssen unverändert erhalten bleiben.

| Feld | Regel |
|---|---|
| `id` | Von Jira vergeben; niemals ändern |
| `clientKey` | Code-Barrel-Metadatum; niemals ändern |
| `name` | Änderbar |
| `state` | Nur nach explizitem Auftrag ändern |
| `description` | Optional und änderbar |
| `canOtherRuleTrigger` | Nur nach explizitem Auftrag ändern |
| `notifyOnError` | Nur nach explizitem Auftrag ändern |
| `authorAccountId` | Niemals ändern |
| `actorAccountId` | Nur nach explizitem Auftrag ändern |
| `created` | Von Jira vergeben; niemals ändern |
| `updated` | Nicht lokal künstlich setzen |
| `trigger` | Genau ein Top-Level-Trigger |
| `components` | Rekursive Actions, Conditions und Branches |
| `projects` | Scope; nur nach explizitem Auftrag ändern |
| `labels`, `tags` | Exportwerte erhalten, sofern nicht beauftragt |

Ein sicherer Push unterstützt aktuell genau einen Projekt-Scope. Regeln mit
leerem oder mehrfachem Scope dürfen analysiert, aber nicht mit `push-rule.mjs`
geschrieben werden.
