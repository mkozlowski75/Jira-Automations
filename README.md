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
gesichert. Anschließend wird die Remote-Regel erneut abgerufen und strukturell
verifiziert. Wenn Jira dabei Trigger- oder Component-IDs neu vergibt, prüft das
Werkzeug die zugehörigen Elternreferenzen und synchronisiert die bestätigten
Server-IDs sowie `updated` in den lokalen Export.

Nach erfolgreicher Synchronisierung erneut `npm run verify` ausführen und den
lokalen Export committen. Die nächste Driftprüfung verwendet Git HEAD als
bekannten Server-Basisstand.

## Rollback

Ein Rollback beginnt ebenfalls mit einem read-only Preflight:

```powershell
npm run rollback-rule -- backups/BDR-913/<timestamp>.server.json
npm run rollback-rule -- backups/BDR-913/<timestamp>.server.json --apply
```

Auch `--apply` beim Rollback erfordert eine ausdrückliche Freigabe.

## CVE-Ticket-Factory

Die Factory validiert einen Dependency-/Trivy-Fund, rendert die Beschreibung
nach der Confluence-Seite `507095421` ("Vorlage für CVE-Tickets") und sucht vor
jeder Anlage nach offenen CER-Tickets mit derselben CVE-ID. Eine anonymisierte
Eingabe liegt unter `examples/cve-finding.example.json`.

Pflichtfelder sind `cve`, `library`, `installedVersion`, `severity` und `source`.
`shortDescription` sowie die projektspezifischen Bewertungsfelder sind optional;
fehlende Bewertungen bleiben in der Beschreibung leer. Fehlt die Kurzbeschreibung,
verwendet die Summary die Bibliothek als technischen Suffix.

Der Standardaufruf ist immer ein read-only Preflight:

```powershell
npm run create-cve-ticket -- --input examples/cve-finding.example.json
```

Der Preflight zeigt Deduplizierungsbefund, Projekt, Vorgangstyp, Summary,
Description und eine 15 Minuten gültige `preflightId`. Bei einem bestehenden
Ticket werden Key, Summary und Status ausgegeben und keine Freigabe-ID erzeugt.

Erst nachdem der Benutzer exakt diese erwarteten Ticketdaten ausdrücklich
bestätigt hat, darf derselbe Fund mit der ausgegebenen ID angelegt werden:

```powershell
npm run create-cve-ticket -- --input examples/cve-finding.example.json `
  --apply --preflight-id <id-aus-preflight>
```

`--apply` verbraucht den Preflight-Nachweis, wiederholt die Deduplizierung direkt
vor genau einem POST und liest das neue Ticket zur Remote-Verifikation erneut.
Bei Fehlern oder einem abgelaufenen/geänderten Preflight ist ein neuer Preflight
mit neuer Benutzerfreigabe erforderlich.

In Codex kann derselbe kontrollierte Ablauf natürlichsprachlich mit
`$cve-ticket-factory` gestartet werden. Der Skill fragt fehlende Pflichtwerte ab
und darf die projektspezifische Bewertung nicht selbst ableiten oder erfinden.

## Neue Regeln

Neue Regeln zuerst deaktiviert in Jira anlegen und exportieren. Das Repository
erzeugt keine Rule-ID und keine serverseitigen Metadaten. Den unveränderten
Export als `rules/BDR-{id}.json` aufnehmen und erst danach bearbeiten.

## Verfügbare Befehle

| Befehl | Zweck | Schreibzugriff |
|---|---|---|
| `npm run verify` | Tests, Skill-Prüfung und Validierung aller Regeln | Nein |
| `npm run pull-rule -- <regeldatei>` | Einzelne Serverregel redigiert anzeigen | Nein |
| `npm run inspect-environment -- <regeldatei>` | Jira-Version und Automation-API prüfen | Nein |
| `npm run next-component-id -- <regeldatei>` | Freie Component-ID aus lokalem und Remote-Bestand ermitteln | Nein |
| `npm run push-rule -- <regeldatei>` | Driftprüfung und redigierter Preflight | Nein |
| `npm run push-rule -- <regeldatei> --apply` | Backup, PUT und Remote-Verifikation | Ja |
| `npm run rollback-rule -- <backup>` | Rollback-Preflight | Nein |
| `npm run rollback-rule -- <backup> --apply` | Aktuellen Stand sichern und Backup einspielen | Ja |
| `npm run jira-ticket -- get <KEY>` | Jira-Ticket mit ausgewählten Feldern lesen | Nein |
| `npm run jira-ticket -- search --jql "<JQL>"` | Jira-Tickets per JQL suchen | Nein |
| `npm run jira-ticket -- comment/edit/transition ...` | Ticketänderung vorbereiten; erst `--apply` schreibt | Standardmäßig nein |
| `npm run create-cve-ticket -- --input <fund.json>` | CVE-Ticket validieren, deduplizieren und vorbereiten | Nein |
| `npm run create-cve-ticket -- --input <fund.json> --apply --preflight-id <id>` | Freigegebenen CVE-Task anlegen und verifizieren | Ja |
| `npm run confluence-page -- get <ID>` | Confluence-Seitenmetadaten lesen | Nein |
| `npm run confluence-page -- search --cql "<CQL>"` | Confluence-Seiten per CQL suchen | Nein |
| `npm run confluence-page -- create/update ...` | Seitenänderung vorbereiten; erst `--apply` schreibt | Standardmäßig nein |

## Projektstruktur

```text
.github/skills/jira-automation-rules/  Verbindlicher KI-Workflow und Referenzen
.github/skills/jira-tickets/           Sicherer Lese- und Änderungsworkflow für Tickets
.github/skills/confluence-pages/       Sicherer Lese- und Änderungsworkflow für Seiten
.github/skills/cve-ticket-factory/      Freigabegesteuerte CER-CVE-Ticketanlage
.vscode/settings.json                  Schema-Zuordnung für Visual Studio Code
config/.env.example                    Bereinigte Verbindungskonfiguration
rules/BDR-*.json                       Produktive Jira-Exporte
rules/rule-schema.json                 JSON-Schema und Editor-Unterstützung
scripts/                               Validierung und sichere Jira-Werkzeuge
test/                                  Bereinigte Fixtures und Sicherheitstests
examples/                              Anonymisierte Eingabebeispiele
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
- Ticketänderungen benötigen zusätzlich den unveränderten `updated`-Wert aus dem Preflight.
- Bei Drift, Fehlern oder Warnungen nicht pushen.
