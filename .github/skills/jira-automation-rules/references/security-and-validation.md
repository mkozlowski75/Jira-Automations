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
Git-ignoriert. Der Rollback folgt derselben Freigabeschranke:

```powershell
npm run rollback-rule -- backups/BDR-913/2026-01-01T12-00-00Z.server.json
npm run rollback-rule -- backups/BDR-913/2026-01-01T12-00-00Z.server.json --apply
```

Auch ein Rollback sichert zunächst den aktuellen Serverstand und verifiziert
anschließend die Remote-Regel.
