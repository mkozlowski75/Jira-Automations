# Jira Automation Rules

Dieses Repository enthält rohe Code-Barrel-Exporte für Jira Data Center und die
Werkzeuge, um sie in Visual Studio Code sicher zu entwickeln, zu validieren und
nach ausdrücklicher Freigabe bereitzustellen.

## Voraussetzungen

- Node.js 18 oder neuer
- Zugriff auf die Jira-Automation-Regeln des Zielprojekts
- Jira Personal Access Token
- mTLS-Client-Zertifikat
- bei interner CA die zugehörige Server-CA-Datei

```powershell
npm ci
Copy-Item config\.env.example config\.env
```

Anschließend die lokale `config/.env` befüllen. Sie und die unter `backups/`
angelegten Serverkopien werden nicht von Git erfasst. Credential-, Zertifikats-
und Secret-Werte dürfen nicht in Logs, Diffs oder Dokumentation übernommen
werden.

## Sicherer Arbeitsablauf

```powershell
# 1. Aktuellen Serverstand einer Regel read-only prüfen
npm run pull-rule -- rules/BDR-913.json

# 2. Jira- und Automation-Umgebung read-only prüfen
npm run inspect-environment -- rules/BDR-913.json

# 3. Für eine neue Component die nächste lokal und remote freie ID ermitteln
npm run next-component-id -- rules/BDR-913.json

# 4. Tests, Skill-Konsistenz und alle Regeln prüfen
npm run verify

# 5. Redigierten Push-Preflight ohne Schreibzugriff ausführen
npm run push-rule -- rules/BDR-913.json
```

Erst nach Prüfung des Preflights und ausdrücklicher Freigabe in der aktuellen
Unterhaltung darf geschrieben werden:

```powershell
npm run push-rule -- rules/BDR-913.json --apply
```

Vor jedem PUT wird der vollständige Serverstand unter `backups/BDR-{id}/`
gesichert. Anschließend wird die Remote-Regel erneut abgerufen und verifiziert.

## Rollback

Ein Rollback beginnt ebenfalls mit einem read-only Preflight:

```powershell
npm run rollback-rule -- backups/BDR-913/<timestamp>.server.json
npm run rollback-rule -- backups/BDR-913/<timestamp>.server.json --apply
```

Auch `--apply` beim Rollback erfordert eine ausdrückliche Freigabe.

## Neue Regeln

Neue Regeln zuerst deaktiviert in Jira anlegen und exportieren. Das Repository
erzeugt keine Rule-ID und keine serverseitigen Metadaten. Den unveränderten
Export als `rules/BDR-{id}.json` aufnehmen und erst danach bearbeiten.

## Verfügbare Befehle

| Befehl | Zweck | Schreibzugriff auf Jira |
|---|---|---|
| `npm run verify` | Tests, Skill-Prüfung und Validierung aller Regeln | Nein |
| `npm run pull-rule -- <regeldatei>` | Einzelne Serverregel redigiert anzeigen | Nein |
| `npm run inspect-environment -- <regeldatei>` | Jira-Version und Automation-API prüfen | Nein |
| `npm run next-component-id -- <regeldatei>` | Freie Component-ID aus lokalem und Remote-Bestand ermitteln | Nein |
| `npm run push-rule -- <regeldatei>` | Driftprüfung und redigierter Preflight | Nein |
| `npm run push-rule -- <regeldatei> --apply` | Backup, PUT und Remote-Verifikation | Ja |
| `npm run rollback-rule -- <backup>` | Rollback-Preflight | Nein |
| `npm run rollback-rule -- <backup> --apply` | Aktuellen Stand sichern und Backup einspielen | Ja |

## Projektstruktur

```text
.github/skills/jira-automation-rules/  Verbindlicher KI-Workflow und Referenzen
.vscode/settings.json                  Schema-Zuordnung für Visual Studio Code
config/.env.example                    Bereinigte Verbindungskonfiguration
rules/BDR-*.json                       Produktive Jira-Exporte
rules/rule-schema.json                 JSON-Schema und Editor-Unterstützung
scripts/                               Validierung und sichere Jira-Werkzeuge
test/                                  Bereinigte Fixtures und Sicherheitstests
```

Die technische Source of Truth sind `rules/rule-schema.json` und
`KNOWN_COMPONENTS` in `scripts/lib/rule-validation.mjs`. Zusätzliche
Exportfelder bleiben zur Vorwärtskompatibilität erlaubt; unbekannte
Component-Typen oder Schema-Versionen erzeugen Warnungen und blockieren einen
Push.

## Schutzregeln

- `id`, `clientKey`, `created` und `authorAccountId` niemals ändern.
- `updated` nicht künstlich setzen.
- Geschützte Scope- und Statusfelder nur nach ausdrücklichem Auftrag ändern.
- IDs und Component-Strukturen niemals erfinden.
- `.env`, Zertifikate, Backups und Secret-Werte nicht ungefiltert anzeigen.
- Ohne `--apply` findet niemals ein PUT statt.
- Bei Drift, Fehlern oder Warnungen nicht pushen.
