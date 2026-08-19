---
name: confluence-pages
description: 'Confluence-Data-Center-Seiten über die vorhandene REST-API sicher suchen, lesen, erstellen und aktualisieren. Use when: Confluence-Seite per ID öffnen, Seiteninhalt oder Metadaten analysieren, CQL-Suche ausführen, Unterseiten auflisten oder eine neue beziehungsweise geänderte Seite nach ausdrücklicher Freigabe veröffentlichen.'
---

# Confluence Pages

## Grundregeln

Verwende das gebündelte Skript `scripts/confluence-page.mjs`. Es lädt die
vorhandene PAT-, mTLS- und CA-Konfiguration des Jira-Automations-Repositorys.
Öffne weder `config/.env` noch Zertifikatsdateien. Zeige niemals Tokens,
Passphrasen, Authorization-Header oder ungefilterte Confluence-Antworten.

Führe Such- und Leseaufträge direkt read-only aus. Führe beim Erstellen oder
Aktualisieren immer zuerst den Preflight ohne `--apply` aus. Verwende `--apply`
nur nach ausdrücklicher Freigabe des konkret angezeigten Preflights in der
aktuellen Unterhaltung.

Lies [REST-API und Payloads](references/rest-api.md), wenn du Storage-Format,
CQL, Seitenhierarchie oder die Verifikation einer Änderung beurteilen musst.

## Lesen und suchen

Rufe das Skript über seinen absoluten Pfad im Skill-Verzeichnis oder aus dem
Repository so auf:

```powershell
npm run confluence-page -- get 21074848
npm run confluence-page -- get 21074848 --include-body
npm run confluence-page -- search --cql 'space = "CER" AND type = page'
npm run confluence-page -- children 21074848
```

Gib Seiteninhalte nur aus, wenn der Benutzer sie benötigt. Verwende dafür
`--include-body`. Begrenze Suchen und Unterseiten auf den benötigten Umfang.
Standard sind 20, erlaubt sind höchstens 100 Ergebnisse. Formuliere CQL aus dem
Benutzerauftrag; erfinde keine Space-Keys, Seiten-IDs oder Benutzerkennungen.

## Änderungen vorbereiten

Lege Seiteninhalte ausschließlich mit den vom Benutzer verlangten Inhalten in
einem geeigneten temporären Arbeitsbereich an. Verwende Confluence Storage
Format als UTF-8-Text. Nimm keine zusätzlichen redaktionellen oder fachlichen
Änderungen vor.

```powershell
npm run confluence-page -- create --space-key CER --title "Neue Seite" `
  --parent-id 21074848 --body-file <body.html>

npm run confluence-page -- update 21074848 --title "Neuer Titel" `
  --body-file <body.html>
```

Zeige dem Benutzer aus dem Preflight:

- Operation, Space-Key, Titel und Elternseite,
- bei Updates aktuelle und geplante Version,
- aktuelle und neue Inhaltslänge statt unnötig den gesamten Inhalt,
- `expectedAbsent` bei Erstellung beziehungsweise `expectedVersion` bei Update.

Ein Preflight ist read-only. Er berechtigt nicht selbst zum Schreiben.

## Freigegebene Änderung ausführen

Verwende nach ausdrücklicher Freigabe exakt dieselbe Payload und ergänze den
Schutzwert aus dem Preflight:

```powershell
npm run confluence-page -- create --space-key CER --title "Neue Seite" `
  --parent-id 21074848 --body-file <body.html> --apply --expected-absent true

npm run confluence-page -- update 21074848 --title "Neuer Titel" `
  --body-file <body.html> --apply --expected-version 29
```

Das Skript wiederholt den Preflight, blockiert bei Titelkonflikt oder
Versionsdrift, führt genau eine Mutation aus und liest den Serverstand zur
Verifikation erneut. Melde Seiten-ID, Version und Verifikationsstatus, aber
keine ungefilterte Response.

Wenn der Preflight nach der Freigabe abweicht, führe nicht `--apply` aus. Zeige
den neuen Preflight und hole eine neue Freigabe ein.

## Harte Grenzen

- Lösche keine Seiten.
- Ändere weder Anhänge, Kommentare, Berechtigungen noch Restriktionen.
- Labels sind ausschließlich bei der Seitenerstellung über `--labels` erlaubt.
  Der Preflight zeigt sie an; die Ausführung setzt und verifiziert sie. Ändere
  keine Labels bestehender Seiten und verwende keine Labels bei Updates.
- Verschiebe keine bestehende Seite in einen anderen Space oder unter eine
  andere Elternseite.
- Verwende ausschließlich Confluence Data Center REST API unter `/rest/api`;
  verwende nicht den Cloud-Pfad `/rest/api/2`.
- Rate niemals IDs, Space-Keys, Titel oder erwartete Versionen.
- Verwende `--apply` niemals für Tests, Smoke-Tests oder Forward-Tests.
- Stoppe bei HTTP-, TLS-, Berechtigungs-, Drift- oder
  Remote-Verifikationsfehlern.
