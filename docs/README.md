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

Jede Regel wird als roher Code-Barrel-Export unter
`rules/BDR-{numerische Regel-ID}.json` gespeichert. Das vollständige rekursive
Format ist in `rules/rule-schema.json` beschrieben und wird mit
`npm run validate` geprüft.

Für eine neue Regel zuerst in Jira eine leere, deaktivierte Regel anlegen und
exportieren. Erst danach den Export lokal bearbeiten. Dadurch bleiben die von
Jira vergebenen Regel-, Component-, Actor- und Zeitstempelwerte erhalten.

## API-Authentifizierung (Data Center)

Für API-Zugriffe wird ein **Personal Access Token (PAT)** benötigt:
1. In Jira: Profilbild → **Profil** → **Personal Access Tokens**
2. Token erstellen mit `READ` + `WRITE`-Scopes
3. In `config/.env` eintragen: `JIRA_PERSONAL_ACCESS_TOKEN=<token>`

- Regel-IDs: `BDR-{NNN}` (fortlaufend)
- Branches: `feature/BDR-{ISSUE}-{kurzbeschreibung}`
- Labels: `automated`, `gitlab-sync`, `blocked`
