# Jira-Automatisierungsregeln – Dokumentation

> **Instanz:** Jira Data Center – https://partner.bdr.de

## Architektur

Die Automatisierungen gliedern sich in folgende Kategorien:

### 1. Issue-Lebenszyklus
Regeln, die den Workflow von Issues steuern:
- Automatische Status-Übergänge
- Assignment-Regeln
- Benachrichtigungen bei Statuswechsel

### 2. GitLab-Integration
Regeln zur Verknüpfung von Jira-Issues mit GitLab:
- Branch-Namenskonventionen
- Merge-Request → Issue-Transition
- Commit → Issue-Kommentar

### 3. Reporting & Metriken
- Automatische Feldberechnungen
- SLA-Monitoring
- Eskalationsregeln

## Regel-Format

Jede Regel wird als JSON-Datei unter `rules/` gespeichert:

```json
{
  "name": "Regelname",
  "description": "Beschreibung der Regel",
  "trigger": { "type": "issue_created" },
  "condition": "...",
  "actions": ["..."]
}
```

## API-Authentifizierung (Data Center)

Für API-Zugriffe wird ein **Personal Access Token (PAT)** benötigt:
1. In Jira: Profilbild → **Profil** → **Personal Access Tokens**
2. Token erstellen mit `READ` + `WRITE`-Scopes
3. In `config/.env` eintragen: `JIRA_PERSONAL_ACCESS_TOKEN=<token>`

- Regel-IDs: `BDR-{NNN}` (fortlaufend)
- Branches: `feature/BDR-{ISSUE}-{kurzbeschreibung}`
- Labels: `automated`, `gitlab-sync`, `blocked`
