# Beobachtete Actions

Quelle sind die produktiven Exporte und `KNOWN_COMPONENTS`. Alle folgenden
Kombinationen verwenden `component: "ACTION"`.

| Typ | Schema-Version | Zweck |
|---|---:|---|
| `codebarrel.action.log` | 1 | Audit-Log-Eintrag |
| `jira.create.variable` | 1 | Smart-Value-Variable |
| `jira.issue.assign` | 3 | Issue zuweisen |
| `jira.issue.comment` | 1 | Kommentar hinzufügen |
| `jira.issue.create` | 6 | Issue erzeugen |
| `jira.issue.edit` | 6 | Felder bearbeiten |
| `jira.issue.link` | 2 | Issues verknüpfen |
| `jira.lookup.issues` | 1 | Sucht bis zu 100 Vorgänge per JQL und stellt sie als `{{lookupIssues}}` bereit |
| `jira.issue.outgoing.email` | 3 | E-Mail versenden |
| `jira.issue.outgoing.webhook` | 2 | HTTP-Anfrage senden |
| `jira.issue.transition` | 6 | Status wechseln |
| `jira.version.create` | 1 | Version anlegen |
| `msteams.notification` | 2 | Teams-Nachricht senden |

Die Value-Struktur muss aus `rule-schema.json` und einer aktuellen
Referenzregel übernommen werden. Insbesondere Operations für Create/Edit,
Empfängerstrukturen, Transition-Ziele und Jira-Secret-Header nicht aus
allgemeinem Jira-Wissen erzeugen.

Für ausgehende Authentifizierungsheader gilt:

- `value.secret` muss `true` sein.
- `value.keyOrValue` referenziert einen bereits vorhandenen Jira-Secret-Key.
- Keine Tokenwerte in `headers`, Beispielen, Diffs oder Logs.
