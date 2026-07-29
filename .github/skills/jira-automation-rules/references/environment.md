# Verifizierte Umgebung

## Aktueller Nachweisstand

- Zielplattform: Jira Data Center mit Automation for Jira (Code Barrel).
- Regelmodell: 28 rohe Exporte und 24 bekannte Typ-/Versionskombinationen.
- Schema- und Validator-Basis: Repository-Stand ab Commit `926d62d`.
- Dokumentationsstand zuletzt statisch geprüft: `2026-07-29`.
- Jira-Version: `10.3.23`.
- Jira-Build: `10030023`.
- Automation-Plugin-Version und -Build: read-only über UPM angefragt, mit dem
  aktuellen Konto jedoch nicht verfügbar (`HTTP 403` am `2026-07-29`).
- Automation-Regel-Liste: read-only über
  `/jira/rest/cb-automation/latest/project/{projectId}/rule` verifiziert.
- Einzelregel-GET: nicht unterstützt (`HTTP 405` am `2026-07-29`); nicht
  verwenden.

## Read-only Prüfung

```powershell
node scripts/inspect-environment.mjs rules/BDR-913.json
```

Der Befehl liest Konfiguration und Client-Zertifikat ausschließlich innerhalb
der Verbindungsschicht. Er darf keine Pfade, Benutzer, Tokens, Zertifikatsinhalte
oder Response-Bodies ausgeben.

Wenn die Jira- oder Automation-Version nicht ermittelt werden kann:

1. Keine API-Route und keine Versionsnummer erfinden.
2. Eine aktuell vom selben Server geladene Referenzregel desselben Component-Typs
   verwenden.
3. Gibt es keine solche Referenz, keine neue Component-Struktur erzeugen.

## API-Nachweise und Herkunft

- Jira-Version und -Build: Live-Antwort von Jira `serverInfo` am
  `2026-07-29`.
- UPM-Abfrage: [offiziell dokumentierter Atlassian-GET](https://developer.atlassian.com/platform/marketplace/registering-apps/#installing-an-app-using-the-rest-api)
  `/jira/rest/plugins/1.0/?os_authType=basic` mit
  `Accept: application/vnd.atl.plugins.installed+json`; bei fehlender
  Berechtigung wird nur der HTTP-Status gemeldet.
- Jira REST Basis: lokal aus `JIRA_API_PATH`, ohne Ausgabe der Konfiguration.
- Read-only Regelabruf: Listenendpunkt
  `/jira/rest/cb-automation/latest/project/{projectId}/rule`, anschließend
  Filterung nach numerischer Regel-ID; live verifiziert am `2026-07-29`.
- PUT einer bestehenden Regel: der bereits im Repository verwendete Pfad
  `/jira/rest/cb-automation/latest/project/{projectId}/rule/{ruleId}`. Er wurde
  bei dieser read-only Prüfung nicht aufgerufen und darf nur nach dem
  Freigabe-Workflow verwendet werden.
