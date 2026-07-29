# Beobachtete Smart Values

Diese Gruppen wurden in den vorhandenen Data-Center-Exporten beobachtet. Sie
sind keine vollständige Dokumentation aller Automation-for-Jira-Smart-Values.

## Issue und Sprint

- `{{issue.key}}`, `{{issue.summary}}`, `{{issue.url}}`
- `{{issue.status.name}}`, `{{issue.issuetype.name}}`
- `{{issue.components.last.name}}`, `{{issue.fixversions.last.name}}`
- `{{issue.sprint.last.name}}`, `{{issue.sprint.last.goal}}`
- `{{sprint.id}}`, `{{sprint.name}}`, `{{sprint.goal}}`

## Webhooks und Pull Requests

- `{{webhookData.*}}`
- `{{webhookResponse.body.*}}`, `{{webhookResponses.last.body.*}}`
- `{{pullRequest.title}}`, `{{pullRequest.url}}`, `{{pullRequest.state}}`
- `{{pullRequest.sourceBranch.name}}`
- `{{pullRequest.destinationBranch.name}}`

## Beobachtete Operationen

- `.format("dd.MM.yyyy")`
- `.remove("text")`, `.replaceAll(...)`
- `.split(" ").first`
- `.substringAfter("text")`
- `.trim()`
- `.urlEncode`
- `.endsWith("text")`
- `.length`, `.size`

Für eine nicht beobachtete Methode oder einen neuen Kontext eine aktuelle
Referenzregel verwenden. Syntax nicht aus Jira-Cloud-Dokumentation übernehmen.
