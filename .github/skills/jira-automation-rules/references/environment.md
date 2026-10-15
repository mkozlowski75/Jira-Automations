# Verifizierte Umgebung

## Aktueller Nachweisstand

- Zielplattform: Jira Data Center mit Automation for Jira (Code Barrel).
- Regelmodell: alle getrackten `rules/BDR-*.json` und der aktuelle
  `KNOWN_COMPONENTS`-Katalog.
- Schema- und Validator-Basis: `rules/rule-schema.json` und
  `scripts/lib/rule-validation.mjs`.
- Jira-Umgebung und Regelstart zuletzt live geprüft: `2026-10-15`.
- Jira-Version: `11.3.12`.
- Jira-Build: `11030013`.
- Automation-Plugin-Version und -Build: read-only über UPM angefragt, mit dem
  aktuellen Konto jedoch nicht verfügbar (`HTTP 403` am `2026-07-29`).
- Automation-Regel-Liste: read-only über
  `/jira/rest/cb-automation/latest/project/{projectId}/rule` verifiziert.
- Einzelregel-GET: nicht unterstützt (`HTTP 405` am `2026-07-29`); nicht
  verwenden.

## Read-only Prüfung

```powershell
npm run inspect-environment -- rules/BDR-913.json
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


## Regel direkt starten und Ergebnis prüfen

Für beauftragte Jira-Automation-Testläufe den verifizierten API-Endpunkt nutzen.
Keine Browser- oder Computer-Use-Automation einsetzen und den Start nicht an den
Benutzer zurückgeben, solange der API-Weg verfügbar ist. Eine bestehende Freigabe
für genau diesen Testlauf genügt; die Skill-Anweisung selbst autorisiert keine
zusätzlichen Läufe oder Seitenerstellungen. Deployment-Freigaben gelten weiterhin.

Der folgende Start ist auf dieser Instanz für aktivierte geplante Regeln
(`jira.jql.scheduled`, `executionMode: nosearch`) verifiziert:

```text
POST /jira/rest/cb-automation/latest/project/{projectId}/rule/{ruleId}/execute
Content-Type: application/json
Body: {}
```

Projekt und Regel-ID aus dem aktuellen Serverstand übernehmen. Die vorhandene
Verbindungsschicht `scripts/lib/api-helper.mjs` verwenden; sie lädt PAT und mTLS
intern. Für ein bereits geladenes und geprüftes `rule` lautet der Aufruf:

```js
import { jiraConfig, jiraRawPost } from './scripts/lib/api-helper.mjs';
const projectId = rule.projects[0].projectId;
await jiraRawPost(
  `${jiraConfig().base}/jira/rest/cb-automation/latest/project/${projectId}/rule/${rule.id}/execute`,
  {},
);
```

1. Vor dem Start Regel-ID, Projekt, Aktivierung, Trigger und freigegebene Wirkung
   am Server prüfen. Bei Seitenerstellung den exakten Zieltitel auf Konflikte
   prüfen. Den letzten Audit-Eintrag und die Startzeit als Abgrenzung festhalten.
2. Den Start-POST genau einmal senden. Eine leere erfolgreiche Antwort ist
   zulässig; sie bestätigt nur die Annahme, noch keinen fachlichen Erfolg.
3. Neue Ausführung über
   `GET /jira/rest/cb-automation/latest/audit/{projectId}?limit=10&ruleId={ruleId}&offset=0`
   ermitteln; `CONFIG_CHANGE` nicht als Testlauf werten. Zeit und neue Audit-ID
   müssen zum eigenen Start passen. Details lesen über
   `GET /jira/rest/cb-automation/latest/audit/{projectId}/item/{auditId}`.
4. Neben `category` die tatsächlichen Schritte, HTTP-Status und Abschlusslogs
   prüfen. Logwerte stehen unter
   `componentChanges[].changeItems.results[]` (`fieldName`, `changeTo`);
   `changeItems` ist ein Objekt, kein Array. Nur benötigte, redigierte Werte ausgeben.
5. Das erzeugte Ergebnis unabhängig über den zuständigen API-Skill zurücklesen.
   Bei Confluence-Kopien Titel, Bereich, Elternseite und vollständigen Storage-Inhalt
   einschließlich Makros gegen die tatsächlich angeforderte Vorlagenversion prüfen.
   `SUCCESS` oder ein erfolgreicher POST allein genügt nicht als Nachweis.
6. Bei Timeout oder unklarer Antwort zuerst Audit und Zielzustand prüfen; niemals
   blind erneut starten. Bei fehlender Berechtigung oder abweichendem Trigger den
   konkreten Blocker melden, statt Trigger umzubauen oder auf Computer Use auszuweichen.
   Aktivierung und Ausführungsbenutzer ohne gesonderten Auftrag unverändert lassen.

Live-Nachweis vom 2026-10-15: Regel 913 per API genau einmal gestartet, Audit
`2885888` mit `SUCCESS`, fünf Confluence-Anfragen HTTP 200 und `VERIFIED`.
Die Testseite `549461215` wurde unabhängig zurückgelesen: vollständiger
Storage-Inhalt exakt gleich zur historischen Version 8 von Vorlage `375460291`
(9289 Zeichen), Bereich `CER`, Elternseite `96108562`.
