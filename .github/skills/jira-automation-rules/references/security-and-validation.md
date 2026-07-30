# Sicherheit, Validierung und Deployment

## Pflichtprüfungen

```powershell
npm run verify
npm run push-rule -- rules/BDR-913.json
```

Der erste Befehl führt Tests, Skill-Prüfung und Regelvalidierung aus. Der zweite
Befehl ist ohne `--apply` ein read-only Preflight. Ein Push ist nur bei
bestandenen Tests sowie 0 Fehlern und 0 Warnungen zulässig.

Der Validator prüft unter anderem:

- gültiges Code-Barrel-JSON und genau einen Top-Level-Trigger,
- repositoryweit eindeutige Component-IDs,
- `parentId` und `conditionParentId`,
- bekannte Typ-/Component-Zuordnungen und Schema-Versionen,
- Data-Center-`clientKey` und Projekt-Scope,
- Jira-Secret-Referenzen für sicherheitsrelevante ausgehende Header.

## Drift und geschützte Felder

Der Preflight vergleicht den aktuellen Serverstand mit der Git-HEAD-Fassung der
Regel. Bei Abweichung wird der Push blockiert. Geschützte Felder benötigen neben
dem ausdrücklichen Benutzerauftrag ein passendes
`--allow-field=<feld>`.

### Break-glass: Drift bewusst überschreiben

Der Break-glass-Workflow ist eine ausdrücklich freizugebende Ausnahme und kein
Standard-Deployment. Der normale read-only Preflight bleibt:

```powershell
npm run push-rule -- rules/BDR-913.json
```

Er zeigt redigiert Regel-ID, Name, Projekt-Scope, Trigger, die erkannte
Abweichung zu Git HEAD und die fachlichen Änderungen des lokalen Entwurfs
gegenüber dem aktuellen Serverstand. Dieser Preflight erteilt keine Freigabe
für einen späteren PUT.

Nur ein ausdrücklich freigegebener Benutzer darf anschließend in derselben
Unterhaltung den folgenden eigenständigen Aufruf beauftragen:

```powershell
npm run push-rule -- rules/BDR-913.json --apply --force-drift
```

`--force-drift` wird ohne `--apply` abgewiesen. Auch nach einem früheren
Preflight müssen beide Schalter im schreibenden Aufruf stehen. Dieser Aufruf
liest den Serverstand erneut, validiert die lokale Regel, erzeugt vor dem PUT
das vollständige Backup und hebt ausschließlich die Abweichung zwischen
aktuellem Jira-Serverstand und Git HEAD als Blocker auf. Folgende Sperren gelten
unverändert:

- fehlender Git-HEAD-Basisstand,
- Validierungsfehler und sämtliche Validierungswarnungen,
- Secret-, Token- oder sicherheitsrelevante Header-Änderungen,
- unveränderliche Top-Level-Felder,
- geschützte Top-Level-Felder ohne passendes `--allow-field=<feld>`,
- fehlgeschlagenes oder unvollständiges Backup.

Nach dem PUT lädt das Werkzeug die Regel erneut und verifiziert den fachlichen
Inhalt, die Component-Reihenfolge und sämtliche `parentId`- und
`conditionParentId`-Beziehungen. Nur nach erfolgreicher Verifikation werden die
serververwalteten Component-IDs und `updated` in den lokalen Export
synchronisiert. Bei jeder Abweichung bleibt die lokale Regel unverändert.
Ausgaben enthalten weder Tokens, Header, Zertifikate und Secrets noch rohe
Serverantworten.

## Secret-Behandlung

- `.env` und Zertifikate nicht öffnen.
- Server-Backups und rohe Tokenfelder nicht anzeigen.
- Token-, Password-, Authorization-, Passphrase-, Webhook-Token- und
  Secret-Werte werden in Diffs redigiert.
- Änderungen an Secret-Werten sind über den lokalen Push blockiert.
- Jira-Secret-Namen nur aus einer aktuellen Serverkonfiguration übernehmen.

## Backup und Rollback

Mit `--apply` wird vor dem PUT der unveränderte Serverstand unter
`backups/BDR-{id}/{timestamp}.server.json` gespeichert. `backups/` ist
Git-ignoriert. Nach dem PUT vergleicht das Werkzeug die fachliche Regelstruktur,
prüft die Elternreferenzen mit den von Jira vergebenen IDs und synchronisiert
erst bei erfolgreicher Remote-Verifikation die Server-IDs und `updated` in die
lokale Regeldatei. Andere Serverabweichungen bleiben blockierend. Der Rollback
folgt derselben Freigabeschranke. Vor dem nächsten Deployment muss der
synchronisierte Export nach erfolgreichem `npm run verify` als neuer
Git-HEAD-Basisstand übernommen werden.

```powershell
npm run rollback-rule -- backups/BDR-913/2026-01-01T12-00-00Z.server.json
npm run rollback-rule -- backups/BDR-913/2026-01-01T12-00-00Z.server.json --apply
```

Auch ein Rollback sichert zunächst den aktuellen Serverstand und verifiziert
anschließend die Remote-Regel.
