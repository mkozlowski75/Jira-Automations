---
name: jira-automation-rules
description: 'Jira Data Center Automation-for-Jira-Regeln im rohen Code-Barrel-JSON sicher analysieren, bearbeiten, validieren und nach ausdrücklicher Freigabe deployen. Use when: bestehende BDR-Regel ändern, bereits in Jira angelegte neue Regel vorbereiten, Trigger, Actions, Conditions oder Branches bearbeiten, Regel-Preflight, Push oder Rollback.'
---

# Jira Automation Rules – sicherer Data-Center-Workflow

## Geltungsbereich

Dieser Skill gilt ausschließlich für Jira Data Center mit Automation for Jira
(Code Barrel) und für rohe Exporte unter `rules/BDR-{id}.json`. Verwende niemals
Jira-Cloud-JSON. `rules/rule-schema.json` und `KNOWN_COMPONENTS` in
`scripts/lib/rule-validation.mjs` sind die technische Source of Truth.

Öffne weder `config/.env` noch Zertifikatsdateien. Verbindungswerkzeuge dürfen
diese Dateien intern laden; Credential-, Zertifikats-, Token- und Secret-Werte
dürfen niemals angezeigt, kopiert oder protokolliert werden.

## Benötigte Referenzen

Lade nur die für die Aufgabe erforderlichen Dateien:

- Top-Level- oder Scope-Änderung: [Top-Level-Felder](references/rule-top-level.md)
- Neue IDs oder Jira-Metadaten: [IDs und Metadaten](references/ids-and-metadata.md)
- Trigger: [Trigger](references/triggers.md)
- Actions: [Actions](references/actions.md)
- Conditions oder Branches: [Conditions und Branches](references/conditions.md)
- Smart Values: [Smart Values](references/smart-values.md)
- Validierung, Secrets, Backup oder Push: [Sicherheit und Validierung](references/security-and-validation.md)
- Jira-/Automation-Version oder API: [Umgebung](references/environment.md)

Die Beispiele [Minimalregel](examples/minimal-disabled-rule.json),
[If-Block](examples/if-block.json) und
[Webhook](examples/outgoing-webhook.json) sind bereinigte, nicht deploybare
Lernartefakte. Übernimm keine Beispiel-ID in eine produktive Regel.

## Verbindlicher Workflow für bestehende Regeln

1. Identifiziere genau eine Zielregel und prüfe, dass sie als
   `rules/BDR-{id}.json` vorliegt.
2. Führe `npm run pull-rule -- <regeldatei>` aus. Das ist read-only und
   gibt nur redigierte Metadaten aus.
3. Prüfe die Umgebung vor strukturellen Erweiterungen mit
   `npm run inspect-environment -- <regeldatei>`. Ist die
   Automation-Version unbekannt, verwende eine aktuelle Server-Referenzregel
   desselben Component-Typs; existiert keine, stoppe.
4. Lies die vollständige Zielregel und eine passende aktuelle Referenzregel.
   Erhalte unbekannte Felder unverändert.
5. Beziehe Projekt-, Status-, Feld-, Benutzer-, Board-, Transition- und
   Secret-IDs ausschließlich aus Jira oder aktuellen Exporten. Rate niemals.
6. Erhalte bestehende Component-IDs im lokalen Entwurf. Erzeuge neue IDs ausschließlich mit
   `npm run next-component-id -- <regeldatei>`. Das Werkzeug berücksichtigt
   lokale und aktuelle Remote-Regeln. Führe es für jede weitere neue Component
   erneut aus. Behandle diese IDs als konsistente Referenzen für den PUT; Jira
   Data Center darf beim Speichern alle Component-IDs neu vergeben.
7. Ändere nur die beauftragte Logik. Setze `updated` nicht künstlich.
8. Führe `npm run verify` aus. Für einen Push sind 0 Fehler und 0 Warnungen
   erforderlich; alle Tests müssen bestehen.
9. Führe `npm run push-rule -- <regeldatei>` ohne `--apply` aus. Zeige dem
   Benutzer den redigierten Preflight mit Regel, Scope, Trigger, hinzugefügten,
   geänderten und entfernten Components sowie geschützten Feldänderungen.
10. Führe einen Push nur aus, wenn der Benutzer ihn in der aktuellen Unterhaltung
    ausdrücklich freigibt. Verwende danach denselben Befehl mit `--apply`.
    Das Werkzeug prüft Drift, legt ein Git-ignoriertes Server-Backup an und
    verifiziert die Remote-Regel strukturell. Es prüft dabei Parent-Beziehungen
    mit den neuen Server-IDs und synchronisiert erst nach erfolgreicher Prüfung
    ausschließlich Component-IDs und `updated` in den lokalen Export.
11. Führe nach der Synchronisierung `npm run verify` aus und übernimm den
    verifizierten lokalen Export in Git, bevor du den nächsten Push vorbereitest.
    Die folgende Drift-Prüfung verwendet diesen Git-HEAD-Stand als Basis.

## Break-glass bei bewusst akzeptierter Serverdrift

Dieser Ausnahme-Workflow ist kein Standard-Deployment. Verwende ihn nur, wenn
ein ausdrücklich freigegebener Benutzer in der aktuellen Unterhaltung das
bewusste Überschreiben des vom Git-HEAD abweichenden Jira-Serverstands
beauftragt.

1. Führe zuerst den normalen read-only Preflight aus:
   `npm run push-rule -- <regeldatei>`. Er muss redigiert Regel-ID, Name, Scope,
   Trigger, die Abweichung des Serverstands von Git HEAD und die vorgesehenen
   fachlichen Änderungen der lokalen Regel gegenüber dem aktuellen Serverstand
   zeigen.
2. Prüfe die angezeigten fachlichen Änderungen mit dem Benutzer. Der Preflight
   selbst ist keine Freigabe und kann nicht für einen späteren Schreibzugriff
   wiederverwendet werden.
3. Verwende nach ausdrücklicher Freigabe in derselben Unterhaltung
   `npm run push-rule -- <regeldatei> --apply --force-drift`. Das Werkzeug liest
   den Serverstand erneut und führt den PUT nur aus, wenn beide Schalter in
   diesem Aufruf gesetzt sind.
4. `--force-drift` hebt ausschließlich die Drift-Sperre auf. Fehlender
   Git-Basisstand, Validierungsfehler oder -warnungen, Secret-Änderungen,
   unveränderliche Felder sowie nicht mit `--allow-field=<feld>` freigegebene
   geschützte Felder bleiben blockierend.
5. Vor dem PUT muss das vollständige lokale Server-Backup unter
   `backups/BDR-{id}/` erfolgreich angelegt sein. Nach dem PUT muss der
   Serverstand erneut geladen und fachlich einschließlich Component-Reihenfolge
   und `parentId`-/`conditionParentId`-Beziehungen verifiziert werden. Erst
   danach dürfen serververwaltete Component-IDs und `updated` in den lokalen
   Export synchronisiert werden.
6. Brich bei jedem Lese-, Backup-, PUT- oder Verifikationsfehler ab. Gib niemals
   Tokens, Header, Zertifikate, Secrets oder rohe Serverantworten aus.

## Neue Regeln

Erzeuge keine Rule-ID und keine leere Regel per vermuteter API. Der Benutzer muss
zuerst in Jira eine leere, deaktivierte Regel anlegen und exportieren. Dieser
unveränderte Export muss als Git-Basisstand vorliegen, bevor er bearbeitet und
über den normalen Workflow gepusht wird.

## Harte Schutzregeln

- Niemals erfinden: Rule-, Component-, Projekt-, Status-, Feld-, Benutzer-,
  Board- oder Transition-ID; Secret-Key; Schema-Version.
- Unveränderlich: `id`, `clientKey`, `created`, `authorAccountId`.
- Nur nach explizitem Auftrag ändern: `actorAccountId`, `projects`, `state`,
  `canOtherRuleTrigger`, `notifyOnError`. Der Preflight benötigt dafür zusätzlich
  `--allow-field=<feld>`.
- Ändere keine Token-, Password-, Authorization-, Webhook-Token- oder
  Secret-Werte in JSON. Verwende für ausgehende Header Jira-Secret-Referenzen.
- Ein unbekannter Component-Typ oder eine unbekannte Schema-Version ist vor einem
  Push blockierend, auch wenn der Validator dies zur Vorwärtskompatibilität als
  Warnung meldet.
- Bei Serverdrift ohne den ausdrücklich freigegebenen Break-glass-Aufruf
  `--apply --force-drift`, fehlendem Git-Basisstand, fehlgeschlagenem Backup,
  Validierungsfehlern oder Warnungen: nicht pushen.
- Akzeptiere neu vergebene Server-IDs nur bei identischer Component-Reihenfolge,
  identischem fachlichem Inhalt und gültigen `parentId`-/`conditionParentId`-
  Beziehungen. Ignoriere IDs niemals pauschal.
- Melde nach jedem Schreibversuch, ob Backup, PUT und Remote-Verifikation
  erfolgreich waren. Zeige dabei keine ungefilterten Regel- oder Response-Daten.
- Verwende ausschließlich `pull-rule`, `push-rule` und `rollback-rule` für den
  Serverabgleich. `push-rule` ist ohne `--apply` immer read-only;
  `--force-drift` ohne `--apply` wird abgewiesen.

## Rollback

Backups liegen lokal unter `backups/BDR-{id}/` und können Secrets enthalten.
Öffne oder zeige sie nicht ungefiltert. Führe zunächst
`npm run rollback-rule -- <backup>` ohne `--apply` aus. Ein Rollback
benötigt wie ein Push eine ausdrückliche Freigabe in der aktuellen Unterhaltung
und anschließend `--apply`.
