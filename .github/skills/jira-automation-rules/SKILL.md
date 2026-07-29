---
name: jira-automation-rules
description: 'Jira Data Center (Code Barrel) Automatisierungsregeln in JSON bearbeiten. Use when: Jira-Regel erstellen, erweitern, Aktion hinzufügen, Bedingung einbauen, Trigger konfigurieren, Regel pushen, BDR-Regeln verwalten, Automation for Jira.'
---

# Jira Automation Rules – Data Center (Code Barrel)

## Projektstruktur

```
Jira-Automations/
├── rules/                 # Rohe Jira-Exporte (BDR-{id}.json) + rule-schema.json
├── scripts/
│   ├── push-rule.mjs      # Einzelne Regel nach Jira pushen
│   ├── sync-rules.mjs     # Bulk-Sync (pull/diff/push)
│   └── lib/api-helper.mjs # API-Helper (Jira + GitLab)
├── config/.env            # Credentials (JIRA_BASE_URL, JIRA_PAT, CLIENT_CERT, etc.)
└── docs/                  # Dokumentation
```

**Jira-Instanz:** `https://partner.bdr.de` (Data Center) · **Automation-API-Pfad:** `/jira/rest/cb-automation/latest/project/{projectId}/rule/{ruleId}`

Es gibt keine generische Regelvorlage: Für eine neue Regel zuerst in Jira eine
leere, deaktivierte Regel anlegen und exportieren. Anschließend den echten Export
bearbeiten, damit Regel-ID, Component-IDs, Actor und Zeitstempel von Jira stammen.

## Regel-Struktur (Top-Level)

```json
{
  "id": 913,
  "clientKey": "com.codebarrel.tenant.global",
  "name": "Regelname",
  "state": "ENABLED",        // oder "DISABLED"
  "description": "...",
  "canOtherRuleTrigger": false,
  "notifyOnError": "FIRSTERROR",
  "authorAccountId": "JIRAUSER15085",
  "actorAccountId": "JIRAUSER15085",
  "created": 1771327111999,
  "updated": 1771327489184,
  "trigger": { /* siehe Trigger */ },
  "components": [ /* siehe Components */ ],
  "projects": [{ "projectId": "11215", "projectTypeKey": "software" }],
  "labels": [],
  "tags": []
}
```

**ID-Vergabe für neue Components:** Fortlaufend nummerieren, beginnend nach der höchsten bestehenden ID im Regel-File.

---

## Trigger-Typen

| Typ | Beschreibung | Beispiel-Value |
|-----|-------------|----------------|
| `jira.incoming.webhook` | Eingehender Webhook (z.B. von GitLab) | `webhookToken`, `jql` (optional), `processIssuesInBulk` |
| `jira.issue.event.trigger:transitioned` | Issue-Status-Übergang | `fromStatus[]`, `toStatus[]` (mit `type: "ID"`, `value`) |
| `jira.sprint.event.trigger:started` | Sprint gestartet | `boardId`, `sprintNameFilter` |
| `jira.jql.scheduled` | Zeitplan/JQL | `schedule` (cron/fixed), `jql`, `executionMode` |
| `jira.manual.trigger.issue` | Manuell aus Issue | `groups[]` |
| `jira.multiple.issue.event` | Mehrere Issue-Events | `events[]` mit `key`, `event` |
| `com.xiplink.jira.git.jira_git_plugin:pull-request-merged-trigger` | Git-Plugin: PR gemerged | `prMode`, `isCustomized` |

### Trigger-Beispiele

<details>
<summary>Webhook-Trigger</summary>

```json
{
  "id": "135760",
  "component": "TRIGGER",
  "schemaVersion": 1,
  "type": "jira.incoming.webhook",
  "value": {
    "webhookToken": "420669f416dd87c9e049c55bd0faadd1d7e818b4",
    "searchOrProvide": "none",
    "jql": "project = CER AND ID = CER-1000",
    "processIssuesInBulk": false
  },
  "children": [],
  "conditions": []
}
```
</details>

<details>
<summary>Transition-Trigger</summary>

```json
{
  "id": "46434",
  "component": "TRIGGER",
  "schemaVersion": 1,
  "type": "jira.issue.event.trigger:transitioned",
  "value": {
    "synchronous": false,
    "eventKey": "jira:issue_updated",
    "issueEvent": "issue_generic",
    "fromStatus": [{ "type": "ID", "value": "10202" }],
    "toStatus": [{ "type": "ID", "value": "12501" }]
  },
  "children": [],
  "conditions": []
}
```
</details>

<details>
<summary>Scheduled-Trigger</summary>

```json
{
  "id": "103193",
  "component": "TRIGGER",
  "schemaVersion": 1,
  "type": "jira.jql.scheduled",
  "value": {
    "schedule": { "cronExpression": "", "method": "FIXED", "rate": 1, "rateInterval": 86400 },
    "jql": "project = Ceroma and (duedate = \"90d\")",
    "executionMode": "jql",
    "onlyUpdatedIssues": false,
    "processIssuesInBulk": false
  },
  "children": [],
  "conditions": []
}
```
</details>

---

## Component-Typen

### Actions

| Typ | SchemaVersion | Beschreibung |
|-----|--------------|-------------|
| `codebarrel.action.log` | 1 | Log-Eintrag im Audit-Log. `value` = String (mit Smart-Values) |
| `jira.create.variable` | 1 | Smart-Value-Variable erstellen |
| `jira.issue.outgoing.webhook` | 2 | HTTP-Request an externe API (GET/POST/PUT) |
| `jira.issue.outgoing.email` | 3 | E-Mail versenden |
| `jira.issue.transition` | 6 | Issue-Status wechseln |
| `jira.issue.edit` | 6 | Issue-Felder bearbeiten |
| `jira.issue.create` | 6 | Neues Issue erstellen |
| `jira.version.create` | 1 | Version anlegen |
| `msteams.notification` | 2 | MS-Teams-Benachrichtigung |

### Conditions

| Typ | SchemaVersion | Beschreibung |
|-----|--------------|-------------|
| `jira.comparator.condition` | 1 | Einfacher Vergleich: `first`, `second`, `operator` |
| `jira.issue.condition` | 3 | Issue-Feld-Bedingung: `selectedField`, `comparison`, `compareValue` |
| `jira.condition.container.block` | 1 | Container für If/Else-Blöcke |
| `jira.condition.if.block` | 1 | If-Block (innerhalb Container). Hat `children[]` und `conditions[]` |

---

### 1. Log Action (`codebarrel.action.log`)

```json
{
  "id": "100374",
  "component": "ACTION",
  "schemaVersion": 1,
  "type": "codebarrel.action.log",
  "value": "Beliebiger Text mit {{SmartValues}}",
  "children": [],
  "conditions": []
}
```

### 2. Create Variable (`jira.create.variable`)

```json
{
  "id": "135767",
  "component": "ACTION",
  "schemaVersion": 1,
  "type": "jira.create.variable",
  "value": {
    "id": "_customsmartvalue_id_1717583101251",
    "name": { "type": "FREE", "value": "VariablenName" },
    "type": "SMART",
    "query": { "type": "SMART", "value": "{{source.smartValue}}" },
    "lazy": false
  },
  "children": [],
  "conditions": []
}
```
- `id`: Eindeutige ID im Format `_customsmartvalue_id_{timestamp}`
- `name.type`: Immer `"FREE"`
- `query.type`: Immer `"SMART"`
- `lazy`: Immer `false`

### 3. Outgoing Webhook (`jira.issue.outgoing.webhook`)

```json
{
  "id": "135776",
  "component": "ACTION",
  "schemaVersion": 2,
  "type": "jira.issue.outgoing.webhook",
  "value": {
    "url": "https://gitlab.partner.bdr.de/api/v4/projects/{{GitlabProjectId}}/merge_requests",
    "headers": [
      {
        "id": "_header_1770818811322",
        "name": "Content-Type",
        "value": { "keyOrValue": "application/json", "secret": false }
      },
      {
        "id": "_header_1770818894542",
        "name": "Private-Token",
        "value": { "keyOrValue": "Gitlab-Token zz-sys-cer", "secret": true }
      }
    ],
    "sendIssue": false,
    "contentType": "empty",     // oder "custom" + customBody
    "method": "GET",            // GET, POST, PUT
    "responseEnabled": true,
    "usedSecretsKeys": ["Gitlab-Token zz-sys-cer"]
  },
  "children": [],
  "conditions": []
}
```
- Bei `contentType: "custom"`: `"customBody": "{\"key\":\"value\"}"`
- Secrets verweisen auf in Jira hinterlegte Secrets via `usedSecretsKeys`

### 4. Send Email (`jira.issue.outgoing.email`)

```json
{
  "id": "91972",
  "component": "ACTION",
  "schemaVersion": 3,
  "type": "jira.issue.outgoing.email",
  "value": {
    "from": "", "fromName": "", "replyTo": "",
    "to": [
      { "type": "COPY", "value": "customfield_11700" },
      { "type": "COPY", "value": "reporter" },
      { "type": "FREE", "value": "user@example.com" }
    ],
    "cc": [
      { "type": "SMART", "value": "{{issue.watchers.emailAddress}}" }
    ],
    "bcc": [],
    "subject": "Betreff {{issue.key}}",
    "body": "HTML-Body mit {{SmartValues}}",
    "mimeType": "text/html",
    "convertLineBreaks": true
  },
  "children": [],
  "conditions": []
}
```
- Empfänger-Types: `"COPY"` (Feld kopieren), `"FREE"` (feste Adresse), `"SMART"` (Smart-Value)

### 5. Transition Issue (`jira.issue.transition`)

```json
{
  "id": "100322",
  "component": "ACTION",
  "schemaVersion": 6,
  "type": "jira.issue.transition",
  "value": {
    "operations": [],
    "sendNotifications": true,
    "useLegacyRendering": false,
    "transitionMode": "status",
    "destinationStatus": { "type": "ID", "value": "12500" },
    "transitionMatch": "",
    "ignoreConditions": false
  },
  "children": [],
  "conditions": []
}
```

### 6. Edit Issue (`jira.issue.edit`)

```json
{
  "id": "100327",
  "component": "ACTION",
  "schemaVersion": 6,
  "type": "jira.issue.edit",
  "value": {
    "operations": [
      {
        "fieldId": "customfield_10004",
        "fieldType": "com.pyxis.greenhopper.jira:gh-sprint",
        "type": "SET"
      }
    ],
    "sendNotifications": true,
    "useLegacyRendering": false
  },
  "children": [],
  "conditions": []
}
```

### 7. Create Issue (`jira.issue.create`)

```json
{
  "id": "100290",
  "component": "ACTION",
  "schemaVersion": 6,
  "type": "jira.issue.create",
  "value": {
    "operations": [
      { "fieldId": "summary", "fieldType": "summary", "type": "SET", "value": "Mein Ticket" },
      { "fieldId": "issuetype", "fieldType": "issuetype", "type": "SET", "value": "10001" },
      { "fieldId": "project", "fieldType": "project", "type": "SET", "value": "11215" }
    ],
    "sendNotifications": true,
    "useLegacyRendering": false
  },
  "children": [],
  "conditions": []
}
```
- `type` bei Operations: `"SET"` oder `"COPY"`

### 8. Create Version (`jira.version.create`)

```json
{
  "id": "100289",
  "component": "ACTION",
  "schemaVersion": 1,
  "type": "jira.version.create",
  "value": {
    "versionName": "{{ceromaVersion}}",
    "project": { "type": "ID", "value": "11215", "additional": "software" },
    "overrideReleaseDate": "SET_ON_EMPTY"
  },
  "children": [],
  "conditions": []
}
```

### 9. MS Teams Notification (`msteams.notification`)

```json
{
  "id": "46445",
  "component": "ACTION",
  "schemaVersion": 2,
  "type": "msteams.notification",
  "value": {
    "webhookUrl": { "key": "MS Teams Kanal \"Jira\" in Team \"Ceroma\"" },
    "title": "{{EMailSubject}}",
    "subTitle": "",
    "imageUrl": "https://d283vu6e5qi87p.cloudfront.net/automation/prod/automation-logo.svg",
    "body": "{{EMailContent}}",
    "includeIssueSummary": true
  },
  "children": [],
  "conditions": []
}
```

---

## Conditions im Detail

### Simple Comparison (`jira.comparator.condition`)

```json
{
  "id": "135761",
  "component": "CONDITION",
  "schemaVersion": 1,
  "type": "jira.comparator.condition",
  "value": {
    "first": "{{webhookData.object_attributes.tag}}",
    "second": "true",
    "operator": "EQUALS"
  },
  "children": [],
  "conditions": []
}
```

**Verfügbare Operatoren:**
- `EQUALS`, `NOT_EQUALS`
- `CONTAINS`, `NOT_CONTAINS`
- `REGEX_MATCHES`, `REGEX_NOT_MATCHES`
- `REGEX_CONTAINS`
- `STARTS_WITH`
- `GREATER_THAN`

### Issue Field Condition (`jira.issue.condition`)

```json
{
  "id": "103220",
  "component": "CONDITION",
  "schemaVersion": 3,
  "type": "jira.issue.condition",
  "value": {
    "selectedField": { "type": "ID", "value": "issuetype" },
    "selectedFieldType": "issuetype",
    "comparison": "ONE_OF",
    "compareValue": { "type": "ID", "value": "[\"10004\",\"10002\",\"10001\"]", "multiValue": true }
  },
  "children": [],
  "conditions": []
}
```

**Verfügbare Comparisons:**
- `EQUALS`, `NOT_EQUALS`
- `ONE_OF`
- `CONTAINS_ANY`, `CONTAINS_NONE`
- `NOT_CONTAIN`
- `ENDS_WITH`
- `NOT_EMPTY`

**compareValue-Types:**
- `"ID"` – numerische ID (auch als JSON-Array-String für multiValue)
- `"NAME"` – Name/String
- `"VALUE"` – Freitext
- `multiValue: true/false`

### If/Else Block

```json
{
  "id": "135771",
  "component": "CONDITION",
  "schemaVersion": 1,
  "type": "jira.condition.container.block",
  "children": [
    {
      "id": "135772",
      "component": "CONDITION_BLOCK",
      "parentId": "135771",
      "schemaVersion": 1,
      "type": "jira.condition.if.block",
      "value": { "conditionMatchType": "ALL" },
      "children": [
        /* Aktionen im If-Zweig */
      ],
      "conditions": [
        {
          "id": "135773",
          "component": "CONDITION",
          "conditionParentId": "135772",
          "schemaVersion": 1,
          "type": "jira.comparator.condition",
          "value": { "first": "{{ref}}", "second": "\\.0$", "operator": "REGEX_NOT_MATCHES" },
          "children": [],
          "conditions": []
        }
      ]
    }
  ],
  "conditions": []
}
```

- Container-Block: `"component": "CONDITION"` (ja, das ist korrekt so)
- If-Block: `"component": "CONDITION_BLOCK"` mit `conditionMatchType: "ALL"` oder `"ANY"`
- Conditions im If-Block haben `conditionParentId` statt `parentId`
- Actions im If-Block haben `parentId`

---

## Regel nach Jira pushen

```powershell
node scripts/push-rule.mjs rules/BDR-913.json
```

Das Skript nutzt die Automation REST API:
- **PUT** `https://partner.bdr.de/jira/rest/cb-automation/latest/project/{projectId}/rule/{ruleId}`
- Sendet die komplette JSON-Datei als Body
- Benötigt mTLS-Client-Zertifikat aus `config/.env`

---

## Häufige Smart Values

| Smart Value | Beschreibung |
|-------------|-------------|
| `{{issue.key}}` | Issue-Key (z.B. CER-1234) |
| `{{issue.summary}}` | Titel |
| `{{issue.url}}` | Issue-URL |
| `{{issue.sprint.last.name}}` | Aktueller Sprint-Name |
| `{{issue.components.last.name}}` | Letzte Komponente |
| `{{webhookData.*}}` | Webhook-Payload (GitLab) |
| `{{webhookResponse.body.*}}` | Response vom Outgoing Webhook |
| `{{pullRequest.*}}` | Git-Plugin PR-Daten |
| `{{sprint.name}}`, `{{sprint.goal}}`, `{{sprint.id}}` | Sprint-Daten |
| `{{reporter.displayName}}` | Reporter-Name |

**String-Methoden:** `.remove("text")`, `.split(" ").first`, `.substringAfter("text")`, `.trim()`, `.format("dd.MM.yyyy")`, `.urlEncode`, `.endsWith("x")`, `.length`

---

## ID-Konventionen

- **Component-IDs:** Fortlaufende Nummern als Strings (`"100374"`, `"135761"`)
- **Variable-IDs:** `_customsmartvalue_id_{timestamp}` (13-stelliger ms-Timestamp)
- **Header-IDs:** `_header_{timestamp}`
- **Neue IDs:** Nimm die höchste ID im File + 1
