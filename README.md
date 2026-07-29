# Bdr Jira Automations

Automatisierungsregeln und Integrationen für Jira Data Center & GitLab.

> **Jira-Instanz:** https://partner.bdr.de (Data Center)

## Projektstruktur

```
Jira-Automations/
├── rules/              # Exportierte Jira-Automatisierungsregeln (JSON)
├── scripts/            # Helper-Skripte für Jira/GitLab-API
├── docs/               # Dokumentation der Automatisierungen
├── config/             # Konfigurationsdateien (Webhooks, Credentials via .env)
└── README.md
```

## Übersicht der Automatisierungsregeln

| Regel | Typ | Beschreibung | Status |
|-------|-----|-------------|--------|
| – | – | – | – |

## Konfiguration

1. `.env`-Datei aus `.env.example` kopieren:
   ```powershell
   Copy-Item config\.env.example config\.env
   ```

2. API-Tokens in `config\.env` eintragen:
   - `JIRA_PERSONAL_ACCESS_TOKEN` – Jira Data Center Personal Access Token
   - `GITLAB_API_TOKEN` – GitLab Personal Access Token

## Schnellstart

```powershell
# Abhängigkeiten installieren
npm install

# Regel-Export validieren
node scripts/validate-rules.mjs

# Regel-Sync mit Jira (push/pull)
node scripts/sync-rules.mjs --help
```

## Lizenz

Internes Projekt – Bdr.
