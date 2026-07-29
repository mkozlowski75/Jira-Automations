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
npm run validate

# Nächste repositoryweit freie Component-ID
npm run next-component-id -- rules/BDR-913.json

# Aktuellen Serverstand read-only prüfen
npm run pull-rule -- rules/BDR-913.json

# Read-only Push-Preflight
npm run preflight -- rules/BDR-913.json
```

Neue Regeln werden zunächst deaktiviert in Jira angelegt und anschließend nach
`rules/` exportiert. Es gibt bewusst keine generische lokale Regelvorlage, weil
Jira die Regel- und Component-IDs sowie weitere Metadaten vergibt.

Ein tatsächlicher Push erfolgt erst nach erfolgreicher Validierung, geprüftem
Preflight und ausdrücklicher Benutzerfreigabe mit zusätzlichem `--apply`.
Unmittelbar vor dem PUT wird der Serverstand Git-ignoriert unter `backups/`
gesichert und danach remote verifiziert. `sync-rules.mjs` ist kein sicherer
Produktionsworkflow.

## Lizenz

Internes Projekt – Bdr.
