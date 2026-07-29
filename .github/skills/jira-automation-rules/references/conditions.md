# Beobachtete Conditions und Branches

## Conditions

| Component | Typ | Schema-Version | Zweck |
|---|---|---:|---|
| `CONDITION` | `jira.comparator.condition` | 1 | Smart-Value-Vergleich |
| `CONDITION` | `jira.issue.condition` | 3 | Issue-Feld-Bedingung |
| `CONDITION` | `jira.condition.container.block` | 1 | Container für If-Blöcke |
| `CONDITION_BLOCK` | `jira.condition.if.block` | 1 | If-Zweig mit Conditions und Children |

Im Bestand beobachtete Comparator-Operatoren:
`CONTAINS`, `EQUALS`, `GREATER_THAN`, `NOT_CONTAINS`, `NOT_EQUALS`,
`REGEX_CONTAINS`, `REGEX_MATCHES`, `REGEX_NOT_MATCHES`, `STARTS_WITH`.

Im Bestand beobachtete Issue-Comparisons:
`CONTAINS_ANY`, `CONTAINS_NONE`, `ENDS_WITH`, `EQUALS`, `NOT_CONTAIN`,
`NOT_EMPTY`, `ONE_OF`, `STARTS_WITH`.

Diese Listen sind Beobachtungen, keine Behauptung über alle vom Plugin
unterstützten Werte. Für einen nicht aufgeführten Wert ist eine aktuelle
Referenzregel erforderlich.

## Branch

| Component | Typ | Schema-Version | Zweck |
|---|---|---:|---|
| `BRANCH` | `jira.issue.related` | 1 | Verarbeitung verwandter Issues |

Children eines If-Blocks oder Branches verwenden `parentId`. Conditions im
If-Block verwenden `conditionParentId`. Siehe das bereinigte
[If-Block-Beispiel](../examples/if-block.json).
