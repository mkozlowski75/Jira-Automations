# Beobachtete Trigger

Quelle sind die produktiven Exporte und `KNOWN_COMPONENTS`. Alle folgenden
Kombinationen verwenden `component: "TRIGGER"`.

| Typ | Schema-Version | Zentrale Value-Felder |
|---|---:|---|
| `jira.incoming.webhook` | 1 | `webhookToken`, `searchOrProvide`, optional `jql`, `processIssuesInBulk` |
| `jira.issue.event.trigger:transitioned` | 1 | `eventKey`, `issueEvent`, `fromStatus`, `toStatus`, `synchronous` |
| `jira.sprint.event.trigger:started` | 1 | `boardId`, `sprintNameFilter` |
| `jira.jql.scheduled` | 1 | `schedule`, `jql`, `executionMode`, Bulk-Flags |
| `jira.manual.trigger.issue` | 1 | `groups` |
| `jira.multiple.issue.event` | 1 | `events`, `synchronous` |
| `com.xiplink.jira.git.jira_git_plugin:pull-request-merged-trigger` | 1 | `prMode`, `isCustomized` |

Ein Webhook-Token aus einem Serverexport darf erhalten, aber niemals angezeigt,
in Dokumentation kopiert oder lokal verändert werden. Für einen neuen
Trigger-Typ oder eine neue Schema-Version ist eine aktuelle Server-Referenzregel
erforderlich.
